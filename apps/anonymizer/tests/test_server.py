import http.client
import json
import threading
import unittest

from anonymizer.engine import Anonymizer, Options
from anonymizer.server import make_server

TEXT = (
    "This Agreement is made between Acme Ltd and John Smith, residing at 221B Baker Street, "
    "London NW1 6XE. Contact: john.smith@example.com, IBAN GB82WEST12345698765432.\n"
    "Name: John Smith\n"
)


class ServerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = make_server("127.0.0.1", 0, Anonymizer())
        cls.port = cls.server.server_address[1]
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def request(self, method: str, path: str, body: bytes | None = None) -> tuple[int, dict]:
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        try:
            headers = {"Content-Type": "application/json"} if body is not None else {}
            conn.request(method, path, body=body, headers=headers)
            response = conn.getresponse()
            return response.status, json.loads(response.read())
        finally:
            conn.close()

    def post(self, path: str, payload) -> tuple[int, dict]:
        return self.request("POST", path, json.dumps(payload).encode())

    def test_health_lists_labels_and_models(self):
        status, body = self.request("GET", "/health")
        self.assertEqual(status, 200)
        self.assertIn("PESEL", body["labels"])
        self.assertIsInstance(body["ner_models"], dict)

    def test_options_over_http(self):
        status, body = self.post("/anonymize", {"text": "PESEL 44051401359, anna@example.pl", "options": {"labels": ["EMAIL"]}})
        self.assertEqual(status, 200)
        self.assertEqual([e["label"] for e in body["entities"]], ["EMAIL"])
        status, body = self.post("/anonymize", {"text": "x", "options": {"labels": ["NOPE"]}})
        self.assertEqual(status, 400)

    def test_health(self):
        status, body = self.request("GET", "/health")
        self.assertEqual(status, 200)
        self.assertLessEqual({"ok": True, "version": "1", "ner": False, "engine": "rules"}.items(), body.items())

    def test_anonymize_contract(self):
        status, body = self.post("/anonymize", {"text": TEXT, "language": None, "keep": []})
        self.assertEqual(status, 200)
        self.assertEqual(set(body), {"text", "language", "engine", "entities", "spans"})
        self.assertEqual(body["language"], "en")
        self.assertEqual(body["engine"], "rules")
        self.assertNotIn("John Smith", body["text"])
        for entity in body["entities"]:
            self.assertEqual(set(entity), {"placeholder", "label", "value", "count", "variants"})
        for span in body["spans"]:
            self.assertEqual(set(span), {"start", "end", "label", "placeholder", "text"})
            self.assertEqual(TEXT[span["start"] : span["end"]], span["text"])
        person = next(e for e in body["entities"] if e["label"] == "PERSON")
        self.assertEqual(
            person,
            {
                "placeholder": "<PERSON_1>",
                "label": "PERSON",
                "value": "John Smith",
                "count": 2,
                "variants": ["John Smith"],
            },
        )

    def test_keep_and_language(self):
        status, body = self.post("/anonymize", {"text": TEXT, "language": "en", "keep": ["acme ltd"]})
        self.assertEqual(status, 200)
        self.assertIn("Acme Ltd", body["text"])

    def test_round_trip(self):
        _, anonymized = self.post("/anonymize", {"text": TEXT})
        status, body = self.post(
            "/deanonymize", {"text": anonymized["text"], "entities": anonymized["entities"]}
        )
        self.assertEqual(status, 200)
        self.assertEqual(body, {"text": TEXT})

    def test_deanonymize_longest_placeholder_first(self):
        entities = [{"placeholder": f"<PERSON_{i}>", "value": f"P{i}"} for i in range(1, 12)]
        _, body = self.post(
            "/deanonymize", {"text": "<PERSON_1> <PERSON_10> <PERSON_11>", "entities": entities}
        )
        self.assertEqual(body["text"], "P1 P10 P11")

    def test_bad_requests(self):
        cases = [
            self.request("POST", "/anonymize", b"{not json"),
            self.post("/anonymize", {}),
            self.post("/anonymize", {"text": 42}),
            self.post("/anonymize", {"text": "x", "language": "de"}),
            self.post("/anonymize", {"text": "x", "keep": "Acme"}),
            self.post("/anonymize", ["text"]),
            self.post("/deanonymize", {"text": "x"}),
            self.post("/deanonymize", {"text": "x", "entities": [{"placeholder": 1}]}),
        ]
        for status, body in cases:
            self.assertEqual(status, 400, body)
            self.assertIsInstance(body.get("error"), str)

    def test_unknown_route(self):
        status, _ = self.request("GET", "/nope")
        self.assertEqual(status, 404)


if __name__ == "__main__":
    unittest.main()


class OptionsTest(unittest.TestCase):
    """Per-request techniques chosen by the admin settings page."""

    TEXT = (
        "Umowa zawarta pomiędzy Wisła Data Solutions S.A. reprezentowaną przez Annę Kowalską, "
        "PESEL 44051401359, e-mail anna.kowalska@example.pl. Korespondencję do Anny Kowalskiej kieruje się na adres e-mail."
    )

    def test_labels_limit_what_is_replaced(self):
        out = anonymize_with(self.TEXT, {"labels": ["PESEL"]})
        self.assertEqual({e.label for e in out.entities}, {"PESEL"})
        self.assertIn("Annę Kowalską", out.text)

    def test_without_person_cues_names_stay(self):
        out = anonymize_with(self.TEXT, {"person_cues": False})
        self.assertNotIn("PERSON", {e.label for e in out.entities})
        self.assertNotIn("44051401359", out.text)

    def test_without_inflection_case_forms_are_not_linked(self):
        linked = anonymize_with(self.TEXT, {})
        self.assertNotIn("Anny Kowalskiej", linked.text)
        unlinked = anonymize_with(self.TEXT, {"inflection": False})
        self.assertIn("Anny Kowalskiej", unlinked.text)

    def test_without_propagation_later_mentions_stay(self):
        out = anonymize_with(self.TEXT, {"propagate": False})
        self.assertIn("Anny Kowalskiej", out.text)

    def test_invalid_options_are_rejected(self):
        for bad in ({"labels": ["NOPE"]}, {"labels": "PESEL"}, {"ner": "yes"}, {"ner_models": ["x"]}):
            with self.assertRaises(ValueError):
                Options.from_dict(bad)


def anonymize_with(text, options):
    return Anonymizer().anonymize(text, "pl", (), Options.from_dict(options))
