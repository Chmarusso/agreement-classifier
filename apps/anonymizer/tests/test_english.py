import unittest

from anonymizer import anonymize

AGREEMENT = """# Consultancy Agreement

This Agreement is made between Acme Ltd, a company registered in England and Wales with Companies House number 01234567, whose registered office is at 221B Baker Street, London NW1 6XE (the "Company"), and John Smith, residing at 10 Downing Street, London SW1A 2AA (the "Consultant").

## 1. Services
The Consultant shall provide advisory services. Acme Ltd shall pay the fees of GBP 12,500 within 30 days to IBAN GB82 WEST 1234 5698 7654 32.

## 2. Notices
Notices to the Consultant go to john.smith@example.co.uk or +44 20 7946 0958. Mr Smith may also be reached at +1 (415) 555-0100. The US office is at 1600 Amphitheatre Parkway, Mountain View, CA 94043.

## 3. Governing law
This Agreement is governed by the laws of England and Wales. Disputes are settled by the courts of London.

## 4. Signatures
Name: John Smith
Title: Chief Executive Officer
"""

PII = [
    "Acme",
    "01234567",
    "Baker Street",
    "NW1 6XE",
    "John Smith",
    "Smith",
    "Downing",
    "GB82",
    "john.smith@example.co.uk",
    "7946 0958",
    "555-0100",
    "Amphitheatre",
    "94043",
]


class EnglishAgreementTest(unittest.TestCase):
    def setUp(self):
        self.result = anonymize(AGREEMENT)

    def test_detects_english(self):
        self.assertEqual(self.result.language, "en")

    def test_all_pii_removed(self):
        for value in PII:
            self.assertNotIn(value, self.result.text, value)

    def test_labels(self):
        labels = {s.text: s.label for s in self.result.spans}
        self.assertEqual(labels["Acme Ltd"], "ORG")
        self.assertEqual(labels["01234567"], "COMPANY_NO")
        self.assertEqual(labels["221B Baker Street, London NW1 6XE"], "ADDRESS")
        self.assertEqual(labels["1600 Amphitheatre Parkway, Mountain View, CA 94043"], "ADDRESS")
        self.assertEqual(labels["GB82 WEST 1234 5698 7654 32"], "IBAN")
        self.assertEqual(labels["john.smith@example.co.uk"], "EMAIL")
        self.assertEqual(labels["+44 20 7946 0958"], "PHONE")
        self.assertEqual(labels["+1 (415) 555-0100"], "PHONE")

    def test_surname_shares_placeholder(self):
        placeholders = {s.placeholder for s in self.result.spans if s.text in ("John Smith", "Smith")}
        self.assertEqual(len(placeholders), 1)
        entity = next(e for e in self.result.entities if e.placeholder in placeholders)
        self.assertEqual(entity.value, "John Smith")
        self.assertEqual(entity.count, 3)

    def test_non_pii_kept(self):
        for kept in (
            "laws of England and Wales",
            "courts of London",
            "GBP 12,500",
            "30 days",
            'the "Company"',
            "Title: Chief Executive Officer",
            "## 1. Services",
        ):
            self.assertIn(kept, self.result.text, kept)

    def test_org_mentions_share_placeholder(self):
        placeholders = {s.placeholder for s in self.result.spans if s.text == "Acme Ltd"}
        self.assertEqual(placeholders, {"<ORG_1>"})

    def test_keep_list(self):
        result = anonymize(AGREEMENT, keep=["Acme Ltd"])
        self.assertEqual(result.text.count("Acme Ltd"), 2)
        self.assertNotIn("John Smith", result.text)

    def test_deterministic(self):
        self.assertEqual(anonymize(AGREEMENT).to_dict(), anonymize(AGREEMENT).to_dict())

    def test_idempotent(self):
        again = anonymize(self.result.text)
        self.assertEqual(again.entities, [])
        self.assertEqual(again.text, self.result.text)


class EnglishCuesTest(unittest.TestCase):
    def test_title_line_is_not_a_person(self):
        result = anonymize(
            "Name: Pieter de Vries\nTitle: Chief Operating Officer, Delta Data Engineering B.V.\n"
        )
        labels = {s.text: s.label for s in result.spans}
        self.assertEqual(labels, {"Pieter de Vries": "PERSON", "Delta Data Engineering B.V.": "ORG"})

    def test_honorifics_and_representation(self):
        text = "The Supplier is represented by Jane Doe. Dr Emily Brown and Mrs O'Neil agree. Attn: Mark Lee"
        persons = {s.text for s in anonymize(text, language="en").spans if s.label == "PERSON"}
        self.assertEqual(persons, {"Jane Doe", "Emily Brown", "O'Neil", "Mark Lee"})

    def test_possessive_surname_propagates(self):
        result = anonymize("Name: John Smith\nSmith's obligations survive.", language="en")
        self.assertEqual(result.text, "Name: <PERSON_1>\n<PERSON_1>'s obligations survive.")

    def test_ssn_passport_dob_vat(self):
        text = (
            "Employee SSN 123-45-6789, passport no. X1234567, born on 4 July 1980. "
            "VAT number DE123456789 and PL5260250274."
        )
        labels = {s.text: s.label for s in anonymize(text, language="en").spans}
        self.assertEqual(labels.get("123-45-6789"), "SSN")
        self.assertEqual(labels.get("X1234567"), "PASSPORT")
        self.assertEqual(labels.get("4 July 1980"), "DATE_OF_BIRTH")
        self.assertEqual(labels.get("DE123456789"), "VAT_ID")
        self.assertEqual(labels.get("PL5260250274"), "VAT_ID")

    def test_card_luhn(self):
        labels = {s.text: s.label for s in anonymize("Card 4111 1111 1111 1111 on file.").spans}
        self.assertEqual(labels.get("4111 1111 1111 1111"), "CARD")

    def test_plain_dates_and_amounts_untouched(self):
        text = "This Agreement starts on 1 October 2026. Fees: EUR 2,000,000. See section 12.3."
        self.assertEqual(anonymize(text).spans, [])

    def test_sentence_starters_not_swallowed(self):
        text = "Between Alpha Beta Inc. and This Gamma LLC, the parties agree."
        orgs = [s.text for s in anonymize(text).spans if s.label == "ORG"]
        self.assertEqual(orgs, ["Alpha Beta Inc.", "Gamma LLC"])

    def test_short_surname_after_honorific_joins_full_name(self):
        result = anonymize("Name: Jane Doe\nThe Company employs Ms Doe. Doe Street is elsewhere.")
        self.assertEqual(
            result.text, "Name: <PERSON_1>\nThe Company employs Ms <PERSON_1>. Doe Street is elsewhere."
        )

    def test_ni_number(self):
        labels = {s.text: s.label for s in anonymize("National Insurance number QQ123456C applies.").spans}
        self.assertEqual(labels, {"QQ123456C": "NI_NUMBER"})


if __name__ == "__main__":
    unittest.main()
