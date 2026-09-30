"""Shared candidate span type, priorities and small text helpers."""

from __future__ import annotations

import re
from dataclasses import dataclass

# Overlap resolution priority: lower value wins.
P_ID = 0  # checksum-validated or cue-confirmed identifiers
P_STRONG = 1  # EMAIL, IBAN, format-only identifiers
P_ADDRESS = 2
P_ORG = 3
P_PERSON = 4
P_PHONE = 5
P_WEAK = 6  # NER

LABELS = (
    "PESEL",
    "NIP",
    "REGON",
    "KRS",
    "IBAN",
    "BANK_ACCOUNT",
    "ID_CARD",
    "PASSPORT",
    "CARD",
    "VAT_ID",
    "COMPANY_NO",
    "SSN",
    "NI_NUMBER",
    "LAND_REGISTER",
    "DATE_OF_BIRTH",
    "EMAIL",
    "ADDRESS",
    "ORG",
    "PERSON",
    "PHONE",
)
LABEL_RANK = {label: i for i, label in enumerate(LABELS)}


@dataclass(frozen=True, slots=True)
class Candidate:
    start: int
    end: int
    label: str
    priority: int
    cued: bool = False
    # PERSON seeds only: surface form found after a nominative-case cue ("Name:", "Pani").
    nominative: bool = False
    source: str = "rule"  # rule | prop | ner

    @property
    def length(self) -> int:
        return self.end - self.start


def _letters(predicate) -> str:
    return "".join(chr(c) for c in range(0x41, 0x250) if chr(c).isalpha() and predicate(chr(c)))


# Regex character classes for Latin letters incl. Polish/German/French diacritics.
UPPER = "[" + _letters(str.isupper) + "]"
LOWER = "[" + _letters(str.islower) + "]"

# A word, optionally hyphenated ("Nowak-Kowalska") or with an apostrophe before a capital
# ("O'Neil", but not the possessive "Smith's"), or an initial ("J.").
NAME_TOKEN_RE = re.compile(rf"[^\W\d_]\.(?=\s)|[^\W\d_]+(?:-[^\W\d_]+|['’](?={UPPER})[^\W\d_]+)*")

INLINE_GAP_RE = re.compile(r"[ \t]*")
PLACEHOLDER_RE = re.compile(r"<([A-Z][A-Z_]*?)_(\d+)>")

NAME_PARTICLES = frozenset("de van von der den da di du del della le la ter ten bin al".split())

# Capitalised words that are never part of a person name (casefolded).
NON_NAME_WORDS = frozenset(
    """
    the this that these those between and or of for by with to in on at from under upon
    a an as if it its he she they we you our your his her their all any each no not
    party parties agreement contract company supplier customer client provider contractor
    employee employer counterparty processor controller licensor licensee buyer seller
    lender borrower landlord tenant purchaser vendor partner consultant service services
    name title signature signed date place address email e-mail phone tel fax mobile
    section clause article schedule annex appendix exhibit recital recitals background
    chief executive officer director managing manager president vice board member members
    secretary chairman chairwoman head attorney counsel ceo cfo coo cto cio ciso dpo
    pesel nip regon krs iban vat swift bic gdpr rodo eu uk usa us
    ltd llc inc corp plc llp gmbh ag sa sas bv nv
    dear re attention attn note notice for and on behalf behalf witness whereas now
    january february march april may june july august september october november december
    monday tuesday wednesday thursday friday saturday sunday
    umowa umowy umowie umową zawarta zawarte pomiędzy oraz lub przez dla na w z i o do od
    strona strony stroną stron zleceniodawca zleceniodawcy zleceniobiorca zleceniobiorcy
    zamawiający zamawiającego wykonawca wykonawcy pracodawca pracodawcy pracodawcę
    pracownik pracownika pracownikowi spółka spółki spółką spółce
    prezes prezesa zarządu zarząd członek członka pełnomocnik pełnomocnika prokurent
    imię nazwisko podpis podpisy data dnia sąd sądu stanowisko
    pan pani pana panią panem panu mr mrs ms miss mx dr prof
    stycznia lutego marca kwietnia maja czerwca lipca sierpnia września października
    listopada grudnia
    urzędu ochrony danych osobowych kodeksu kodeks prawa prawo rzeczypospolitej polskiej
    """.split()
)


def normalize(value: str) -> str:
    """Collapse whitespace and casefold: the identity key of an entity value."""
    return " ".join(value.split()).casefold()


def is_name_word(word: str) -> bool:
    return word[:1].isupper() and word.casefold().rstrip(".") not in NON_NAME_WORDS


def is_initial(word: str) -> bool:
    return len(word) == 2 and word[1] == "." and word[0].isupper()
