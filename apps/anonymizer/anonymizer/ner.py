"""Optional spaCy NER layer (PERSON, ORG). Degrades to None when spaCy is unavailable."""

from __future__ import annotations

import logging
import os
import re
import threading
from typing import Any

from .orgs import is_distinctive
from .persons import tokens_match
from .spans import NON_NAME_WORDS, P_WEAK, PLACEHOLDER_RE, Candidate, normalize

log = logging.getLogger("anonymizer.ner")

MODELS = {"pl": "pl_core_news_sm", "en": "en_core_web_sm"}
_LABELS = {"persName": "PERSON", "PERSON": "PERSON", "PER": "PERSON", "orgName": "ORG", "ORG": "ORG"}
_MAX_TOKENS = {"PERSON": 4, "ORG": 6}
# Quoted defined terms ("Purpose", „Pracodawca”) are capitalised but never PII.
_DEFINED_TERM_RE = re.compile(r"[\"“„«]([^\"“”„«»\n]{1,60})[\"”»]")
_WORD_RE = re.compile(r"[^\W\d_]+")
_ARTICLES = {"the", "a", "an", "this", "that", "these", "those"}
_CONNECTORS = {"of", "and", "&", "de", "van", "von", "der", "für", "i", "und"}
_DISABLED = {"off", "none", "0", "false", "no", "rules"}


class SpacyNer:
    name = "spacy"

    def __init__(self, spacy: Any, models: dict[str, str]):
        self._spacy = spacy
        self._model_names = models
        self._models: dict[str, Any] = {}
        self._lock = threading.Lock()  # spaCy pipelines are not guaranteed thread-safe

    @property
    def defaults(self) -> dict[str, str]:
        return dict(self._model_names)

    @property
    def languages(self) -> list[str]:
        return sorted(self._model_names)

    def available(self) -> dict[str, list[str]]:
        """Installed pipelines per language, e.g. {"pl": ["pl_core_news_lg", "pl_core_news_sm"]}."""
        installed = self._spacy.util.get_installed_models()
        return {lang: sorted(m for m in installed if m.startswith(f"{lang}_")) for lang in MODELS}

    def candidates(self, text: str, language: str, model: str | None = None) -> list[Candidate]:
        with self._lock:
            nlp = self._model(language, model)
            if nlp is None:
                return []
            nlp.max_length = max(nlp.max_length, len(text) + 1)
            doc = nlp(text)
            ents = [(e.start_char, e.end_char, _LABELS.get(e.label_)) for e in doc.ents]
        keep = _NoiseFilter(text, inflect=language == "pl")
        out = []
        for start, end, label in ents:
            span = _clean_span(text, start, end, label) if label else None
            if span and keep(text[span[0] : span[1]]):
                out.append(Candidate(span[0], span[1], label, P_WEAK, source="ner"))
        return out

    def _model(self, language: str, requested: str | None = None) -> Any:
        name = self._model_names.get(language)
        if requested and requested != name:
            if requested not in self.available().get(language, []):
                raise ValueError(f"spaCy model {requested!r} is not installed for {language}")
            name = requested
        if name is None:
            return None
        if name not in self._models:
            log.info("loading spaCy model %s", name)
            self._models[name] = self._spacy.load(name, disable=["lemmatizer", "parser"])
        return self._models[name]


def _clean_span(text: str, start: int, end: int, label: str) -> tuple[int, int] | None:
    """Trim to one line and to alphanumeric edges; reject obviously malformed spans."""
    newline = text.find("\n", start, end)
    if newline != -1:
        end = newline
    while start < end and not text[start].isalnum():
        start += 1
    while end > start and not (text[end - 1].isalnum() or text[end - 1] == "."):
        end -= 1
    value = text[start:end]
    tokens = value.split()
    if (
        len(value) < 3
        or not 1 <= len(tokens) <= _MAX_TOKENS[label]
        or any(c.isdigit() or c in "|/<>[]{}=" for c in value)
        or PLACEHOLDER_RE.search(text, max(0, start - 1), min(len(text), end + 1))
    ):
        return None
    return start, end


class _NoiseFilter:
    """Rejects the typical small-model false positives in legal text.

    Defined terms ("Purpose", „Spółka”), phrases starting with an article, lone ordinary
    words, and capitalised common nouns (words that also occur in lowercase in the document).
    """

    def __init__(self, text: str, inflect: bool):
        self._inflect = inflect
        self._defined = {normalize(m.group(1)) for m in _DEFINED_TERM_RE.finditer(text)}
        self._lowercase_words = {w for w in _WORD_RE.findall(text) if w[0].islower()}

    def __call__(self, value: str) -> bool:
        tokens = value.split()
        names = [t for t in tokens if t.casefold() not in _CONNECTORS]
        if not names or any(not t[0].isupper() for t in names):
            return False
        if tokens[0].casefold() in _ARTICLES or any(t.casefold().strip(".") in NON_NAME_WORDS for t in names):
            return False
        if len(names) == 1 and not is_distinctive(names[0]):
            return False  # lone capitalised words are mostly headings and table labels
        if all(t.casefold() in self._lowercase_words for t in names):
            return False  # "Pipeline", "Data Subjects": ordinary words, capitalised
        return not self._is_defined_term(value)

    def _is_defined_term(self, value: str) -> bool:
        key = normalize(value)
        if key in self._defined:
            return True
        tokens = key.split()
        return self._inflect and any(
            len(term.split()) == len(tokens)
            and all(tokens_match(a, b, True) for a, b in zip(tokens, term.split()))
            for term in self._defined
        )


def load_ner(mode: str | None = None) -> SpacyNer | None:
    """ANONYMIZER_NER=spacy forces the layer, off disables it, unset/auto uses it if installed."""
    mode = (mode if mode is not None else os.environ.get("ANONYMIZER_NER", "auto")).strip().lower()
    if mode in _DISABLED:
        return None
    explicit = mode == "spacy"
    try:
        import spacy  # type: ignore[import-not-found]
    except ImportError:
        if explicit:
            log.warning("ANONYMIZER_NER=spacy but spaCy is not installed; using rules only")
        return None
    models = {lang: name for lang, name in MODELS.items() if spacy.util.is_package(name)}
    if not models:
        if explicit:
            log.warning("spaCy installed but no models (%s); using rules only", ", ".join(MODELS.values()))
        return None
    return SpacyNer(spacy, models)
