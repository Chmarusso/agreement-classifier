import unittest

from anonymizer.recognizers import (
    valid_card,
    valid_iban,
    valid_id_card,
    valid_luhn,
    valid_nip,
    valid_nrb,
    valid_pesel,
    valid_regon,
    valid_ssn,
)


class PeselTest(unittest.TestCase):
    def test_valid(self):
        self.assertTrue(valid_pesel("44051401359"))
        self.assertTrue(valid_pesel("92031507849"))
        self.assertTrue(valid_pesel("02270803624"))  # born 2002 (month + 20)

    def test_invalid_checksum(self):
        self.assertFalse(valid_pesel("44051401358"))

    def test_invalid_date_or_length(self):
        self.assertFalse(valid_pesel("44133001350"))  # checksum ok, month 13
        self.assertFalse(valid_pesel("4405140135"))


class NipTest(unittest.TestCase):
    def test_valid_formats(self):
        for value in ("5260250274", "526-025-02-74", "526-02-50-274"):
            self.assertTrue(valid_nip(value), value)

    def test_invalid(self):
        self.assertFalse(valid_nip("5260250275"))
        self.assertFalse(valid_nip("0000000000"))
        self.assertFalse(valid_nip("526025027"))


class RegonTest(unittest.TestCase):
    def test_regon9(self):
        self.assertTrue(valid_regon("123456785"))
        self.assertFalse(valid_regon("123456786"))

    def test_regon14(self):
        self.assertTrue(valid_regon("12345678512347"))
        self.assertFalse(valid_regon("12345678512348"))


class IbanTest(unittest.TestCase):
    def test_valid(self):
        for value in (
            "PL61109010140000071219812874",
            "PL61 1090 1014 0000 0712 1981 2874",
            "GB82WEST12345698765432",
            "DE89370400440532013000",
        ):
            self.assertTrue(valid_iban(value), value)

    def test_invalid(self):
        self.assertFalse(valid_iban("PL61109010140000071219812875"))
        self.assertFalse(valid_iban("GB82WEST12345698765431"))
        self.assertFalse(valid_iban("DE8937040044"))

    def test_nrb_without_prefix(self):
        self.assertTrue(valid_nrb("61 1090 1014 0000 0712 1981 2874"))
        self.assertFalse(valid_nrb("62 1090 1014 0000 0712 1981 2874"))


class OtherChecksumsTest(unittest.TestCase):
    def test_luhn(self):
        self.assertTrue(valid_luhn("4111111111111111"))
        self.assertTrue(valid_card("4111 1111 1111 1111"))
        self.assertFalse(valid_luhn("4111111111111112"))
        self.assertFalse(valid_card("411111111111"))  # too short for a card

    def test_id_card(self):
        self.assertTrue(valid_id_card("ABA300000"))
        self.assertTrue(valid_id_card("ABA 300000"))
        self.assertFalse(valid_id_card("ABA400000"))

    def test_ssn_format(self):
        self.assertTrue(valid_ssn("123-45-6789"))
        self.assertFalse(valid_ssn("000-45-6789"))
        self.assertFalse(valid_ssn("666-45-6789"))


if __name__ == "__main__":
    unittest.main()
