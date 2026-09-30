"""Organisation detection (name + legal form) and propagation to later mentions."""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from .spans import P_ORG, Candidate, normalize

_PL_FORMS = (
    r"sp\.\s?z\s?o\.\s?o\.?",
    r"spółk\w* z ograniczoną odpowiedzialnością",
    r"spółk\w* komandytow\w*(?:-akcyjn\w*)?",
    r"spółk\w* akcyjn\w*",
    r"spółk\w* jawn\w*",
    r"spółk\w* partnersk\w*",
    r"sp\.\s?k\.?",
    r"sp\.\s?j\.?",
    r"sp\.\s?p\.?",
)
_CASED_FORMS = (
    r"S\.K\.A\.",
    r"S\.A\.",
    r"S\.à\s?r\.l\.",
    r"S\.r\.l\.",
    r"S\.p\.A\.",
    r"L\.L\.C\.",
    r"B\.V\.",
    r"N\.V\.",
    r"GmbH(?:\s?&\s?Co\.\s?KG)?",
    r"Ltd\.?",
    r"Limited",
    r"LLC",
    r"LLP",
    r"PLC",
    r"plc",
    r"Inc\.?",
    r"Corp\.?",
    r"Corporation",
    r"AG",
    r"SAS",
    r"SA",
    r"AB",
    r"Oy",
    r"ApS",
    r"A/S",
)
LEGAL_FORM = rf"(?:(?i:{'|'.join(_PL_FORMS)})|{'|'.join(_CASED_FORMS)})"
_LEGAL_FORM_RE = re.compile(rf"(?<![\w.]){LEGAL_FORM}(?!\w)")
_TRAILING_FORM_RE = re.compile(rf",?\s+{LEGAL_FORM}$")

# Tokens between whitespace; punctuation that ends a name is excluded.
_ORG_TOKEN_RE = re.compile(r"[^\s,;:()\[\]\"„”“«»]+")
_CONNECTORS = frozenset({"&", "of", "and", "und", "i", "et", "de", "du", "la", "van", "von", "der", "für"})
# Capitalised words that start a sentence or name a role, never an organisation name.
_ORG_STOP = frozenset(
    """
    the this that these those a an between and or for by with to in on at from under
    party parties name title signature signed date whereas
    umowa umowę zawarta zawarte pomiędzy między oraz a lub przez dla na w z za
    strona strony zleceniodawca zleceniobiorca zamawiający wykonawca pracodawca pracownik
    imię nazwisko podpis stanowisko
    """.split()
)
_OPEN_QUOTES = "\"„“«'‘"
_CLOSE_QUOTES = "\"”“»'’"
_MAX_NAME_TOKENS = 6


def find_org_seeds(text: str) -> list[Candidate]:
    seeds = []
    for form in _LEGAL_FORM_RE.finditer(text):
        start = _name_start(text, form.start())
        if start is not None:
            seeds.append(Candidate(start, form.end(), "ORG", P_ORG))
    return seeds


def _name_start(text: str, form_start: int) -> int | None:
    """Start of the organisation name directly before a legal form, or None."""
    line_start = text.rfind("\n", 0, form_start) + 1
    before = text[line_start:form_start]
    stripped = before.rstrip(" \t")
    if len(stripped) == len(before):
        return None  # legal form glued to the previous word
    if stripped.endswith(tuple(_CLOSE_QUOTES)):
        return _quoted_start(text, line_start, line_start + len(stripped) - 1)
    stripped = stripped.removesuffix(",")  # "Acme, Inc."
    tokens = list(_ORG_TOKEN_RE.finditer(text, line_start, line_start + len(stripped)))
    start: int | None = None
    count = 0
    expected_end = line_start + len(stripped)
    for tok in reversed(tokens):
        word = tok.group()
        gap = text[tok.end() : expected_end]
        if gap.strip(" \t") or (start is not None and not gap):
            break
        if word.casefold() in _CONNECTORS and start is not None:
            expected_end = tok.start()
            continue
        if not _is_org_word(word) or count == _MAX_NAME_TOKENS:
            break
        start, count, expected_end = tok.start(), count + 1, tok.start()
    return start


def _is_org_word(word: str) -> bool:
    first = word[0]
    if not (first.isupper() or (first.isdigit() and any(c.isalpha() for c in word))):
        return False
    return word.casefold() not in _ORG_STOP


def _quoted_start(text: str, line_start: int, close_idx: int) -> int | None:
    for i in range(close_idx - 1, max(line_start, close_idx - 100) - 1, -1):
        if text[i] in _OPEN_QUOTES:
            inner = text[i + 1 : close_idx].strip()
            return i if inner and inner[0].isupper() or inner[:1].isdigit() else None
    return None


def base_name(value: str) -> str | None:
    """Organisation name without legal form and quotes, if distinctive enough to propagate."""
    base = _TRAILING_FORM_RE.sub("", " ".join(value.split())).strip(_OPEN_QUOTES + _CLOSE_QUOTES + " ")
    tokens = base.split()
    if len(tokens) >= 2:
        return base
    if len(tokens) == 1 and is_distinctive(tokens[0]):
        return base
    return None


def is_distinctive(word: str) -> bool:
    # "CloudVista", "ACME", "4Finance": unlikely to be an ordinary word.
    inner_caps = any(c.isupper() for c in word[1:])
    return len(word) >= 3 and (inner_caps or any(c.isdigit() for c in word))


@dataclass
class OrgCluster:
    names: set[str] = field(default_factory=set)  # normalised full names and base name


def build_org_clusters(surfaces: list[str]) -> list[OrgCluster]:
    clusters: list[OrgCluster] = []
    for surface in surfaces:
        keys = {normalize(surface)}
        base = base_name(surface)
        if base:
            keys.add(normalize(base))
        cluster = next((c for c in clusters if c.names & keys), None)
        if cluster is None:
            clusters.append(OrgCluster(set(keys)))
        else:
            cluster.names |= keys
    return clusters


def find_org_cluster(surface: str, clusters: list[OrgCluster]) -> int | None:
    key = normalize(surface)
    base = base_name(surface)
    base_key = normalize(base) if base else None
    for i, cluster in enumerate(clusters):
        if key in cluster.names or (base_key and base_key in cluster.names):
            return i
    return None


def propagate_orgs(text: str, clusters: list[OrgCluster]) -> list[Candidate]:
    out = []
    for cluster in clusters:
        for name in cluster.names:
            words = name.split(" ")
            pattern = r"(?<!\w)" + r"[ \t]+".join(map(re.escape, words)) + r"(?!\w)"
            for m in re.finditer(pattern, text, re.IGNORECASE):
                if m.group()[0].islower():
                    continue  # "time" is not a mention of an organisation called "Time"
                out.append(Candidate(m.start(), m.end(), "ORG", P_ORG, source="prop"))
    return out
