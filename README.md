# Agreement Audit POC

This proof of concept helps legal and procurement teams review agreements against their own company rules.

It turns a contract into a reviewable report with:

- A result for each applicable rule.
- The clause that supports the result.
- An overall pass, needs-review, or fail verdict.
- Confidence, model cost, and an audit timeline.

The goal is not to replace legal judgment. It is to reduce repetitive first-pass review, make the review criteria consistent, and give reviewers a clear evidence trail.

## Business value

The POC tests whether a team can:

- Screen more agreements before assigning specialist review.
- Apply company policy consistently across reviewers and contract types.
- Find risky or missing clauses faster.
- Explain every finding with the source clause instead of an unsupported summary.
- Keep a record of who reviewed what, which rules applied, and what the model returned.
- Protect personal data by anonymizing it locally before model processing.

## Review flow

```text
upload → extract → anonymize → check against company rules → report
```

The POC accepts PDF, DOCX, TXT, and Markdown files in English or Polish. It supports NDAs, MSAs, SaaS agreements, employment contracts, and other agreement types defined by the seeded rules.

The local anonymizer replaces names, identifiers, contact details, addresses, and organizations with stable placeholders. Reviewers with access to the original agreement see the real values in the final report.

## Try it locally

Requirements:

- [Bun](https://bun.sh) 1.2+
- Docker Desktop
- Python 3.11+

Start the development environment:

```sh
cp .env.example .env
bun install
bun run db:up
bun run seed
bun run dev
```

Open <http://localhost:5173> and sign in with `admin@example.com`. Development accepts `000000` as the OTP.

To run the full stack with Docker:

```sh
docker compose up -d --build
docker compose exec api bun seeds/seed.ts
```

Open <http://localhost:8080>.

## What the POC demonstrates

### Policy-based review

Rules can be scoped by agreement type and language. Each finding includes a status, explanation, confidence, and quoted evidence. The system checks that the quoted text appears in the agreement and flags incorrect section citations.

### Consistent second opinions

Unclear, partial, or low-confidence findings can receive additional model answers. The report records the votes and the selected result.

### Privacy-aware processing

The anonymizer runs locally and keeps the replacement mapping separate from model prompts. It covers common Polish and international identifiers, names, companies, addresses, phone numbers, and email addresses.

Try it with a sample agreement:

```sh
bun run anonymize seeds/anonymization/files/pl-umowa-zlecenia.docx
bun run anonymize seeds/anonymization/files/pl-umowa-zlecenia.docx --format json
```

See [PII-REDACTION.md](PII-REDACTION.md) for the scope and known limits of the anonymizer.

### Review history

The POC records uploads, views, downloads, rule changes, audit runs, model calls, costs, and anonymization counts in an append-only event log. This gives reviewers and administrators a trace of how each report was produced.

## Evaluation

The repository includes fixture agreements with expected findings. They cover compliant agreements, multiple failures, ambiguous clauses, prompt-injection attempts, Polish documents, long documents, and scanned PDFs.

Run the evaluator without making model calls:

```sh
bun run eval --provider stub
```

Useful options:

```sh
bun run eval --only employment-ambiguous-ip
bun run eval --failed
bun run eval --voting all --samples 2
bun run eval --anonymize
```

See [evals/FINDINGS.md](evals/FINDINGS.md) for the latest measurements.

## Configuration

Copy `.env.example` to `.env`. Important settings include:

| Setting | Purpose |
|---|---|
| `LLM_PROVIDER` | `openrouter`, `claude-cli`, `claude-bridge`, or `stub` |
| `OPENROUTER_API_KEY` | Enables the OpenRouter model client |
| `ANONYMIZER_URL` | Connects the worker to the local anonymizer |
| `ANONYMIZER_KEEP` | Values that should remain readable to the model |
| `AUDIT_VOTING` | `uncertain`, `all`, or `off` |

The `stub` provider uses fixture expectations and costs nothing.

## Tests and checks

```sh
bun run db:up
bun test
bun run test:anonymizer
bun run typecheck
bun run lint
```

## Project layout

| Path | Purpose |
|---|---|
| `apps/web` | Review interface |
| `apps/api` | Authentication and application API |
| `apps/worker` | Document processing and audit jobs |
| `apps/anonymizer` | Local PII anonymization service |
| `packages/domain` | Rules, events, and business decisions |
| `packages/db` | Database, projections, and job queue |
| `packages/llm` | Model clients and audit engine |
| `packages/extraction` | Document extraction and section splitting |
| `seeds` | Sample users, rules, and agreements |
| `evals` | Evaluation runner and results |

## POC boundaries

This is a single-host POC, not a production deployment. Before processing customer agreements, address:

- Real email delivery and rate limiting for OTP login.
- Production secrets and database credentials.
- Encryption, retention, and deletion for uploaded agreements and mappings.
- Upload scanning, OCR, and support for long agreements.
- Durable file storage, backups, monitoring, CI, and model-spend limits.
- Independent testing of anonymizer recall on real documents.

The Integrations and Support screens are illustrative only. See [PLAN.md](PLAN.md) for the detailed roadmap and design notes.

## License

MIT
