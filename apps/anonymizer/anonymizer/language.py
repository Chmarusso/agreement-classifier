"""Cheap Polish/English language detection based on stopwords and diacritics."""

from __future__ import annotations

import re

_PL_STOPWORDS = frozenset(
    "i w z na się oraz jest lub przez umowa umowy strony że od po dla nie jako który która "
    "które zł dnia ust pkt".split()
)
_EN_STOPWORDS = frozenset(
    "the and of to shall by this agreement is in for any with be or party parties that will may".split()
)
_PL_DIACRITICS = frozenset("ąćęłńóśźżĄĆĘŁŃÓŚŹŻ")
_WORD_RE = re.compile(r"[^\W\d_]+")


def detect_language(text: str) -> str:
    """Return "pl" or "en" ("en" for empty or undecidable text)."""
    pl = en = 0.0
    for word in _WORD_RE.findall(text):
        # Single letters keep their case: English "I" must not count as Polish "i".
        key = word if len(word) == 1 else word.lower()
        if key in _PL_STOPWORDS:
            pl += 1
        elif key in _EN_STOPWORDS:
            en += 1
        if any(c in _PL_DIACRITICS for c in word):
            pl += 0.5
    return "pl" if pl > en else "en"
