# Eone — Agreement Audit

Eone checks company agreements against the company's own rules with a language model, and shows each finding next to the clause it comes from. It is event-sourced on Postgres, with a Bun + Hono backend, a React SPA and a local Python anonymizer. See `PLAN.md` for the full design.

Status: milestones 0 to 4 are implemented. That covers the event store, audit log, OTP login, users, rules with versions, agreement upload and text extraction, audits with cost tracking, fixture agreements, and evals. Personal data is anonymized locally before any model call, and agreements can be in Polish or English. Finding overrides (milestone 5) are next.

## What Eone does

A legal or procurement team uploads an agreement (an NDA, MSA, SaaS contract, employment contract or other) and gets a report: for every company rule that applies, a status (*pass*, *fail*, *partial*, *unclear* or *not applicable*), the quoted clause as evidence, and an overall verdict (*Pass*, *Needs review* or *Fail*).

1. **Upload.** A PDF, DOCX, TXT or MD file, with its agreement type.
2. **Extract.** The worker pulls out the text, splits it into numbered sections (`§4 Termination`), and detects whether it is Polish or English.
3. **Anonymize.** A local service replaces personal data (names, PESEL, NIP, IBAN, addresses, e-mails …) with placeholders such as `<PERSON_1>`. The model only ever sees placeholders.
4. **Audit.** The model checks the agreement against every active rule for its type and language, citing a section for each quote. Answers that are unclear can be asked again, and the majority status wins.
5. **Report.** Findings, verdict, cost and a timeline, with the real names put back for people who can see the original.

**Who uses it**

| Role | Can |
|---|---|
| Viewer | Read agreements, reports and rules |
| Auditor | Also upload agreements and run audits |
| Admin | Also manage rules, users, the audit model and anonymization settings, and read the audit log and model spend |

**Where things are**

- **Dashboard** (the logo): headline numbers and recent audits. Each number opens the matching filtered list. Admins also see model spend.
- **Agreements:** search, filters and pages, and each agreement's text in its *Original* and *Sent to model* versions.
- **Rules:** the company's rules, limited by agreement type and language, with a version history.
- **The menu under your email:** *Integrations* (a mockup of MCP, email, HTTP and CLI access) for everyone. Admins also find *Settings* (anonymization and audit model), *Users* and *Audit log* there.
- **Support** (bottom right): a mockup of a live support chat.

Everything that changes state is an event, so the audit log shows who did what, and when, including views, downloads and each model call.

## Tech stack

| Layer | Technology |
|---|---|
| Runtime and tooling | [Bun](https://bun.sh) 1.2 (runtime, package manager, test runner), TypeScript 7, Biome (lint and format), a Bun workspaces monorepo |
| Web app | React 19, Vite 8, TanStack Router and TanStack Query, Tailwind CSS 4, Sonner toasts |
| API | Hono on Bun, Zod validation (schemas shared with the web app in `packages/contracts`), one-time-code e-mail login with an HTTP-only session cookie (the token is stored only as a hash), Server-Sent Events for the live audit log |
| Data | PostgreSQL 17, Drizzle ORM and drizzle-kit migrations, an event store with inline projections, and a job queue on `SELECT … FOR UPDATE SKIP LOCKED` and `LISTEN/NOTIFY` |
| Worker | Bun process with parallel lanes: text extraction, anonymization and audit jobs, retries, lease expiry, heartbeats |
| Text extraction | `unpdf` (PDF.js) for PDF, `mammoth` for DOCX, UTF-8 for TXT and MD; page-furniture removal and a clause-aware section splitter for English and Polish |
| Anonymization | Python 3.11+ service using only the standard library: checksum-validated identifiers, cue-phrase and legal-form rules, Polish inflection. Optional spaCy NER (`pl_core_news_sm`, `en_core_web_sm`). HTTP API and CLI |
| Models | OpenRouter (default), the Claude CLI on the host, a host bridge for Docker, or a stub for tests. Structured JSON output is validated with Zod and retried on errors; cost and tokens are recorded for every call |
| Tests | `bun test` unit and integration tests, each on its own cloned Postgres database; Python `unittest` for the anonymizer; an eval runner over fixture agreements with known results |
| Deployment | Docker Compose: Postgres, API, worker, anonymizer, and the web app served by nginx |

```
browser ──▶ web (React, nginx) ──▶ api (Hono) ──▶ Postgres ◀── events, projections, job queue
                                       │                 ▲
                                       ▼                 │
                              anonymizer (Python) ◀── worker (Bun) ──▶ model (OpenRouter / Claude)
```

## Requirements

- Bun 1.2+
- Docker Desktop
- Python 3.11+ (the anonymizer uses only the standard library)

## Run locally (hot reload)

```sh
cp .env.example .env
bun install
bun run db:up        # Postgres on localhost:5544
bun run seed         # 3 users and 12 rules
bun run dev          # api :3000, worker, web :5173
```

Open http://localhost:5173 and sign in as `admin@example.com`. In development the code `000000` always works; real codes are printed in the API log.

## Run the full stack in Docker

```sh
docker compose up -d --build   # web on http://localhost:8080
docker compose exec api bun seeds/seed.ts
```

The API registers `BOOTSTRAP_ADMIN_EMAIL` (default `admin@example.com`) as the first admin when the users table is empty. `docker-compose.dev.yml` uses a separate project name, so both stacks can run at once.

## Audit model

The worker sends each audit to the model chosen by `LLM_PROVIDER`:

| Provider | When | Notes |
|---|---|---|
| `openrouter` | Default when `OPENROUTER_API_KEY` is set | Placeholder: `deepseek/deepseek-v4-flash-0731`, about $0.0005 to $0.0015 per audit, 40 to 140 s per call |
| `claude-cli` | Worker on the host | Runs `claude -p` with the host login, no tools, no user settings |
| `claude-bridge` | Worker in Docker | Start `CLAUDE_BRIDGE_TOKEN=... bun run bridge` on the host |
| `stub` | Tests, demos without a key | Answers from the fixture expectations, costs nothing |

Every call records its cost, tokens and duration as events.

**Clause-aware extraction.** Extracted text is split into numbered sections (`§4 Termination`), with a preamble and a paragraph fallback for documents without headings. The model sees the agreement as `[S4] …` blocks and must cite a section id for each quote. The report shows the clause, checks that the quote really appears there, and notes when the model cited the wrong section.

**Majority voting.** `AUDIT_VOTING` controls second opinions: `uncertain` (default) re-asks findings that came back unclear, partial or under 80% confidence; `all` re-asks every rule; `off` disables it. `AUDIT_VOTE_SAMPLES` extra answers run in parallel at `AUDIT_VOTE_TEMPERATURE` (default 0.3), and the most common status wins. A two-answer tie keeps the first answer; a split with no majority becomes `unclear`. Measurements are in `evals/FINDINGS.md`. Each finding shows its votes, and the timeline records the vote. The report page, agreement page and dashboard show them.

## Anonymization

`apps/anonymizer` is a local Python service that replaces personal data with placeholders before agreement text reaches any model. `bun run dev` starts it on port 8090, and Docker Compose runs it as the `anonymizer` service. The worker uses it when `ANONYMIZER_URL` is set.

```
extract text ──▶ anonymize (local) ──▶ store both versions + mapping ──▶ prompt with placeholders ──▶ model
                                                   │
report ◀── placeholders replaced with real values ─┘
```

- **What it finds.** PESEL, NIP, REGON, KRS, IBAN and Polish account numbers, ID cards and payment cards are validated by checksum. It also finds e-mails, phone numbers, Polish, UK and US addresses, and companies by legal form (`sp. z o.o.`, `S.A.`, `Ltd`, `GmbH` …). People are found from cue phrases in both languages (`Name:`, `represented by`, `reprezentowana przez`, `Pani`, `zamieszkały` …). The same value always gets the same placeholder (`<PERSON_1>`, `<ORG_2>`), and inflected Polish names share one: *Anna Kowalska*, *Annę Kowalską* → `<PERSON_1>`. Set `ANONYMIZER_WITH_NER=1` when building the Docker image to add spaCy name recognition.
- **What stays readable.** Clause text, amounts, dates, cities and governing law. `ANONYMIZER_KEEP` (separated by `;`) lists names that are never replaced, usually the company's own, so the model knows which party is the Company.
- **Preview.** On the agreement page, "Show extracted text" has an *Original* / *Sent to model* switch that highlights every replacement, plus a table of placeholders and values. The report shows real values by default and the model's own wording under *As the model saw it*. Admins can also open the exact prompts. On the command line, `bun run anonymize <file>` works for PDF, DOCX, TXT and MD files. Add `--format side` for two columns, or `--format json`.
- **Admin settings.** *Settings → Anonymization* (admins, in the menu under your email) chooses the techniques (names from cue phrases, later mentions, Polish case forms, the spaCy NER model and which model per language), which entity types to replace, and the terms never to replace. A *Try it* box runs unsaved settings on pasted text. Saved settings apply to new uploads, are recorded in the audit log, and replace `ANONYMIZER_KEEP`.
- **Failure.** If the anonymizer is unreachable, the job is retried. After the last attempt the agreement is marked `anonymization_failed` and nothing is sent. Agreements extracted before anonymization was turned on are anonymized before their next audit.
- **Audit log.** `AgreementAnonymized` records counts per type (for example `3 PERSON, 2 ORG`), never the values. The mapping stays in `agreement_texts`.

## Polish and English agreements

The language is detected at extraction, stored on the agreement, and shown on its page. The section splitter understands Polish headings: `§ 1` with the title on the next line, `§ 3. Wynagrodzenie`, `Artykuł 4`, `Załącznik nr 2` and `Podpisy stron`. Rules stay in English. The model is told to apply them to Polish clauses, to quote the agreement verbatim in its own language, and to write explanations in English. `nda-pl-compliant` and `employment-pl-noncompete-too-long` are Polish fixtures full of personal data.

Rules can be limited to Polish or English agreements with the *Agreement language* checkboxes in the rule editor. Leave both unchecked for rules that apply to every agreement. An audit uses the rules matching the agreement's type and detected language. An agreement whose language is not known yet gets every rule.

## Trying the anonymizer

`seeds/anonymization/files` has six invented agreements full of personal data:

| File | What it tests |
|---|---|
| `pl-umowa-zlecenia.docx` | A private person with PESEL, ID card, date of birth and bank account, named in five grammatical cases |
| `pl-umowa-najmu.md` | Two private persons, a hyphenated surname, the flat's address and land register number |
| `pl-nda-spolki.txt` | Companies only: KRS, NIP and REGON in different notations, board members, landline in brackets |
| `en-consulting-agreement-uk.pdf` | UK company number, VAT and National Insurance numbers, postcode, IBAN, "Mr Smith" |
| `en-employment-us.docx` | SSN, date of birth, passport, corporate card, US address |
| `bilingual-service-agreement.md` | Polish and English side by side: one person gets one placeholder in both languages |

Upload one in the UI and open "Show extracted text", or run `bun run anonymize seeds/anonymization/files/pl-umowa-zlecenia.docx`. `seeds/anonymization/expected/*.json` lists what each file must replace and what must stay readable, and the tests check both. Edit `seeds/anonymization/samples.ts` and run `bun run samples:build` to add your own.

## Integrations (mockup)

*Integrations*, in the menu under your email, shows how teams will connect to Eone: an MCP server for Claude and other assistants, an email mailbox, the HTTP API with webhooks, and a CLI with exit codes for CI. The examples use the app's own URL. Nothing on the page is implemented yet, and a banner says so.

## Live support chat (mockup)

The "Support" button in the bottom-right corner of every page opens a chat panel. It is a mockup: replies are canned, nothing leaves the browser tab, and a banner says so. A real integration would send the page link, never agreement text.

## Example agreements and evals

`seeds/agreements/files` holds 17 fixture agreements (PDF, DOCX, TXT, MD, one scanned PDF, two in Polish). Each one is built to produce a known result against the seeded rules. `seeds/agreements/expected` holds those results, and `seeds/agreements/sources` holds the readable text. Rebuild them with `bun run fixtures:build` after editing `seeds/fixtures/agreements.ts`.

Upload any of them in the UI to see the flow: text extraction runs, then the worker requests the audit by itself. "Run audit" on the agreement page starts further runs. To measure the model instead:

```sh
bun run eval                          # all fixtures against the configured model
bun run eval --only employment-ambiguous-ip
bun run eval --failed                 # rerun only what failed last time
bun run eval --provider stub          # check the harness without model calls
bun run eval --provider claude-cli --model opus
bun run eval --voting all --samples 2   # compare voting modes
bun run eval --anonymize              # anonymize first, as the worker does (needs the anonymizer running)
```

Each run writes `evals/results/<run-id>/report.md` with a table, the total cost, and for every misclassified rule what the model said and the command to rerun it. `evals/results/latest.json` keeps the newest result per fixture.

## Tests

```sh
bun run db:up
bun test             # unit + integration, each test file gets its own cloned database
bun run test:anonymizer   # Python unit tests of the anonymizer
bun run typecheck
bun run lint
```

Integration tests need the dev Postgres from `bun run db:up`. The anonymization tests start the real Python service with `python3`, so they need no mock. They create databases named `audit_test_*` from a migrated template and drop them afterwards.

## Layout

| Path | What |
|---|---|
| `apps/api` | Hono HTTP API, SSE live audit log |
| `apps/worker` | Postgres job queue: text extraction and audit runs, 3 parallel lanes |
| `apps/anonymizer` | Local Python PII anonymizer (standard library only), HTTP service and CLI |
| `apps/claude-bridge` | Host-side service that runs the Claude CLI for a worker in Docker |
| `apps/web` | React + Vite SPA |
| `packages/domain` | Pure event types, aggregates, command decisions |
| `packages/db` | Drizzle schema and migrations, event store, projections, rebuild, job queue |
| `packages/contracts` | DTOs shared by web and API |
| `packages/llm` | Model clients (OpenRouter, Claude CLI, bridge, stub) and the audit engine |
| `packages/extraction` | Format detection, text extraction for PDF, DOCX, TXT, MD, language detection, section splitting |
| `packages/anonymization` | Client for the anonymizer, rehydration of reports, `bun run anonymize` |
| `evals` | Eval runner over the fixture agreements |
| `packages/test-utils` | Per-test database lifecycle |
| `seeds` | Users, rules, fixture agreements and their expected results |

## Useful commands

```sh
bun run db:generate   # new migration after editing packages/db/src/schema.ts
bun run db:rebuild    # truncate projections and replay every event
```

## Event sourcing in one paragraph

Every state change is an event appended to `events` with optimistic concurrency on `(stream_type, stream_id, stream_version)`. In the same transaction the append updates the read tables (`users`, `sessions`, `audit_log`), enqueues any background jobs, and sends a Postgres `NOTIFY`. The API never replays streams to answer reads. `db:rebuild` proves the read tables can always be regenerated from events.

## Architecture

Eone is five processes around one Postgres database. Postgres is the event store, the read model, the job queue and the message bus.

| Process | Role | Talks to |
|---|---|---|
| `web` (nginx) | Serves the React build and proxies `/api/` to the API, unbuffered for SSE | `api` |
| `api` (Hono on Bun) | Validates requests with the Zod contracts, checks the session cookie and role, runs a command, answers reads from projection tables. Streams the audit log over SSE | Postgres, local upload volume, `anonymizer` (the *Try it* box) |
| `worker` (Bun) | Claims jobs with `FOR UPDATE SKIP LOCKED`, wakes on `LISTEN jobs` with 2 s polling as fallback. Runs `extract_text` and `run_audit` in 3 lanes, sends heartbeats and reaps expired leases | Postgres, upload volume, `anonymizer`, the model |
| `anonymizer` (Python) | Stateless HTTP service that replaces personal data with placeholders | nothing |
| `claude-bridge` (optional, host) | Runs `claude -p` for a worker inside Docker | Claude CLI |

**Write path.** A route builds a command and calls `executeCommand` (`packages/db/src/commands.ts`). It loads the aggregate's events, lets the pure decider in `packages/domain` return new events, and appends them in one transaction. The same transaction checks the stream version, updates the projections (`users`, `sessions`, `agreements`, `rules`, `audit_runs`, `audit_log` …), inserts jobs (`jobsForEvent` in `packages/db/src/jobs.ts`), and sends `NOTIFY`. No state change happens outside an event, and no event is stored without its projections and jobs.

**Read path.** Routes query projection tables directly. They never replay streams. `bun run db:rebuild` truncates the projections and replays every event, which shows the projections can always be regenerated.

**Agreement lifecycle.**

```
POST /agreements ─▶ file saved to STORAGE_DIR, AgreementUploaded ─▶ job extract_text
  worker: detect format ─▶ extract ─▶ split into sections ─▶ detect language ─▶ anonymize
          ─▶ agreement_texts (original, anonymized, mapping) ─▶ AgreementTextExtracted ─▶ audit requested
  worker: run_audit ─▶ rules for type and language ─▶ prompt with [S1]…[Sn] and placeholders
          ─▶ model (JSON, Zod-validated, retried) ─▶ voting on uncertain findings
          ─▶ quote and section check ─▶ AuditRunCompleted (findings, verdict, cost)
  web:    report with real values put back for users who may see the original
```

**Boundaries that matter.**

- `packages/domain` has no I/O. Deciders and event types are unit tested without a database.
- `packages/contracts` is the only code shared by the web app and the API, so a changed DTO breaks the build on both sides.
- `packages/llm` hides the provider behind `AuditModelClient`. Each run records the model it was requested with, so changing the admin setting does not affect runs already queued.
- The anonymization mapping (`agreement_texts.anonymization`) never enters a prompt or an event. Events only carry counts and hashes.

## Before a production launch

The app works end to end, but it was built for a single-host pilot. In rough priority order, this is what should change before real customer agreements go through it. Items marked **blocker** stop a launch.

### Security and access

1. **Send OTP codes by e-mail (blocker).** `ConsoleOtpDelivery` prints codes to the API log, which is the only delivery method today. Add an `OtpDelivery` for SMTP or a provider such as Resend or SES, and make startup fail when `APP_ENV=production` still uses the console one.
2. **Rate-limit `/auth/otp/request` (blocker).** Verification locks after failed attempts, but requesting codes has no limit, so anyone can flood a user's inbox once e-mail is real. Limit per e-mail and per IP.
3. **Trust `X-Forwarded-For` only from the proxy.** `metaFrom` takes the first value of the header as given, so a client can put any IP in the audit log. Take the last hop added by the proxy you control, or have nginx set a header clients cannot forge.
4. **Terminate TLS and add security headers.** nginx listens on plain HTTP on 8080. Put TLS in front, and add `Strict-Transport-Security`, a `Content-Security-Policy`, `X-Content-Type-Options`, `Referrer-Policy` and `frame-ancestors 'none'`. Cookies are already `Secure` when `APP_ENV=production`.
5. **Move secrets out of Compose.** `docker-compose.yml` hard-codes `audit:audit` for Postgres and defaults `APP_ENV` to `development`, `AUTH_SECRET` to the example value, and `DEV_OTP_CODE` to `000000`. The API refuses the last two in production, but only when `APP_ENV=production` is actually set. Add a production Compose file or deployment manifest with no defaults and secrets from a secret store, and default `APP_ENV` to `production` there.
6. **Keep the anonymizer and bridge private.** Neither has authentication. The anonymizer must never be published on a port, and `CLAUDE_BRIDGE_TOKEN` must be required whenever the bridge is used.
7. **Scan uploads.** Files go straight to the PDF and DOCX parsers. Run them through ClamAV or a sandboxed parser process, and check that the detected format matches the file's contents.

### Personal data and compliance

8. **Encrypt the sensitive data at rest (blocker for personal data).** Uploaded files, `agreement_texts.text` and the anonymization mapping hold exactly the personal data the anonymizer protects from the model, all in plain form. Use encrypted volumes and database storage at the least, and preferably encrypt the file store and the mapping column with an application key from a KMS.
9. **Add deletion and retention (blocker under GDPR).** No route deletes an agreement, and PLAN.md says files are kept until deleted. An append-only event store needs a deliberate approach to erasure: keep personal data out of events (mostly true already), delete files, `agreement_texts` and `audit_run_prompts` rows, and record an `AgreementErased` event. Alternatively, use a per-agreement key and destroy it to erase (crypto-shredding). Also add a retention period for prompts and raw model responses.
10. **Choose the model provider on data-processing terms.** The default is a low-cost DeepSeek model on OpenRouter, picked as a placeholder. For production, choose a provider and route with a DPA, zero data retention and a known region, and pin that in OpenRouter's provider routing or call the provider directly. The anonymizer lowers the risk but does not remove it: commercial terms, amounts and party names in `ANONYMIZER_KEEP` still reach the model.
11. **Treat the anonymizer as best effort, and show its limits.** It is rule-based, with optional spaCy NER. Measure recall on real customer documents, not only the fixtures, before promising "no personal data reaches the model".

### Reliability and scale

12. **Replace the local upload volume with object storage.** `FileStorage` writes to a disk shared by the API and the worker, which ties both to one host. Use S3-compatible storage behind the same interface (milestone 7 in PLAN.md) so the API and worker can run as several replicas.
13. **Run migrations as a separate step.** The API migrates on startup. With more than one replica, run `db:migrate` once as a release job and let the API only check the schema version.
14. **Back off on retries and add a dead-letter view.** `failJob` retries after a fixed 5 s, three times. A model outage burns all three attempts in seconds. Use exponential backoff with jitter, and give admins a list of failed jobs with a retry button.
15. **Make the SSE feed gap-safe.** `AuditBroadcaster` reads `audit_log` rows above the last position it saw. `bigserial` values are assigned at insert, not at commit, so a transaction that commits late with a lower position is skipped by the live feed until the page reloads. Re-read a short window behind the cursor, or order by a commit-time sequence.
16. **Back up Postgres and test restores.** Postgres holds everything, including the event store, which is the source of truth. Use a managed Postgres or point-in-time recovery (WAL archiving), and restore to a staging copy on a schedule. The upload store needs the same.
17. **Handle long and scanned agreements.** Agreements are sent to the model whole, and scanned PDFs fail with "OCR is not supported". Add chunking or a length check with a clear error (milestone 7), and OCR (for example Tesseract, run locally so scans stay inside the anonymization boundary).
18. **Watch the events table.** Every view and download is an event, so `events` and `audit_log` grow with reads, not only writes. Partition by time or archive old read events, and add indexes that match the audit-log filters.

### Operations

19. **Structured logs, metrics and alerts.** Logs are `console.*` text. Use JSON logs with the request id and correlation id already carried by events, and export metrics: queue depth and age, job failures, model latency and cost, anonymizer failures, and worker heartbeat age (already in `/health`). Alert when the worker is stale, when jobs fail, and on model spend.
20. **Cap model spend.** Costs are recorded but never capped (PLAN.md §17). Add a daily or monthly budget that pauses new audits and alerts admins, and a per-user limit on manual reruns.
21. **Add CI (blocker).** There is no pipeline in the repository. Run `typecheck`, `lint`, `bun test` against a Postgres service, the anonymizer tests, `bun run eval --provider stub`, and image builds on every pull request. Run a real-model eval on a schedule or before changing the model, and fail when accuracy drops against `evals/results/latest.json`.
22. **Finish milestone 5.** Finding overrides, error-state review and a Playwright suite for the main flows: log in, upload, audit, report, rule edit and role guards.
23. **Pin and build images for release.** Tag images with `APP_VERSION` (the worker already reports it), install production dependencies only, run as non-root (API and worker already do), and add a health check to the worker container.
24. **Remove or hide the mockups.** *Integrations* and *Support* are clearly marked mockups. Hide them behind a feature flag for customers, or replace the support chat with a real channel.
