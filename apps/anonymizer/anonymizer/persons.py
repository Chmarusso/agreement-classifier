"""Person names: cue-based seeds, clustering of inflected variants, propagation."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from functools import lru_cache

from .spans import (
    INLINE_GAP_RE,
    NAME_PARTICLES,
    NAME_TOKEN_RE,
    P_PERSON,
    Candidate,
    is_initial,
    is_name_word,
)

MAX_NAME_TOKENS = 3
_MIN_PROPAGATED_SURNAME = 4  # shorter lone surnames ("Doe") are only taken after a cue

# --------------------------------------------------------------------------- cues
# Each forward cue is followed by the name: (pattern, min tokens, nominative predicate).

_HONORIFIC_RE = re.compile(r"(?<!\w)(?P<cue>Mr|Mrs|Ms|Miss|Mx|Dr|Prof)\b\.?[ \t]+")
_PL_HONORIFIC_RE = re.compile(r"(?<!\w)(?P<cue>Pan|Pani|Pana|Panem|Panią|Panu)(?!\w)[ \t]+", re.I)
_LABEL_RE = re.compile(
    r"(?<!\w)(?P<cue>full name|name|imię i nazwisko(?:[ \t]*/[ \t]*name)?|attention|attn\.?"
    r"|contact person|osoba kontaktowa|osobą kontaktową"
    # party-role labels in signature blocks: "Najemca: Grzegorz Brzęczyszczykiewicz"
    r"|employee|employer|contractor|consultant|landlord|tenant|pracownik|pracodawca"
    r"|wynajmując[yaą]|najemca|zleceniodawca|zleceniobiorca|wykonawca|zamawiający"
    r"|za[ \t]+[^\n:]{1,60}?)[ \t]*:[ \t]*",
    re.I,
)
_PHRASE_RE = re.compile(
    r"(?<!\w)(?P<cue>represented by|signed by|c/o|contact person|osoba kontaktowa"
    r"|reprezentowan[aąy]\w*[ \t]+przez|w imieniu (?:którego|której) działa"
    r"|(?:wice)?prezes(?:a|em)?[ \t]+zarządu|członk(?:a|iem)[ \t]+zarządu|członek[ \t]+zarządu"
    r"|pełnomocnik(?:a|iem)?|prokurent(?:a|em)?)(?!\w)[ \t]*:?[ \t]*",
    re.I,
)
_OBLIQUE_CUE_RE = re.compile(
    r"^(?:pana|panią|panem|panu|reprezentowan.*|.*(?:a|em|iem) zarządu|\w+(?:a|em|iem))$"
)

# Backward cues follow the name: "Jan Kowalski, zamieszkały w", "Anna Nowak, PESEL".
_BACKWARD_RE = re.compile(
    r"[ \t]*(?:,[ \t]*(?P<cue>zamieszkał\w*|zam\.|legitymując\w*|(?:nr[ \t]+)?PESEL|residing|resident"
    r"|born|holder of|urodzon\w*|ur\.)"
    r"|[ \t]+[–—-][ \t]+(?P<role>(?:wice)?prezes\w*|członk\w*|członek|pełnomocnik\w*|prokurent\w*)"
    r"|[ \t]*\((?:PESEL|born))",
    re.I,
)


def find_person_seeds(text: str) -> list[Candidate]:
    seeds: list[Candidate] = []
    for pattern, min_tokens in (
        (_HONORIFIC_RE, 1),
        (_PL_HONORIFIC_RE, 1),
        (_LABEL_RE, 2),
        (_PHRASE_RE, 2),
    ):
        for m in pattern.finditer(text):
            span = scan_name_forward(text, m.end())
            if span and span[2] >= min_tokens:
                nominative = not _OBLIQUE_CUE_RE.match(" ".join(m.group("cue").casefold().split()))
                seeds.append(Candidate(span[0], span[1], "PERSON", P_PERSON, nominative=nominative))
    for m in _BACKWARD_RE.finditer(text):
        span = scan_name_backward(text, m.start())
        if span and span[2] >= 2:
            nominative = _backward_nominative(m.group("cue"), m.group("role"))
            seeds.append(Candidate(span[0], span[1], "PERSON", P_PERSON, nominative=nominative))
    return seeds


def _backward_nominative(cue: str | None, role: str | None) -> bool:
    # The name agrees in case with a participle cue ("zamieszkałą" -> instrumental) or
    # an apposition role ("– Prezesa Zarządu" -> genitive).
    if role is not None:
        return not role.casefold().endswith("a")
    return cue is None or not cue.casefold().endswith(("ą", "ym", "ego", "ej", "emu"))


def _token_kind(word: str) -> str | None:
    if word in NAME_PARTICLES:
        return "particle"
    if is_initial(word) or is_name_word(word):
        return "name"
    return None


def _finish(tokens: list[tuple[int, int, str]]) -> tuple[int, int, int] | None:
    while tokens and tokens[-1][2] == "particle":
        tokens.pop()
    while tokens and tokens[0][2] == "particle":
        tokens.pop(0)
    names = sum(1 for t in tokens if t[2] == "name")
    if not names:
        return None
    return tokens[0][0], tokens[-1][1], names


def scan_name_forward(text: str, pos: int) -> tuple[int, int, int] | None:
    """(start, end, name token count) of up to 3 capitalised tokens starting at pos."""
    tokens: list[tuple[int, int, str]] = []
    i = pos
    while sum(1 for t in tokens if t[2] == "name") < MAX_NAME_TOKENS:
        j = INLINE_GAP_RE.match(text, i).end()
        if tokens and j == i:
            break
        tok = NAME_TOKEN_RE.match(text, j)
        kind = _token_kind(tok.group()) if tok else None
        if kind is None or (kind == "particle" and not tokens):
            break
        tokens.append((tok.start(), tok.end(), kind))
        i = tok.end()
    if tokens and i < len(text) and (text[i].isalnum() or text[i] == "<"):
        return None  # token glued to something else, e.g. "Name: Anna2"
    return _finish(tokens)


def scan_name_backward(text: str, end: int) -> tuple[int, int, int] | None:
    """(start, end, name token count) of up to 3 capitalised tokens ending at `end`."""
    line_start = text.rfind("\n", 0, end) + 1
    tokens: list[tuple[int, int, str]] = []
    expected_end = end
    for tok in reversed(list(NAME_TOKEN_RE.finditer(text, line_start, end))):
        gap = text[tok.end() : expected_end]
        if gap.strip(" \t") or (tokens and not gap):
            break
        kind = _token_kind(tok.group())
        if kind is None or sum(1 for t in tokens if t[2] == "name") == MAX_NAME_TOKENS:
            break
        tokens.insert(0, (tok.start(), tok.end(), kind))
        expected_end = tok.start()
    return _finish(tokens)


# --------------------------------------------------------------------------- inflection

# Polish case endings; a token's stems are the token minus any of these. Surnames need a
# stem of 3+ chars; given names in a full name may use 2 ("Ewa" / "Ewę" / "Ewy").
_ENDINGS = (
    "owie", "ami", "owi", "ego", "emu", "iem", "ach", "ich", "ych", "ów", "om", "em", "ej",
    "im", "ym", "ie", "ą", "ę", "a", "y", "i", "u", "o",
)  # fmt: skip
_MIN_STEM = 3
_MIN_GIVEN_NAME_STEM = 2
_FLEETING_E = ("ek", "ec", "eł")  # Marek -> Marka, Jacek -> Jacka, Paweł -> Pawła


@lru_cache(maxsize=65536)
def _stems(word: str, min_stem: int = _MIN_STEM) -> frozenset[str]:
    stems = {word}
    for ending in _ENDINGS:
        if word.endswith(ending) and len(word) - len(ending) >= min_stem:
            stems.add(word[: -len(ending)])
    if word.endswith(_FLEETING_E) and len(word) - 1 >= min_stem:
        stems.add(word[:-2] + word[-1])
    # Adjectival surnames: Kowalski / Kowalskiego / Kowalskim share "kowalsk".
    stems |= {s[:-1] for s in stems if s[-1] in "iy" and len(s) > min_stem}
    return frozenset(stems)


def tokens_match(a: str, b: str, inflect: bool, min_stem: int = _MIN_STEM) -> bool:
    a, b = a.casefold(), b.casefold()
    if a == b:
        return True
    if a.endswith(".") or b.endswith("."):  # initial "J." vs "Jan"
        return len(min(a, b, key=len)) == 2 and a[0] == b[0]
    if not inflect:
        return False
    parts_a, parts_b = a.split("-"), b.split("-")
    return len(parts_a) == len(parts_b) and all(
        _stems(x, min_stem) & _stems(y, min_stem) for x, y in zip(parts_a, parts_b)
    )


# --------------------------------------------------------------------------- clusters


@dataclass
class PersonCluster:
    forms: list[tuple[str, ...]] = field(default_factory=list)

    @property
    def surname(self) -> str | None:
        last = max(self.forms, key=len)[-1]
        return None if last.endswith(".") else last

    @property
    def first_name(self) -> str | None:
        longest = max(self.forms, key=len)
        return longest[0] if len(longest) > 1 else None


def name_tokens(surface: str) -> tuple[str, ...]:
    return tuple(NAME_TOKEN_RE.findall(surface))


def _position_matches(word: str, expected: str, is_last: bool, inflect: bool) -> bool:
    min_stem = _MIN_STEM if is_last else _MIN_GIVEN_NAME_STEM
    return tokens_match(word, expected, inflect, min_stem)


def _form_matches(tokens: tuple[str, ...], form: tuple[str, ...], inflect: bool) -> bool:
    return len(tokens) == len(form) and all(
        _position_matches(a, b, k == len(form) - 1, inflect) for k, (a, b) in enumerate(zip(tokens, form))
    )


def find_person_cluster(surface: str, clusters: list[PersonCluster], inflect: bool) -> int | None:
    tokens = name_tokens(surface)
    if not tokens:
        return None
    for i, cluster in enumerate(clusters):
        if any(_form_matches(tokens, form, inflect) for form in cluster.forms):
            return i
    if len(tokens) == 1:
        for i, cluster in enumerate(clusters):
            if cluster.surname and tokens_match(tokens[0], cluster.surname, inflect):
                return i
    return None


def build_person_clusters(surfaces: list[str], inflect: bool) -> list[PersonCluster]:
    clusters: list[PersonCluster] = []
    # Full names first so that a lone surname ("Mr Smith") joins its full name.
    for surface in sorted(surfaces, key=lambda s: -len(name_tokens(s))):
        tokens = name_tokens(surface)
        if not tokens:
            continue
        idx = find_person_cluster(surface, clusters, inflect)
        if idx is None:
            clusters.append(PersonCluster([tokens]))
        elif tokens not in clusters[idx].forms:
            clusters[idx].forms.append(tokens)
    return clusters


def propagate_persons(text: str, clusters: list[PersonCluster], inflect: bool) -> list[Candidate]:
    """Every other mention of a known person: full form, inflected form or lone surname."""
    if not clusters:
        return []
    words = list(NAME_TOKEN_RE.finditer(text))
    out: list[Candidate] = []
    for i, word in enumerate(words):
        if not word.group()[:1].isupper():
            continue
        for cluster in clusters:
            for form in cluster.forms:
                if len(form) == 1:
                    continue  # lone surnames: handled below with a minimum length
                end = _match_at(text, words, i, form, inflect)
                if end is not None:
                    out.append(Candidate(word.start(), end, "PERSON", P_PERSON, source="prop"))
            surname = cluster.surname
            if (
                surname
                and len(surname) >= _MIN_PROPAGATED_SURNAME
                and is_name_word(word.group())
                and tokens_match(word.group(), surname, inflect)
            ):
                start = _initial_before(text, words, i, cluster.first_name)
                out.append(Candidate(start, word.end(), "PERSON", P_PERSON, source="prop"))
    return out


def _match_at(
    text: str, words: list[re.Match[str]], i: int, form: tuple[str, ...], inflect: bool
) -> int | None:
    if i + len(form) > len(words):
        return None
    for k, expected in enumerate(form):
        word = words[i + k]
        if k and text[words[i + k - 1].end() : word.start()] not in (" ", "\t"):
            return None
        is_particle = expected.casefold() in NAME_PARTICLES
        if not is_particle and not word.group()[:1].isupper():
            return None
        if not _position_matches(word.group(), expected, k == len(form) - 1, inflect):
            return None
    return words[i + len(form) - 1].end()


def _initial_before(text: str, words: list[re.Match[str]], i: int, first_name: str | None) -> int:
    """Extend a lone-surname match over a preceding matching initial ("J. Kowalski")."""
    if i and first_name:
        prev = words[i - 1]
        if (
            is_initial(prev.group())
            and prev.group()[0].casefold() == first_name[0].casefold()
            and text[prev.end() : words[i].start()] == " "
        ):
            return prev.start()
    return words[i].start()


def representative(variants: list[tuple[str, bool]]) -> str:
    """Pick the entity value: prefer a full, nominative-looking form."""
    most_tokens = max(len(name_tokens(v)) for v, _ in variants)
    full = [(v, nom) for v, nom in variants if len(name_tokens(v)) == most_tokens]
    for value, nominative in full:
        if nominative:
            return value
    return min(full, key=lambda item: _oblique_score(item[0]))[0]


_OBLIQUE_ENDINGS = ("ego", "emu", "iem", "em", "owi", "ą", "ę", "ej", "im", "ym")


def _oblique_score(value: str) -> int:
    return sum(t.casefold().endswith(_OBLIQUE_ENDINGS) for t in name_tokens(value))
