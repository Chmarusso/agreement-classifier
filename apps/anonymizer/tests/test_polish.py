import re
import unittest

from anonymizer import anonymize

AGREEMENT = """# Umowa o świadczenie usług

Umowa zawarta w Warszawie pomiędzy Northwind Analytics sp. z o.o. z siedzibą w Warszawie, ul. Marszałkowska 10/12, 00-590 Warszawa, KRS 0000123456, NIP 5260250274, REGON 123456785, reprezentowana przez Jana Kowalskiego – Prezesa Zarządu (dalej „Zleceniodawca”),
a
Anna Nowak, zamieszkała w Krakowie, PESEL 44051401359, e-mail anna.nowak@example.pl, tel. +48 600 700 800 (dalej „Zleceniobiorca”).

## § 3. Wynagrodzenie
Wynagrodzenie w kwocie 12 000 zł brutto płatne jest na nr rachunku PL61 1090 1014 0000 0712 1981 2874 w terminie 14 dni.

## § 4. Kontakt
Osobą kontaktową po stronie Zleceniobiorcy jest Pani Anna Nowak. Zleceniodawca przekaże Annie Nowak dokumentację. Oświadczenia w imieniu Zleceniodawcy składa Pan Jan Kowalski; korespondencję do Kowalskiego wysyła się na adres siedziby.

## § 5. Postanowienia końcowe
Umowa podlega prawu polskiemu (prawo polskie). Spory rozstrzyga sąd w Warszawie. Zmiany § 3 wymagają formy pisemnej.
"""

PII = [
    "Northwind Analytics",
    "Marszałkowska",
    "00-590",
    "0000123456",
    "5260250274",
    "123456785",
    "Kowalsk",
    "Nowak",
    "44051401359",
    "anna.nowak@example.pl",
    "600 700 800",
    "PL61 1090",
    "2874",
]


class PolishAgreementTest(unittest.TestCase):
    def setUp(self):
        self.result = anonymize(AGREEMENT)
        self.by_placeholder = {s.placeholder: s for s in self.result.spans}

    def placeholder_of(self, surface: str) -> str:
        placeholders = {s.placeholder for s in self.result.spans if s.text == surface}
        self.assertEqual(len(placeholders), 1, f"{surface!r} -> {placeholders}")
        return placeholders.pop()

    def test_detects_polish(self):
        self.assertEqual(self.result.language, "pl")

    def test_all_pii_removed(self):
        for value in PII:
            self.assertNotIn(value, self.result.text, value)

    def test_labels(self):
        labels = {s.text: s.label for s in self.result.spans}
        self.assertEqual(labels["Northwind Analytics sp. z o.o."], "ORG")
        self.assertEqual(labels["ul. Marszałkowska 10/12, 00-590 Warszawa"], "ADDRESS")
        self.assertEqual(labels["0000123456"], "KRS")
        self.assertEqual(labels["5260250274"], "NIP")
        self.assertEqual(labels["123456785"], "REGON")
        self.assertEqual(labels["44051401359"], "PESEL")
        self.assertEqual(labels["anna.nowak@example.pl"], "EMAIL")
        self.assertEqual(labels["+48 600 700 800"], "PHONE")
        self.assertEqual(labels["PL61 1090 1014 0000 0712 1981 2874"], "IBAN")

    def test_inflected_forms_share_placeholder(self):
        kowalski = self.placeholder_of("Jana Kowalskiego")
        self.assertEqual(self.placeholder_of("Jan Kowalski"), kowalski)
        self.assertEqual(self.placeholder_of("Kowalskiego"), kowalski)
        nowak = self.placeholder_of("Anna Nowak")
        self.assertEqual(self.placeholder_of("Annie Nowak"), nowak)
        self.assertNotEqual(kowalski, nowak)
        entity = next(e for e in self.result.entities if e.placeholder == nowak)
        self.assertEqual(entity.value, "Anna Nowak")
        self.assertIn("Annie Nowak", entity.variants)
        self.assertEqual(entity.count, 3)

    def test_non_pii_kept(self):
        text = self.result.text
        for kept in (
            "sąd w Warszawie",
            "prawo polskie",
            "prawu polskiemu",
            "§ 3",
            "12 000 zł",
            "14 dni",
            "„Zleceniodawca”",
            "z siedzibą w Warszawie",
            "zamieszkała w Krakowie",
        ):
            self.assertIn(kept, text, kept)
        self.assertIn("## § 3. Wynagrodzenie", text)

    def test_placeholder_format(self):
        for span in self.result.spans:
            self.assertRegex(span.placeholder, r"^<[A-Z_]+_\d+>$")
            self.assertEqual(AGREEMENT[span.start : span.end], span.text)
        starts = [s.start for s in self.result.spans]
        self.assertEqual(starts, sorted(starts))
        self.assertTrue(all(a.end <= b.start for a, b in zip(self.result.spans, self.result.spans[1:])))

    def test_keep_list_preserves_company(self):
        result = anonymize(AGREEMENT, keep=["northwind analytics"])
        self.assertIn("Northwind Analytics sp. z o.o.", result.text)
        self.assertFalse(any(e.label == "ORG" for e in result.entities))
        self.assertNotIn("Nowak", result.text)

    def test_numbering_by_first_appearance(self):
        persons = [e.placeholder for e in self.result.entities if e.label == "PERSON"]
        self.assertEqual(persons, ["<PERSON_1>", "<PERSON_2>"])
        first = re.search(r"<PERSON_\d+>", self.result.text).group()
        self.assertEqual(first, "<PERSON_1>")


class PolishIdentifiersTest(unittest.TestCase):
    def test_cue_anonymizes_invalid_checksum(self):
        result = anonymize("Pracownik, PESEL: 44051401358, NIP 526-025-02-75.", language="pl")
        labels = {s.text: s.label for s in result.spans}
        self.assertEqual(labels.get("44051401358"), "PESEL")
        self.assertEqual(labels.get("526-025-02-75"), "NIP")

    def test_invalid_number_without_cue_kept(self):
        result = anonymize("Kod zamówienia 44051401358 z dnia 1 marca.", language="pl")
        self.assertEqual(result.spans, [])

    def test_nrb_and_id_card(self):
        text = "Przelew na konto 61 1090 1014 0000 0712 1981 2874; dowód osobisty ABA 300000."
        labels = {s.text: s.label for s in anonymize(text, language="pl").spans}
        self.assertEqual(labels.get("61 1090 1014 0000 0712 1981 2874"), "BANK_ACCOUNT")
        self.assertEqual(labels.get("ABA 300000"), "ID_CARD")

    def test_person_before_residence_cue_and_after_pan(self):
        text = "Jan Kowalski, zamieszkały w Krakowie, oraz Panem Piotrem Zielińskim. Podpis: Zieliński."
        result = anonymize(text, language="pl")
        self.assertNotIn("Kowalski", result.text)
        self.assertNotIn("Zieliński", result.text)
        self.assertIn("Krakowie", result.text)

    def test_date_of_birth_only_with_cue(self):
        result = anonymize("Anna Nowak, urodzona 14.05.1944 r., umowa z dnia 01.10.2026 r.", language="pl")
        labels = {s.text: s.label for s in result.spans}
        self.assertEqual(labels.get("14.05.1944"), "DATE_OF_BIRTH")
        self.assertIn("01.10.2026", result.text)

    def test_amounts_and_dates_not_phones(self):
        text = "Kwota 100 000 000 zł płatna do 2026-10-01, § 12 ust. 3, pkt 4."
        self.assertEqual(anonymize(text, language="pl").spans, [])

    def test_quoted_company_name(self):
        result = anonymize("Umowa z „Acme Polska” sp. z o.o. oraz Beta Soft S.A.", language="pl")
        orgs = [s.text for s in result.spans if s.label == "ORG"]
        self.assertEqual(orgs, ["„Acme Polska” sp. z o.o.", "Beta Soft S.A."])

    def test_fleeting_e_and_short_given_names(self):
        text = (
            "Spółkę reprezentuje Pan Marek Zieliński. Umowę podpisano przez Marka Zielińskiego.\n"
            "Pełnomocnik: Ewa Lis. Pełnomocnictwo udzielono Pani Ewie Lis."
        )
        result = anonymize(text, language="pl")
        self.assertEqual(result.text.count("<PERSON_1>"), 2)
        self.assertEqual(result.text.count("<PERSON_2>"), 2)
        self.assertNotIn("Ewie", result.text)

    def test_hyphenated_surname_and_role_labels(self):
        text = (
            "Panią Joanną Nowak-Kowalską, zamieszkałą w Warszawie.\n"
            "Wynajmujący: Joanna Nowak-Kowalska\nNajemca: Grzegorz Brzęczyszczykiewicz\n"
            "Za Spółkę: Adam Mazur, Prezes Zarządu"
        )
        result = anonymize(text, language="pl")
        names = {e.value: e.count for e in result.entities if e.label == "PERSON"}
        self.assertEqual(
            names, {"Joanna Nowak-Kowalska": 2, "Grzegorz Brzęczyszczykiewicz": 1, "Adam Mazur": 1}
        )

    def test_land_register(self):
        result = anonymize("Sąd Rejonowy prowadzi księgę wieczystą nr WA4M/00123456/7.", language="pl")
        self.assertEqual([(s.text, s.label) for s in result.spans], [("WA4M/00123456/7", "LAND_REGISTER")])
        self.assertIn("Sąd Rejonowy", result.text)


if __name__ == "__main__":
    unittest.main()
