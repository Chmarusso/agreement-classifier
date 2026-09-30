"""Local PII anonymizer for Polish and English legal agreements (stdlib only)."""

from .engine import AnonymizationResult, Anonymizer, Entity, Span, anonymize, deanonymize
from .language import detect_language

API_VERSION = "1"

__all__ = [
    "API_VERSION",
    "AnonymizationResult",
    "Anonymizer",
    "Entity",
    "Span",
    "anonymize",
    "deanonymize",
    "detect_language",
]
