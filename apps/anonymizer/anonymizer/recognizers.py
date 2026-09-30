"""Pattern and checksum recognizers: identifiers, contacts, addresses, dates of birth."""

from __future__ import annotations

import re
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from datetime import date

from .spans import LOWER, P_ADDRESS, P_ID, P_PHONE, P_STRONG, UPPER, Candidate

# --------------------------------------------------------------------------- checksums

_PESEL_WEIGHTS = (1, 3, 7, 9, 1, 3, 7, 9, 1, 3)
_NIP_WEIGHTS = (6, 5, 7, 2, 3, 4, 5, 6, 7)
_REGON9_WEIGHTS = (8, 9, 2, 3, 4, 5, 6, 7)
_REGON14_WEIGHTS = (2, 4, 8, 5, 0, 9, 7, 3, 6, 1, 2, 4, 8)
_ID_CARD_WEIGHTS = (7, 3, 1, 9, 7, 3, 1, 7, 3)
_PESEL_CENTURY = {0: 1900, 20: 2000, 40: 2100, 60: 2200, 80: 1800}


def _digits(value: str) -> list[int]:
    return [int(c) for c in value if c.isdigit()]


def _weighted(digits: list[int], weights: tuple[int, ...]) -> int:
    return sum(d * w for d, w in zip(digits, weights))


def valid_pesel(value: str) -> bool:
    d = _digits(value)
    if len(d) != 11 or (10 - _weighted(d, _PESEL_WEIGHTS) % 10) % 10 != d[10]:
        return False
    encoded_month = d[2] * 10 + d[3]
    month = (encoded_month - 1) % 20 + 1
    century = _PESEL_CENTURY.get(encoded_month - month)
    if century is None or month > 12:
        return False
    try:
        date(century + d[0] * 10 + d[1], month, d[4] * 10 + d[5])
    except ValueError:
        return False
    return True


def valid_nip(value: str) -> bool:
    d = _digits(value)
    if len(d) != 10 or not any(d):
        return False
    check = _weighted(d, _NIP_WEIGHTS) % 11
    return check != 10 and check == d[9]


def valid_regon(value: str) -> bool:
    d = _digits(value)
    if len(d) == 9:
        weights = _REGON9_WEIGHTS
    elif len(d) == 14:
        weights = _REGON14_WEIGHTS
    else:
        return False
    return any(d) and _weighted(d, weights) % 11 % 10 == d[-1]


def valid_iban(value: str) -> bool:
    s = re.sub(r"\s", "", value).upper()
    if not re.fullmatch(r"[A-Z]{2}\d{2}[A-Z0-9]{11,30}", s):
        return False
    rearranged = s[4:] + s[:4]
    return int("".join(str(int(c, 36)) for c in rearranged)) % 97 == 1


def valid_nrb(value: str) -> bool:
    """Polish 26-digit account number (NRB): an IBAN without the PL prefix."""
    digits = re.sub(r"\D", "", value)
    return len(digits) == 26 and valid_iban("PL" + digits)


def valid_luhn(value: str) -> bool:
    d = _digits(value)
    if len(d) < 2:
        return False
    total = 0
    for i, digit in enumerate(reversed(d)):
        if i % 2:
            digit *= 2
            digit -= 9 if digit > 9 else 0
        total += digit
    return total % 10 == 0


def valid_id_card(value: str) -> bool:
    """Polish ID card (dowód osobisty): 3 letters + 6 digits, first digit is the check digit."""
    s = re.sub(r"\s", "", value).upper()
    if not re.fullmatch(r"[A-Z]{3}\d{6}", s):
        return False
    values = [int(c, 36) for c in s]
    return sum(v * w for v, w in zip(values, _ID_CARD_WEIGHTS)) % 10 == 0


def valid_ssn(value: str) -> bool:
    m = re.fullmatch(r"(\d{3})-(\d{2})-(\d{4})", value)
    if not m:
        return False
    area, group, serial = m.groups()
    return area not in ("000", "666") and area[0] != "9" and group != "00" and serial != "0000"


def valid_card(value: str) -> bool:
    d = _digits(value)
    return 13 <= len(d) <= 19 and valid_luhn(value)


# --------------------------------------------------------------------------- cues


def _cue(pattern: str) -> re.Pattern[str]:
    # The cue must end the window, followed only by non-digit filler ("PESEL: ", "KRS number ").
    return re.compile(rf"(?:{pattern})[^\d\n]{{0,25}}$", re.IGNORECASE)


_CUES = {
    "PESEL": _cue(r"\bPESEL\b"),
    "NIP": _cue(r"\bNIP\b|tax identification number|numer identyfikacji podatkowej"),
    "REGON": _cue(r"\bREGON\b"),
    "KRS": _cue(r"\bKRS\b|national court register|krajow\w* rejestr\w*"),
    "ACCOUNT": _cue(r"\bIBAN\b|\bNRB\b|account|rachun\w*|\bkont[oa]\b"),
    "ID_CARD": _cue(r"dow[oó]d\w*|\bID card|identity card|seria i numer|\bID\b"),
    "PASSPORT": _cue(r"passport|paszport\w*"),
    "CARD": _cue(r"\bcard\b|kart\w*"),
    "VAT_ID": _cue(r"\bVAT\b|\bNIP\b|\bUSt-IdNr\b|tax"),
    "COMPANY_NO": _cue(r"compan(?:y|ies)\b|registered (?:number|no)|registration (?:number|no)|\bCRN\b"),
    "SSN": _cue(r"\bSSN\b|social security"),
    "NI_NUMBER": _cue(r"national insurance|\bNINO\b|\bNI\b"),
    "LAND_REGISTER": _cue(r"księg\w* wieczyst\w*|\bKW\b|land register"),
}


def has_cue(text: str, start: int, cue: re.Pattern[str]) -> bool:
    line_start = text.rfind("\n", 0, start) + 1
    return cue.search(text, max(line_start, start - 80), start) is not None


# --------------------------------------------------------------------------- identifiers

_B = r"(?<![\w-])"  # left boundary for numbers
_E = r"(?![\w-])"  # right boundary


@dataclass(frozen=True, slots=True)
class IdSpec:
    label: str
    pattern: re.Pattern[str]
    cue: re.Pattern[str]
    validator: Callable[[str], bool] | None  # None: accepted only with a cue
    # Priority when validated without a cue; format-only checks are weaker than checksums.
    validated_priority: int = P_ID


_EU_VAT_PREFIX = "AT|BE|BG|CY|CZ|DE|DK|EE|EL|ES|FI|FR|GB|HR|HU|IE|IT|LT|LU|LV|MT|NL|PL|PT|RO|SE|SI|SK|XI"


def _valid_vat(value: str) -> bool:
    compact = value.replace(" ", "")
    if compact.startswith("PL"):
        return valid_nip(compact[2:])
    return sum(c.isdigit() for c in compact) >= 8


def _valid_ni_number(value: str) -> bool:
    # QQ is the documented example prefix, but it is still treated as a real number.
    return value[0] not in "DFIUV" and value[:2] not in {"BG", "GB", "NK", "KN", "TN", "NT", "ZZ"}


def _valid_card_uncued(value: str) -> bool:
    return value[0] in "23456" and valid_card(value)


ID_SPECS: tuple[IdSpec, ...] = (
    IdSpec("PESEL", re.compile(rf"{_B}\d{{11}}{_E}"), _CUES["PESEL"], valid_pesel),
    IdSpec(
        "NIP",
        re.compile(
            rf"{_B}(?:\d{{3}}-\d{{3}}-\d{{2}}-\d{{2}}|\d{{3}}-\d{{2}}-\d{{2}}-\d{{3}}"
            rf"|\d{{3}} \d{{3}} \d{{2}} \d{{2}}|\d{{10}}){_E}"
        ),
        _CUES["NIP"],
        valid_nip,
    ),
    IdSpec("REGON", re.compile(rf"{_B}(?:\d{{9}}|\d{{14}}){_E}"), _CUES["REGON"], valid_regon),
    IdSpec("KRS", re.compile(rf"{_B}\d{{10}}{_E}"), _CUES["KRS"], None),
    IdSpec(
        "BANK_ACCOUNT",
        re.compile(rf"{_B}\d{{2}}(?: ?\d{{4}}){{6}}{_E}"),
        _CUES["ACCOUNT"],
        valid_nrb,
    ),
    IdSpec("ID_CARD", re.compile(rf"{_B}[A-Z]{{3}} ?\d{{6}}{_E}"), _CUES["ID_CARD"], valid_id_card),
    IdSpec(
        "PASSPORT",
        re.compile(rf"{_B}(?:[A-Z]{{1,2}} ?\d{{6,9}}|(?=[A-Z]*\d)[A-Z0-9]{{6,9}}){_E}"),
        _CUES["PASSPORT"],
        None,
    ),
    IdSpec("CARD", re.compile(rf"{_B}\d(?:[ -]?\d){{12,18}}{_E}"), _CUES["CARD"], _valid_card_uncued),
    IdSpec(
        "VAT_ID",
        re.compile(rf"(?<![\w-])(?:{_EU_VAT_PREFIX}) ?[0-9A-Z]{{8,12}}(?![\w-])"),
        _CUES["VAT_ID"],
        _valid_vat,
        validated_priority=P_STRONG,
    ),
    IdSpec(
        "COMPANY_NO",
        re.compile(rf"{_B}(?:\d{{8}}|(?:SC|NI|OC|SO|NC)\d{{6}}){_E}"),
        _CUES["COMPANY_NO"],
        None,
    ),
    IdSpec(
        "NI_NUMBER",
        re.compile(rf"{_B}[A-Z]{{2}} ?\d{{2}} ?\d{{2}} ?\d{{2}} ?[A-D]{_E}"),
        _CUES["NI_NUMBER"],
        _valid_ni_number,
        validated_priority=P_STRONG,
    ),
    IdSpec(
        # Polish land register (księga wieczysta): court code / number / check digit.
        "LAND_REGISTER",
        re.compile(r"(?<![\w/])[A-Z]{2}\d[A-Z]/\d{8}/\d(?![\w/])"),
        _CUES["LAND_REGISTER"],
        lambda _: True,  # the format alone is distinctive
        validated_priority=P_STRONG,
    ),
    IdSpec(
        "SSN",
        re.compile(rf"{_B}\d{{3}}-\d{{2}}-\d{{4}}{_E}"),
        _CUES["SSN"],
        valid_ssn,
        validated_priority=P_STRONG,
    ),
)

_HRB_RE = re.compile(r"(?<!\w)HR[AB] ?\d{3,6}(?: ?[A-Z])?(?!\w)")
_IBAN_RE = re.compile(r"(?<!\w)[A-Z]{2}\d{2}(?: ?[A-Z0-9]){11,30}(?!\w)")


def find_identifiers(text: str) -> Iterator[Candidate]:
    for spec in ID_SPECS:
        for m in spec.pattern.finditer(text):
            cued = has_cue(text, m.start(), spec.cue)
            if cued:
                yield Candidate(m.start(), m.end(), spec.label, P_ID, cued=True)
            elif spec.validator is not None and spec.validator(m.group()):
                yield Candidate(m.start(), m.end(), spec.label, spec.validated_priority)
    for m in _HRB_RE.finditer(text):
        yield Candidate(m.start(), m.end(), "COMPANY_NO", P_STRONG)
    yield from _find_ibans(text)


def _find_ibans(text: str) -> Iterator[Candidate]:
    # The pattern may run into a following uppercase word ("... 2874 BIC"): trim at spaces
    # from the right until the checksum validates.
    for m in _IBAN_RE.finditer(text):
        raw = m.group()
        cut_points = [len(raw)] + [i for i in range(len(raw) - 1, 0, -1) if raw[i] == " "]
        for cut in cut_points:
            if valid_iban(raw[:cut]):
                yield Candidate(m.start(), m.start() + cut, "IBAN", P_ID)
                break
        else:
            if has_cue(text, m.start(), _CUES["ACCOUNT"]):
                yield Candidate(m.start(), m.end(), "IBAN", P_STRONG, cued=True)


# --------------------------------------------------------------------------- email, phone

_EMAIL_RE = re.compile(r"(?<![\w.+-])[\w.+-]+@[\w-]+(?:\.[\w-]+)*\.[A-Za-z]{2,}(?![\w-])")

_PHONE_PATTERNS = (
    # +48 600 700 800, +44 20 7946 0958, +1 (415) 555-0100
    re.compile(r"(?<![\w+])\+\d{1,3}(?:[ .-]?\(\d{1,4}\))?(?:[ .-]?\d{1,4}){2,5}(?!\w)"),
    # (22) 123 45 67
    re.compile(r"(?<![\w(])\(\d{2}\) ?\d{3}[ -]?\d{2}[ -]?\d{2}(?![\w-])"),
    # (415) 555-0100
    re.compile(r"(?<![\w(])\(\d{3}\) ?\d{3}[ -]\d{4}(?![\w-])"),
    # 600-700-800, 600 700 800 (not inside a longer digit group such as an amount)
    re.compile(r"(?<![\w.+/-])(?<!\d )\d{3}([ .-])\d{3}\1\d{3}(?![\w-])(?! \d)"),
    # 415-555-0100
    re.compile(r"(?<![\w.+/-])\d{3}[.-]\d{3}[.-]\d{4}(?![\w-])"),
)
_PHONE_CUE_RE = re.compile(
    r"(?<!\w)(?:tel(?:efon\w*)?|phone|mobile|mob|fax|kom|cell)\.?[ \t]*(?:no\.?|nr\.?)?"
    r"[ \t]*[:.]?[ \t]*(?P<num>\+?[\d(][\d ().-]{5,20}\d)",
    re.IGNORECASE,
)
_CURRENCY_RE = re.compile(r"zł|PLN|EUR|USD|GBP|CHF|€|\$|£", re.IGNORECASE)


def _plausible_phone(text: str, start: int, end: int) -> bool:
    digits = sum(c.isdigit() for c in text[start:end])
    if not 7 <= digits <= 15:
        return False
    context = text[max(0, start - 6) : start] + text[end : end + 6]
    return _CURRENCY_RE.search(context) is None


def find_contacts(text: str) -> Iterator[Candidate]:
    for m in _EMAIL_RE.finditer(text):
        yield Candidate(m.start(), m.end(), "EMAIL", P_STRONG)
    for pattern in _PHONE_PATTERNS:
        for m in pattern.finditer(text):
            if _plausible_phone(text, m.start(), m.end()):
                yield Candidate(m.start(), m.end(), "PHONE", P_PHONE)
    for m in _PHONE_CUE_RE.finditer(text):
        start, end = m.span("num")
        if 7 <= sum(c.isdigit() for c in text[start:end]) <= 15:
            yield Candidate(start, end, "PHONE", P_PHONE, cued=True)


# --------------------------------------------------------------------------- addresses

_CITY = rf"{UPPER}{LOWER}+(?:[ -]{UPPER}{LOWER}+){{0,2}}"
_HOUSE = r"\d{1,4}[A-Za-z]?(?:[ \t]?/[ \t]?\d{1,4}[A-Za-z]?)?(?:[ \t]+(?:lok\.|m\.)[ \t]?\d{1,4})?"
_PL_POSTAL_CITY = rf"\d{{2}}-\d{{3}}[ \t]+{_CITY}"
_EU_POSTAL = r"\d{2}-\d{3}|\d{5}|\d{3} \d{2}"
_UK_POSTCODE = r"[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2}"
_US_STATE = (
    "AL|AK|AZ|AR|CA|CO|CT|DE|DC|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ"
    "|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY"
)
_STREET_SUFFIX = (
    r"(?:Street|St\.|Road|Rd\.|Avenue|Ave\.|Lane|Ln\.|Drive|Dr\.|Boulevard|Blvd\.|Parkway"
    r"|Pkwy\.|Way|Place|Square|Court|Terrace|Close|Crescent|Highway|Row|Gardens|Walk|Mews|Hill)"
)

_ADDRESS_PATTERNS = (
    # ul. Marszałkowska 10/12, 00-590 Warszawa
    re.compile(
        rf"(?<![\w.@/])(?:[uU]l\.|[aA]l\.|[pP]l\.|[oO]s\.|ulica|aleja)[ \t]*{UPPER}"
        rf"[^\d\n,;()]{{0,40}}?[ \t]+{_HOUSE}(?:,?[ \t]+{_PL_POSTAL_CITY})?"
    ),
    # Kungsgatan 8, 111 43 Stockholm / Rosenthaler Straße 40, 10178 Berlin
    re.compile(
        rf"(?<![\w-]){UPPER}{LOWER}+(?:[ -]{UPPER}?{LOWER}+){{0,3}}[ \t]+{_HOUSE},[ \t]*"
        rf"(?:{_EU_POSTAL})[ \t]+{_CITY}"
    ),
    # 221B Baker Street, London NW1 6XE / 1600 Amphitheatre Parkway, Mountain View, CA 94043
    re.compile(
        rf"(?<![\w-])\d{{1,5}}[A-Za-z]?(?:-\d{{1,5}})?[ \t]+(?:{UPPER}[\w'’.-]*[ \t]+){{1,3}}"
        rf"{_STREET_SUFFIX}(?!\w)"
        rf"(?:,[ \t]*(?:Suite|Ste\.|Floor|Unit|Apt\.|Apartment|Flat)[ \t]*[\w-]+)?"
        rf"(?:,[ \t]*{_CITY})?"
        rf"(?:,?[ \t]+{_UK_POSTCODE}(?!\w)|,[ \t]*(?:{_US_STATE})[ \t]+\d{{5}}(?:-\d{{4}})?)?"
    ),
    # 00-590 Warszawa
    re.compile(rf"(?<![\w-]){_PL_POSTAL_CITY}"),
    # London EC1A 1BB
    re.compile(rf"(?<![\w-]){_CITY}[ \t]+{_UK_POSTCODE}(?!\w)"),
    # Mountain View, CA 94043
    re.compile(rf"(?<![\w-]){_CITY},[ \t]*(?:{_US_STATE})[ \t]+\d{{5}}(?:-\d{{4}})?(?![\w-])"),
)

# First words that make "<Word> <number>, <postal> <City>" a reference, not a street.
_NOT_STREET = frozenset(
    """
    section clause article schedule annex appendix exhibit paragraph part chapter rule
    regulation directive note page table step level version phase stage tier item point
    rozdział artykuł art punkt pkt ustęp ust załącznik paragraf
    """.split()
)


def find_addresses(text: str) -> Iterator[Candidate]:
    for pattern in _ADDRESS_PATTERNS:
        for m in pattern.finditer(text):
            first_word = m.group().split(None, 1)[0].casefold().rstrip(".")
            if first_word not in _NOT_STREET:
                yield Candidate(m.start(), m.end(), "ADDRESS", P_ADDRESS)


# --------------------------------------------------------------------------- date of birth

_MONTHS = (
    "january|february|march|april|may|june|july|august|september|october|november|december"
    "|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec"
    "|stycznia|lutego|marca|kwietnia|maja|czerwca|lipca|sierpnia|września|października"
    "|listopada|grudnia"
)
_DOB_RE = re.compile(
    r"(?<!\w)(?:born(?:[ \t]+on)?|date[ \t]+of[ \t]+birth|DOB|d\.o\.b\.|data[ \t]+urodzenia"
    r"|urodzon[yaąej]+(?:[ \t]+w[ \t]+[^\W\d_]+)?(?:[ \t]+dnia)?|ur\.)[ \t]*[:,]?[ \t]*"
    r"(?:on[ \t]+|dnia[ \t]+)?"
    rf"(?P<date>\d{{4}}-\d{{2}}-\d{{2}}|\d{{1,2}}[./-]\d{{1,2}}[./-]\d{{2,4}}"
    rf"|\d{{1,2}}(?:st|nd|rd|th)?[ \t]+(?:{_MONTHS})\.?[ \t]+\d{{4}}(?:[ \t]?r\.)?"
    rf"|(?:{_MONTHS})\.?[ \t]+\d{{1,2}}(?:st|nd|rd|th)?,?[ \t]+\d{{4}})",
    re.IGNORECASE,
)


def find_dates_of_birth(text: str) -> Iterator[Candidate]:
    for m in _DOB_RE.finditer(text):
        yield Candidate(m.start("date"), m.end("date"), "DATE_OF_BIRTH", P_ID, cued=True)


def find_structured(text: str) -> list[Candidate]:
    """All regex/checksum recognizers except ORG and PERSON."""
    return [
        *find_identifiers(text),
        *find_contacts(text),
        *find_addresses(text),
        *find_dates_of_birth(text),
    ]
