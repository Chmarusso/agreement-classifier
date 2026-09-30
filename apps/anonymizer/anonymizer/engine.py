"""Anonymization pipeline: detect, resolve overlaps, propagate, assign placeholders."""

from __future__ import annotations

import bisect
import re
from collections.abc import Iterable, Sequence
from dataclasses import asdict, dataclass, field
from typing import Protocol

from . import orgs, persons
from .language import detect_language
from .recognizers import find_structured
from .spans import LABEL_RANK, LABELS, PLACEHOLDER_RE, Candidate, normalize

SUPPORTED_LANGUAGES = ("pl", "en")
_ID_LABELS = frozenset(
    {"PESEL", "NIP", "REGON", "KRS", "IBAN", "BANK_ACCOUNT", "ID_CARD", "PASSPORT", "CARD",
     "VAT_ID", "COMPANY_NO", "SSN", "NI_NUMBER", "LAND_REGISTER", "PHONE"}
)  # fmt: skip


class NerBackend(Protocol):
    name: str

    def candidates(self, text: str, language: str, model: str | None = None) -> list[Candidate]: ...


@dataclass(slots=True, frozen=True)
class Options:
    """Per-request techniques; the defaults are the full pipeline.

    labels: entity types to replace (None means all).
    person_cues: find names from cue phrases ("Name:", "reprezentowana przez", "Pani").
    propagate: replace later mentions of a found name or company ("Mr Smith", "Wisła Data").
    inflection: link Polish case forms of a name (Anna Kowalska, Annę Kowalską).
    ner: use the NER model when the service has one.
    ner_models: model name per language, chosen from the installed ones; None keeps the default.
    """

    labels: frozenset[str] | None = None
    person_cues: bool = True
    propagate: bool = True
    inflection: bool = True
    ner: bool = True
    ner_models: dict[str, str] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, raw: dict | None) -> Options:
        raw = raw or {}
        labels = raw.get("labels")
        if labels is not None:
            if not isinstance(labels, list) or not all(isinstance(x, str) for x in labels):
                raise ValueError('"options.labels" must be a list of strings')
            unknown = sorted(set(labels) - set(LABELS))
            if unknown:
                raise ValueError(f"unknown labels: {', '.join(unknown)}")
        models = raw.get("ner_models") or {}
        if not isinstance(models, dict) or not all(isinstance(k, str) and isinstance(v, str) for k, v in models.items()):
            raise ValueError('"options.ner_models" must map a language to a model name')
        flags = {}
        for name in ("person_cues", "propagate", "inflection", "ner"):
            value = raw.get(name, True)
            if not isinstance(value, bool):
                raise ValueError(f'"options.{name}" must be true or false')
            flags[name] = value
        return cls(labels=None if labels is None else frozenset(labels), ner_models=dict(models), **flags)

    def allows(self, label: str) -> bool:
        return self.labels is None or label in self.labels


@dataclass(slots=True)
class Entity:
    placeholder: str
    label: str
    value: str
    count: int
    variants: list[str]


@dataclass(slots=True)
class Span:
    start: int
    end: int
    label: str
    placeholder: str
    text: str


@dataclass(slots=True)
class AnonymizationResult:
    text: str
    language: str
    engine: str
    entities: list[Entity] = field(default_factory=list)
    spans: list[Span] = field(default_factory=list)

    def to_dict(self) -> dict:
        return asdict(self)


class Anonymizer:
    def __init__(self, ner: NerBackend | None = None):
        self.ner = ner

    @property
    def engine_name(self) -> str:
        return "rules+spacy" if self.ner else "rules"

    def anonymize(
        self, text: str, language: str | None = None, keep: Iterable[str] = (), options: Options | None = None
    ) -> AnonymizationResult:
        if language is not None and language not in SUPPORTED_LANGUAGES:
            raise ValueError(f"unsupported language: {language!r}")
        opts = options or Options()
        lang = language or detect_language(text)
        inflect = lang == "pl" and opts.inflection
        blocked = _Intervals(_blocked_ranges(text, keep))
        use_ner = self.ner is not None and opts.ner

        candidates = [*find_structured(text), *orgs.find_org_seeds(text)]
        if opts.person_cues:
            candidates += persons.find_person_seeds(text)
        if use_ner:
            candidates += self.ner.candidates(text, lang, opts.ner_models.get(lang))
        first_pass = resolve(
            c for c in candidates if opts.allows(c.label) and not blocked.overlaps(c.start, c.end)
        )

        person_clusters = persons.build_person_clusters(
            [text[c.start : c.end] for c in first_pass if c.label == "PERSON"], inflect
        )
        org_clusters = orgs.build_org_clusters(
            [text[c.start : c.end] for c in first_pass if c.label == "ORG"]
        )
        propagated = (
            [*persons.propagate_persons(text, person_clusters, inflect), *orgs.propagate_orgs(text, org_clusters)]
            if opts.propagate
            else []
        )
        final = resolve([*first_pass, *(c for c in propagated if not blocked.overlaps(c.start, c.end))])

        def entity_key(c: Candidate) -> str:
            surface = text[c.start : c.end]
            idx: int | None = None
            if c.label == "PERSON":
                idx = persons.find_person_cluster(surface, person_clusters, inflect)
            elif c.label == "ORG":
                idx = orgs.find_org_cluster(surface, org_clusters)
            if idx is not None:
                return f"{c.label}#{idx}"
            return f"{c.label}:{_canonical(c.label, surface)}"

        return _render(text, lang, "rules+spacy" if use_ner else "rules", final, entity_key)


def anonymize(text: str, language: str | None = None, keep: Iterable[str] = ()) -> AnonymizationResult:
    """Rules-only convenience wrapper."""
    return Anonymizer().anonymize(text, language, keep)


def deanonymize(text: str, entities: Sequence[Entity | dict]) -> str:
    """Replace placeholders with entity values; longest placeholder first (<PERSON_10> vs _1)."""
    mapping = {}
    for e in entities:
        placeholder, value = (
            (e["placeholder"], e["value"]) if isinstance(e, dict) else (e.placeholder, e.value)
        )
        mapping[placeholder] = value
    if not mapping:
        return text
    pattern = "|".join(re.escape(p) for p in sorted(mapping, key=len, reverse=True))
    return re.sub(pattern, lambda m: mapping[m.group()], text)


# --------------------------------------------------------------------------- resolution


class _Intervals:
    """Sorted non-overlapping half-open intervals with overlap queries."""

    def __init__(self, ranges: Iterable[tuple[int, int]] = ()):
        self._starts: list[int] = []
        self._ends: list[int] = []
        for start, end in sorted(ranges):
            if self._ends and start < self._ends[-1]:
                self._ends[-1] = max(self._ends[-1], end)
            else:
                self._starts.append(start)
                self._ends.append(end)

    def overlaps(self, start: int, end: int) -> bool:
        i = bisect.bisect_right(self._starts, start)
        if i and self._ends[i - 1] > start:
            return True
        return i < len(self._starts) and self._starts[i] < end

    def add(self, start: int, end: int) -> None:
        i = bisect.bisect_right(self._starts, start)
        self._starts.insert(i, start)
        self._ends.insert(i, end)


def resolve(candidates: Iterable[Candidate]) -> list[Candidate]:
    """Greedy overlap resolution: priority, then length, then cue, then label rank."""
    ordered = sorted(
        {c for c in candidates if c.end > c.start},
        key=lambda c: (c.priority, -c.length, not c.cued, not c.nominative, LABEL_RANK[c.label], c.start),
    )
    taken = _Intervals()
    accepted = []
    for c in ordered:
        if not taken.overlaps(c.start, c.end):
            taken.add(c.start, c.end)
            accepted.append(c)
    return sorted(accepted, key=lambda c: c.start)


def _blocked_ranges(text: str, keep: Iterable[str]) -> list[tuple[int, int]]:
    """Existing placeholders and keep-list terms are never anonymized."""
    ranges = [m.span() for m in PLACEHOLDER_RE.finditer(text)]
    for term in keep:
        words = term.split()
        if words:
            pattern = r"[ \t\r\n]+".join(map(re.escape, words))
            ranges += [m.span() for m in re.finditer(pattern, text, re.IGNORECASE)]
    return ranges


def _canonical(label: str, surface: str) -> str:
    if label in _ID_LABELS:
        return re.sub(r"[^0-9A-Za-z+]", "", surface).upper()
    return normalize(surface).rstrip(".,")


# --------------------------------------------------------------------------- rendering


@dataclass
class _Group:
    placeholder: str
    label: str
    surfaces: list[tuple[str, bool]] = field(default_factory=list)


def _render(text, lang, engine, final: list[Candidate], entity_key) -> AnonymizationResult:
    counters = _existing_counters(text)
    groups: dict[str, _Group] = {}
    spans: list[Span] = []
    pieces: list[str] = []
    cursor = 0
    for c in final:
        key = entity_key(c)
        group = groups.get(key)
        if group is None:
            counters[c.label] = counters.get(c.label, 0) + 1
            group = groups[key] = _Group(f"<{c.label}_{counters[c.label]}>", c.label)
        surface = text[c.start : c.end]
        group.surfaces.append((surface, c.nominative))
        spans.append(Span(c.start, c.end, c.label, group.placeholder, surface))
        pieces += [text[cursor : c.start], group.placeholder]
        cursor = c.end
    pieces.append(text[cursor:])
    entities = [_entity(g) for g in groups.values()]
    return AnonymizationResult("".join(pieces), lang, engine, entities, spans)


def _entity(group: _Group) -> Entity:
    variants = list(dict.fromkeys(s for s, _ in group.surfaces))
    if group.label == "PERSON":
        value = persons.representative(group.surfaces)
    elif group.label == "ORG":
        value = max(variants, key=len)  # the form with the legal form attached
    else:
        value = variants[0]
    return Entity(group.placeholder, group.label, value, len(group.surfaces), variants)


def _existing_counters(text: str) -> dict[str, int]:
    """Continue numbering after placeholders already present (re-anonymizing output)."""
    counters: dict[str, int] = {}
    for m in PLACEHOLDER_RE.finditer(text):
        counters[m.group(1)] = max(counters.get(m.group(1), 0), int(m.group(2)))
    return counters
