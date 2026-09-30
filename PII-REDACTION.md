# PII redaction before sending agreements to Claude

Companion to PLAN.md. **Implemented** as `apps/anonymizer` (Python, standard library rules plus optional spaCy) and `packages/anonymization`. See README, section Anonymization. The notes below record the options that were considered.

## Where it fits

A redaction step in the worker between text extraction and prompt building:

```
extract text ──▶ redact (rules + NER) ──▶ store redacted text + mapping ──▶ build prompt ──▶ Claude
                                                          │
report view ◀── rehydrate placeholders ◀── evidence verifier runs on redacted text
```

## Techniques

### 1. Deterministic rules (regex plus checksums)

Structured identifiers with near-zero false negatives: emails, phones, IBAN, PESEL, NIP, REGON, ID card numbers, postal codes and addresses by pattern. Microseconds per document, any language. Cannot find names. Always the first layer.

### 2. Local NER models (no LLM)

| Option | Language | Strengths | Weaknesses |
|---|---|---|---|
| Microsoft Presidio | Python | Most complete: regex recognizers plus spaCy or transformer NER, anonymizer with replace, hash, reversible encryption, custom recognizers in a few lines, runs as an HTTP service | Python sidecar needed |
| GLiNER | Python, ONNX exports | Zero-shot: pass labels such as person, company, bank account, signatory; PII-tuned multilingual variant exists | Heavier than spaCy, ONNX path in JS less mature |
| PII token classifiers (Piiranha and similar) | Python, ONNX | Single-purpose PII detection, easy to run | Weaker on Polish, fixed label set |
| spaCy `pl_core_news_lg` | Python | Fast on CPU, Polish model available | Weaker on names inside legal boilerplate |

### 3. Local LLM as a second pass

Ollama with a 7 to 8B model (Qwen 2.5, Llama 3.1, Gemma) prompted to return entity spans as JSON. Catches indirect references such as "the Chairman of the Board mentioned in clause 3". Slow, nondeterministic, can hallucinate spans. Use only as an extra pass, and validate every span against the source text before applying it.

### Rust

Feasible, but the pipeline is built by hand: `regex` for layer 1, then `ort` (ONNX Runtime) plus `tokenizers` to run an exported GLiNER or BERT NER model, or `rust-bert` and `candle` for native inference. No Presidio equivalent. Justified only with an existing Rust service or very high throughput needs.

### Bun / TypeScript (fits this stack)

`@huggingface/transformers` (transformers.js) runs ONNX NER models in Bun on CPU, so the worker can redact in-process without Python. With a TypeScript regex layer this covers most cases. GLiNER support in transformers.js lags Python, so quality is lower than Presidio.

## Design points for this app

- Consistent pseudonyms, not black boxes: `<PERSON_1>`, `<ORG_2>`, `<IBAN_1>`. Claude can still reason that the same party appears in clauses 2 and 9, and evidence quotes stay matchable.
- The evidence verifier runs against the redacted text. Rehydration happens only in the report view. The mapping lives in Postgres and never enters the prompt.
- Some rules need the entity class or attributes, not the value. "Counterparty must be an EU company" fails on `<ORG_2>` unless the placeholder carries metadata such as `<ORG_2 country=PL>`. Decide per rule whether redaction is acceptable.
- Redaction is an event: `AgreementRedacted` with entity counts per class, so the audit log shows what left the machine. A failed or skipped redaction is also an event.
- Measure recall on fixtures. Add a redaction fixture with known entities to the matrix in PLAN.md section 15.1 and assert every entity is caught. NER alone misses names in legal text, so the regex layer and a review step are required.
- Store the redacted text alongside the original in `agreement_texts` so a rerun uses the same redaction and the audit remains reproducible.

## Recommendation

Presidio in a Python sidecar container with custom Polish recognizers, a TypeScript regex pass in the worker as the first layer, consistent pseudonyms, and a redaction fixture in the test matrix. Add the local LLM pass later only if measured recall is not enough.

## Plan impact when scheduled

- New package `packages/redaction` with a `Redactor` interface and `RegexRedactor`, `PresidioRedactor`, `NoopRedactor` implementations, selected by `REDACTION=off|regex|presidio`.
- New compose service `presidio` (analyzer plus anonymizer image) used by the worker.
- New events `AgreementRedacted`, `AgreementRedactionFailed`; new columns on `agreement_texts` for redacted text and mapping.
- Report view rehydrates placeholders; a toggle shows the redacted form.
- Discovery question 16 in `DISCOVERY-QUESTIONS.md` (may agreement text go to Anthropic) decides whether this is optional or mandatory.

Library versions and exact model names were not verified when this was written; check them before implementation.
