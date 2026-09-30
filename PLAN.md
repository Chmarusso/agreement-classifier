# Agreement Audit — Implementation Plan

Status: plan only, no code yet. Date: 2026-09-25.

## 1. Goal

An internal tool for one company. Users write the rules and procedures their agreements must follow. They upload agreements (PDF, DOCX, TXT, MD). A background worker asks Claude Code to audit each agreement against the rules and stores a structured verdict. Every state change in the system is an event, and every event is visible in an audit-log view.

## 2. Decisions taken

Implementation note (milestone 1): login events (`OtpRequested`, `OtpVerified`, `OtpVerificationFailed`, `UserLoggedOut`) live on a separate `UserAuth` stream keyed by user id. On the `User` stream they bumped the version admins edit against and caused false 409 conflicts after every login. `UserReactivated` was added to the catalogue.

Implementation note (milestones 2 to 4, 2026-09-25): the audit model sits behind a provider interface. The default is OpenRouter with `deepseek/deepseek-v4-flash-0731` and reasoning off, a cheap placeholder, so development and evals avoid Claude calls. The Claude CLI and host bridge remain available through `LLM_PROVIDER`. View and download events are ignored by edit-conflict checks and deduplicated per user for five minutes. An `evals/` runner measures each fixture against its expected result.

| Topic | Decision |
|---|---|
| Frontend | React + Vite SPA, separate package from the backend, in one Bun-workspaces monorepo |
| Backend | Bun + Hono API, separate Bun worker process for background jobs |
| Persistence | Postgres 17, event sourcing with an append-only `events` table and rebuildable projections |
| Auth | Single company. Email OTP login. In development a fixed code always works. Roles: admin, auditor, viewer |
| Formats | PDF (text layer only), DOCX, TXT, MD. Scanned PDFs are rejected with a clear error |
| Claude | Claude Code CLI runs on the host with the host's login. Containers reach it through a small host bridge over a mounted unix socket, with a TCP fallback for macOS |
| Packaging | Docker Compose for postgres, api, worker, web. The bridge is a host process, never containerized |
| Language | English only: agreements, rules, prompts, fixtures, and UI |
| Revisions | Each uploaded file is its own agreement. No version history in v1 |
| Review | Auditors can override a finding as accepted risk or false positive, with a note |

## 3. Assumptions

- "Every action" includes reads of single entities. Opening a rule, an agreement, or an audit report emits a `...Viewed` event. List and search endpoints do not, and the audit-log view has a "hide read events" toggle so state changes stay easy to find.
- One audit run audits one agreement against a frozen snapshot of the rule versions active at request time.
- A revised draft is uploaded as a new agreement. Users relate drafts through the title and counterparty fields.
- The prompt instructs Claude to answer in English. Non-English input is not rejected, but fixtures and tests cover English only.
- Agreements up to 20 MB and roughly 150k characters of text. Version 1 fails the run on longer documents with an explicit error. Milestone 7 adds chunking.
- The host has Bun, Docker Desktop, and a logged-in `claude` CLI. The bridge is started by hand with `bun run bridge`.
- Secrets (OTP codes, session tokens) never appear in events. Events record outcomes and hashes only.
- No Redis, no message broker. Postgres is the queue.

## 4. Architecture overview

```
 Browser (React SPA)
   │  REST + SSE (/api/v1)
   ▼
 apps/api (Bun + Hono) ──── commands ──▶ packages/domain ──▶ packages/db (event store + projections)
   │                                                              │
   │ same transaction: events + projections + jobs (outbox)       │
   ▼                                                              ▼
 Postgres ◀── polls jobs (SKIP LOCKED) + LISTEN/NOTIFY ──── apps/worker (Bun)
                                                                  │ HTTP over unix socket / host.docker.internal
                                                                  ▼
                                                         apps/claude-bridge (host process)
                                                                  │ Bun.spawn
                                                                  ▼
                                                         claude -p --output-format json ...
```

Write path: HTTP request → validate DTO (Zod) → load aggregate from its event stream → command handler returns new events → append events, update projections, enqueue jobs in one transaction → 2xx with the new stream version.

Read path: projections only. The API never replays streams to answer a query.

## 5. Monorepo layout

```
audit-agreements/
├── package.json                 # bun workspaces, root scripts (dev, test, seed, bridge)
├── bunfig.toml                  # test preload, coverage
├── tsconfig.base.json
├── docker-compose.yml           # postgres, api, worker, web
├── docker-compose.dev.yml       # postgres + mailpit only; apps run on host
├── .env.example
├── apps/
│   ├── web/                     # React 19 + Vite SPA (TanStack Router/Query, shadcn/ui, Tailwind)
│   ├── api/                     # Hono HTTP API: auth, rules, agreements, audits, audit-log, SSE
│   ├── worker/                  # job runner: text extraction, audit runs, lease reaper
│   └── claude-bridge/           # host-only HTTP service wrapping the claude CLI
├── packages/
│   ├── domain/                  # pure: event types, aggregates, command handlers, state machines
│   ├── db/                      # drizzle schema, migrations, event store, projections, job queue
│   ├── contracts/               # Zod DTOs shared by web and api; Claude output schema
│   ├── claude-client/           # ClaudeClient interface + Exec, Bridge, Stub implementations
│   ├── extraction/              # pdf-parse, mammoth, plain text; normalizer
│   └── test-utils/              # test database lifecycle, factories, fake claude binary
├── seeds/
│   ├── rules.json
│   ├── agreements/              # markdown sources + generated pdf/docx fixtures
│   ├── claude-fixtures/         # canned Claude outputs keyed by agreement slug
│   └── seed.ts
└── PLAN.md
```

Workspace tooling: Bun workspaces only, no Turborepo. Root scripts fan out with `bun run --filter`. TypeScript project references for type-checking across packages. Biome for lint and format.

## 6. Domain model

Aggregates, each its own event stream:

- **User**: email, role, status.
- **Rule**: title, description (natural-language requirement), severity (critical, high, medium, low), category, appliesTo tags, status (active, archived), version.
- **Agreement**: file metadata, storage key, sha256, extraction status, extracted text (stored in projection, not in the event), title, counterparty, type, tags, status.
- **AuditRun**: agreement id, rule snapshot (rule id + version pairs), status, attempts, Claude call records, findings, Claude verdict, overrides, effective verdict.

### 6.1 Event catalogue

All events are past tense, carry `eventVersion: 1`, and share the metadata block described in 7.1.

| Stream | Event | Payload highlights |
|---|---|---|
| User | `UserRegistered` | email, role, invitedBy |
| User | `UserRoleChanged` | oldRole, newRole |
| User | `UserDeactivated` | reason |
| User | `OtpRequested` | codeHash, expiresAt, deliveryChannel |
| User | `OtpVerified` | sessionId |
| User | `OtpVerificationFailed` | reason (expired, mismatch, locked), attemptNo |
| User | `UserLoggedOut` | sessionId |
| Rule | `RuleCreated` | title, description, severity, category, appliesTo |
| Rule | `RuleUpdated` | changed fields, newVersion |
| Rule | `RuleArchived` | reason |
| Rule | `RuleRestored` | — |
| Rule | `RuleViewed` | — |
| Agreement | `AgreementUploaded` | fileName, mimeType, sizeBytes, storageKey, sha256 |
| Agreement | `AgreementTextExtracted` | extractor, charCount, pageCount, textSha256 |
| Agreement | `AgreementTextExtractionFailed` | reason (no_text_layer, corrupt, unsupported, too_large) |
| Agreement | `AgreementMetadataUpdated` | title, counterparty, type, tags |
| Agreement | `AgreementViewed` | — |
| Agreement | `AgreementDownloaded` | — |
| Agreement | `AgreementDeleted` | — |
| AuditRun | `AuditRunRequested` | agreementId, ruleSnapshot[] |
| AuditRun | `AuditRunStarted` | workerId, attemptNo |
| AuditRun | `AuditRunClaudeCalled` | attemptNo, model, promptSha256, promptChars |
| AuditRun | `AuditRunClaudeResponded` | attemptNo, durationMs, costUsd, sessionId, outputValid |
| AuditRun | `AuditRunClaudeOutputRejected` | attemptNo, validationErrors[] |
| AuditRun | `AuditRunCompleted` | verdict, summary, findings[], agreementMetadata |
| AuditRun | `AuditRunFailed` | reason, retryable, attemptNo |
| AuditRun | `AuditRunStalled` | leaseExpiredAt, requeued |
| AuditRun | `AuditRunCancelled` | — |
| AuditRun | `AuditRunRetried` | previousAttempts |
| AuditRun | `AuditReportViewed` | — |
| AuditRun | `FindingOverridden` | ruleId, overrideStatus (accepted_risk, false_positive), note, previousStatus, effectiveVerdict |
| AuditRun | `FindingOverrideCleared` | ruleId, effectiveVerdict |
| System | `WorkerStarted` / `WorkerStopped` | workerId, version |
| System | `BridgeHealthChanged` | reachable, checkedAt, error |

Rules for the catalogue:

- A command that changes nothing emits nothing and returns 200 with the unchanged version.
- Every failure the user can observe is an event (`...Failed`, `...Rejected`, `...Stalled`), so the audit log is the incident log too.
- Payload schemas live in `packages/domain/events/*.ts` as Zod schemas and are validated on append and on replay.

### 6.2 Audit run state machine

```
requested ──▶ queued ──▶ running ──▶ awaiting_claude ──▶ validating ──▶ completed
                 ▲          │              │                  │
                 │          └── lease expired ──▶ stalled ────┘ (requeue while attempts < 3)
                 │                                     │
                 └──── retry (manual) ◀── failed ◀──────┘
                                        ▲
              cancelled ◀── any non-terminal state (user action)
```

Terminal states: completed, failed, cancelled. Transitions are enforced in `packages/domain/audit-run.ts` and unit-tested per transition.

## 7. Event store design

### 7.1 Tables (Drizzle schema, `packages/db/schema`)

`events`

| Column | Type | Notes |
|---|---|---|
| global_position | bigserial PK | total order for subscribers |
| event_id | uuid unique | idempotency key |
| stream_type | text | User, Rule, Agreement, AuditRun, System |
| stream_id | uuid | aggregate id |
| stream_version | int | 1..n per stream |
| event_type | text | catalogue name |
| event_version | int | payload schema version |
| payload | jsonb | validated against Zod on write |
| metadata | jsonb | actorUserId, actorType (user, worker, system), correlationId, causationId, requestId, ip, userAgent |
| occurred_at | timestamptz | server clock |

Constraints and indexes: `unique(stream_type, stream_id, stream_version)` gives optimistic concurrency. Indexes on `(stream_type, stream_id)`, `(event_type, occurred_at)`, `(occurred_at)`, and a GIN index on `metadata` for actor filtering.

Optimistic concurrency: `append(streamId, expectedVersion, events[])` inserts with `stream_version = expectedVersion + 1..`. A unique violation becomes a domain `ConcurrencyError` and an HTTP 409. Clients send the `version` they loaded.

`projection_checkpoints` (subscriber name, last global_position) for the async subscribers. `jobs` is the transactional outbox (see section 8).

Projection tables: `users`, `sessions`, `otp_codes`, `rules`, `rule_versions`, `agreements`, `agreement_texts`, `audit_runs` (with `claude_verdict` and `effective_verdict`), `audit_run_prompts`, `audit_findings` (with override columns), `audit_costs`, `audit_log`.

### 7.2 Projections

Two kinds:

- **Inline projections** run inside the append transaction. They feed the UI, so reads are immediately consistent after a command. Each projection is a pure function `(state, event) => state` in `packages/db/projections/*.ts`.
- **Async subscribers** tail `events` by global position with a checkpoint. Used for side effects only (the job enqueuer is inline instead, see 8.1, so the first version has one async subscriber: the SSE broadcaster in the API).

`bun run db:rebuild` truncates all projection tables and replays every event in global order. Integration tests assert that rebuilt projections equal live projections after a scenario.

### 7.3 Audit log projection

`audit_log` is one row per event: event_id, occurred_at, actor (id, display name, type), event_type, stream_type, stream_id, entity label (rule title, agreement file name, run number), a one-line human summary rendered from a per-event template, and the full payload. It holds every event, including system and worker events, so the audit-log view shows the complete history. Pagination is keyset on `(occurred_at, global_position)`.

## 8. Background processing

### 8.1 Job queue on Postgres

`jobs` table: id, kind (`extract_text`, `run_audit`), payload jsonb, status (pending, running, done, failed), attempts, max_attempts (3), run_after, locked_by, locked_until, last_error, created_at. Jobs are inserted in the same transaction as the event that causes them (`AgreementUploaded` → `extract_text`, `AuditRunRequested` → `run_audit`), so no event can be committed without its job and vice versa.

Worker loop: `SELECT ... FOR UPDATE SKIP LOCKED` claims one pending job whose `run_after` has passed, sets `locked_until = now() + 10 min`, and processes it. It also `LISTEN`s on a `jobs` channel that the API `NOTIFY`s after insert, so pickup is immediate; polling every 2 seconds is the fallback. A reaper tick every minute finds running jobs with an expired lease, emits `AuditRunStalled`, and requeues them with `attempts + 1`. After `max_attempts` the run gets `AuditRunFailed` with `retryable: false`.

### 8.2 Text extraction pipeline

1. Read file from storage (local disk adapter, path from `storageKey`).
2. Detect type from magic bytes, not from the extension.
3. Extract: PDF via `pdf-parse`, DOCX via `mammoth`, TXT and MD as UTF-8. Normalize whitespace, keep paragraph breaks.
4. If the result has fewer than 200 non-whitespace characters, emit `AgreementTextExtractionFailed` with `no_text_layer`. Never pass empty text to an audit.
5. Store text in `agreement_texts`, emit `AgreementTextExtracted`.

### 8.3 Audit pipeline

1. Claim job, emit `AuditRunStarted`.
2. Load agreement text and the rule snapshot recorded in `AuditRunRequested` from `rule_versions`. A rule edited after the request does not affect this run.
3. Build the prompt (section 9.2). Store the full prompt text in `audit_run_prompts` keyed by run id and attempt, and emit `AuditRunClaudeCalled` with its hash. Any run can be reproduced exactly from that table.
4. Call `ClaudeClient.audit()` with a 5 minute timeout. Emit `AuditRunClaudeResponded`.
5. Validate the JSON against `AuditOutputSchema` (Zod). Cross-check: every rule id in the snapshot appears exactly once, no unknown ids. On failure emit `AuditRunClaudeOutputRejected` and retry up to 2 more times with the validation errors appended to the prompt. Then `AuditRunFailed`.
6. Verify each evidence quote by whitespace-normalized substring search in the extracted text. Set `evidenceVerified` per finding.
7. Compute the Claude verdict: `fail` if any critical or high rule has status fail; `warn` if any other rule fails or any rule is unclear; else `pass`. The effective verdict starts equal to it and is recomputed on every override, treating an overridden finding as `pass` for accepted risk and false positive alike, while keeping the original status visible.
8. Emit `AuditRunCompleted`.

## 9. Claude integration

### 9.1 Host bridge

`apps/claude-bridge` is a Bun HTTP service that runs on the host, next to the logged-in `claude` CLI. It is started with `bun run bridge` and listens on two transports at once:

- unix socket `./.run/claude-bridge.sock`
- TCP `127.0.0.1:8787`

The worker container mounts `./.run` at `/run/claude` and uses `CLAUDE_BRIDGE_URL=unix:///run/claude/claude-bridge.sock`. Docker Desktop on macOS does not forward unix sockets through bind mounts, so on macOS the compose override sets `CLAUDE_BRIDGE_URL=http://host.docker.internal:8787` and the bridge binds TCP. Both are the same HTTP API. A shared secret in `X-Bridge-Token` protects the TCP listener.

Endpoints:

- `POST /v1/audit` body `{ systemPrompt, prompt, jsonSchema, model, timeoutMs }` → `{ ok, output, raw, durationMs, costUsd, sessionId }` or `{ ok: false, error: { code, message, stderr } }`
- `GET /healthz` runs `claude --version` and reports the CLI version and login state

The bridge limits concurrency to 2 CLI processes, kills a process that exceeds `timeoutMs`, and never logs prompt contents.

`packages/claude-client` exposes one interface with three implementations:

- `ExecClaudeClient`: spawns `claude` directly. Used inside the bridge, and by the worker when it runs on the host in dev mode.
- `BridgeClaudeClient`: HTTP over unix socket or TCP. Used by the worker in Docker.
- `StubClaudeClient`: returns fixtures from `seeds/claude-fixtures` by agreement sha256 or scenario name. Used by tests, seeds, and demo mode.

Selection is `CLAUDE_CLIENT=exec|bridge|stub`.

### 9.2 CLI invocation and response contract

Verified on 2026-09-25 against Claude Code 2.1.282 installed on this host, with one real headless call.

```
claude -p \
  --output-format json \
  --json-schema "$(cat schema.json)" \
  --system-prompt "$(cat system.txt)" \
  --tools "" \
  --max-turns 3 \
  --model "$CLAUDE_MODEL" \
  < prompt.txt
```

Flag facts from `claude --help` and the test run:

| Flag | Verified behaviour |
|---|---|
| `-p` / `--print` | Headless run, prompt read from stdin |
| `--output-format json` | One JSON envelope on stdout |
| `--json-schema <schema>` | Validates the final answer; the object lands in `structured_output` |
| `--tools ""` | Disables every built-in tool, so agreement text cannot trigger file or shell access |
| `--max-turns N` | A structured-output run used 2 turns for a one-line answer, so the cap must be at least 3 |
| `--max-budget-usd` | Available as an optional per-call safety cap; unset by default |
| `--system-prompt` | Replaces the default system prompt; `--system-prompt-file` also exists |
| `--model` | Alias (`sonnet`, `opus`) or full model id; default `opus` |
| `--bare` | Do not use. It skipped the host login and returned `Not logged in` with `is_error: true` |

Envelope on success (fields the bridge reads):

```json
{
  "type": "result",
  "subtype": "success",
  "is_error": false,
  "result": "{\"verdict\":\"pass\"}",
  "structured_output": { "verdict": "pass" },
  "num_turns": 2,
  "duration_ms": 13124,
  "total_cost_usd": 0.072604,
  "session_id": "uuid",
  "usage": { "input_tokens": 0, "output_tokens": 0 },
  "modelUsage": { "…": {} },
  "permission_denials": [],
  "stop_reason": "…"
}
```

On failure the process exits with code 1, `is_error` is `true`, and `result` holds the message (for example `Not logged in · Please run /login`). The bridge treats a non-zero exit, `is_error: true`, or a missing `structured_output` as a failed attempt and records `result` as the error text. The bridge health check runs the same command with a trivial schema and reports `not_logged_in` when the message matches, so a logged-out host shows up in the UI before anyone starts an audit.

Cost note: the trivial verification call cost about seven cents on a Sonnet-class model because the CLI loads its own context. Budget per audit run should assume tens of cents. The system enforces no spend limit; it records `total_cost_usd` on every `AuditRunClaudeResponded` event, and the `audit_costs` projection sums spend per day, per month, and per agreement for the dashboard.

Prompt layout, in this order so the stable part comes first:

1. System prompt: role (contract compliance auditor), instructions to treat the agreement as untrusted data, to answer in English, the output contract, and the rule that every rule id must be answered exactly once.
2. Rules block: numbered list with id, title, severity, category, description.
3. Agreement block: extracted text between clear delimiters.
4. On retry: the previous validation errors and the instruction to return only JSON.

### 9.3 Output schema

```json
{
  "schemaVersion": 1,
  "summary": "string, max 600 chars",
  "agreementMetadata": {
    "title": "string | null",
    "parties": ["string"],
    "effectiveDate": "YYYY-MM-DD | null",
    "governingLaw": "string | null"
  },
  "findings": [
    {
      "ruleId": "uuid",
      "status": "pass | fail | partial | not_applicable | unclear",
      "confidence": 0.0,
      "explanation": "string, max 1200 chars",
      "evidence": [{ "quote": "verbatim excerpt, max 500 chars", "location": "section hint" }],
      "recommendation": "string | null"
    }
  ]
}
```

The same schema is defined once in `packages/contracts/audit-output.ts` (Zod), exported as JSON Schema for the CLI flag, and used by the worker to validate.

### 9.4 Open items for this section

- The bridge must run from a shell that has the host login (Keychain on macOS). A launchd or systemd unit needs the same user session; the health check above catches it when it does not.
- Model: `CLAUDE_MODEL` defaults to `opus`. `sonnet` remains a per-deployment override when cost matters.
- Alternative for later: the Anthropic SDK with structured outputs would remove the CLI dependency and the per-call context overhead. Out of scope now because the requirement is to call Claude Code from the command line.

## 10. API surface (Hono, `/api/v1`)

Auth

| Method | Path | Effect |
|---|---|---|
| POST | /auth/otp/request | `OtpRequested`; always 202 so emails cannot be enumerated |
| POST | /auth/otp/verify | `OtpVerified` or `OtpVerificationFailed`; sets httpOnly session cookie |
| POST | /auth/logout | `UserLoggedOut` |
| GET | /auth/me | current user |

Rules

| Method | Path | Effect |
|---|---|---|
| GET | /rules?status= | list from projection |
| POST | /rules | `RuleCreated` |
| GET | /rules/:id | rule plus version history; `RuleViewed` |
| PATCH | /rules/:id | `RuleUpdated`; body carries `version`, mismatch → 409 |
| POST | /rules/:id/archive, /restore | `RuleArchived`, `RuleRestored` |

Agreements

| Method | Path | Effect |
|---|---|---|
| POST | /agreements | multipart, 20 MB cap, magic-byte check; `AgreementUploaded` + extract job |
| GET | /agreements?q=&status= | list with extraction status and latest verdict |
| GET | /agreements/:id | detail; `AgreementViewed` |
| GET | /agreements/:id/file | download; `AgreementDownloaded` |
| GET | /agreements/:id/text | extracted text |
| PATCH | /agreements/:id | `AgreementMetadataUpdated` |
| POST | /agreements/:id/extract | re-run extraction |
| DELETE | /agreements/:id | `AgreementDeleted` (soft) |

Audits

| Method | Path | Effect |
|---|---|---|
| POST | /agreements/:id/audits | body optional `ruleIds`; default: active rules whose `appliesTo` includes the agreement type or is empty; `AuditRunRequested`; 409 if text not extracted |
| GET | /audits?agreementId=&status= | list |
| GET | /audits/:id | run with findings and timeline; `AuditReportViewed` |
| POST | /audits/:id/cancel, /retry | `AuditRunCancelled`, `AuditRunRetried` |
| PUT | /audits/:id/findings/:ruleId/override | body `{ overrideStatus, note }`; `FindingOverridden`; auditor or admin; only on completed runs |
| DELETE | /audits/:id/findings/:ruleId/override | `FindingOverrideCleared` |
| GET | /audits/:id/events | SSE stream of this run's events |

Audit log and system

| Method | Path | Effect |
|---|---|---|
| GET | /audit-log?from=&to=&eventType=&streamType=&streamId=&actorId=&includeReads=&cursor=&limit= | keyset paginated; `includeReads` defaults to false |
| GET | /audit-log/:eventId | full event |
| GET | /audit-log/stream | SSE live tail |
| GET | /system/event-types | catalogue for filter dropdowns |
| GET | /health | db, worker heartbeat age, bridge reachability |

Error envelope, for every non-2xx response:

```json
{ "error": { "code": "VALIDATION_FAILED", "message": "…", "details": [{ "path": "title", "message": "Required" }], "requestId": "…" } }
```

Codes: `VALIDATION_FAILED` 422, `NOT_FOUND` 404, `CONFLICT` 409, `UNAUTHORIZED` 401, `FORBIDDEN` 403, `PAYLOAD_TOO_LARGE` 413, `UNSUPPORTED_MEDIA_TYPE` 415, `RATE_LIMITED` 429, `BRIDGE_UNAVAILABLE` 503, `INTERNAL` 500. The `requestId` equals the correlation id stored in event metadata, so an error shown in the UI can be found in the audit log.

Role guard: viewers read only, auditors also upload, run audits, and override findings, admins also manage rules and users.

## 11. Frontend

Stack: React 19, Vite, TypeScript, TanStack Router, TanStack Query, shadcn/ui on Tailwind, react-hook-form with the shared Zod DTOs, sonner for toasts. The API client is generated from `packages/contracts`, so DTO drift fails type-checking.

Screens:

1. `/login`: email form → code form. Dev build shows a hint with the fixed code.
2. `/dashboard`: counts (rules, agreements, runs by status), Claude spend this month and total, latest runs, agreements with failing verdicts.
3. `/rules`, `/rules/new`, `/rules/:id`: list with severity and category filters, create and edit forms, version history panel.
4. `/agreements`, `/agreements/:id`: list with search and status filter, upload dialog with drag and drop and per-file progress, detail page with metadata form, extraction status, text preview, runs list, "Run audit" button disabled until text is extracted.
5. `/audits/:id`: banner showing the effective verdict with the Claude verdict beside it when they differ, findings grouped by severity, evidence quotes with a "verified in text" badge, an "Override" action per finding opening a dialog for status and note, an override badge with the note and author on overridden findings, raw JSON toggle, "view prompt" drawer, run timeline built from the run's events, cancel and retry actions.
6. `/audit-log`: table with filters (date range, event type, stream type, actor, entity), a "show read events" toggle, live tail toggle over SSE, detail drawer with the payload and a link to the entity.
7. `/settings/users` (admin): list, invite, change role, deactivate.

UX states, applied uniformly through three shared components:

- **Loading**: every query renders a skeleton or spinner. Every mutation button shows an inline spinner and stays disabled while pending.
- **Error**: query errors render an `ErrorState` with the message, the request id, and a retry button. Mutation errors show a toast, and `details[]` map onto form fields. 401 redirects to login. A route-level error boundary catches render errors. An offline banner appears when the browser loses connectivity.
- **Empty**: every list has an empty state with the primary action.
- **Long-running**: an audit run shows a status chip driven by SSE. If SSE drops, the client polls every 3 seconds and shows a "reconnecting" hint.

## 12. Authentication

- OTP: 6 digits, 10 minute TTL, 5 attempts then locked for 15 minutes. Code hash and expiry live in `otp_codes`; the event carries the hash, never the code.
- Delivery: in development the API logs the code and always accepts `DEV_OTP_CODE` (default `000000`). Startup refuses to boot when `DEV_OTP_CODE` is set and `APP_ENV=production`. Production delivery is undecided (open question 2). The code goes through an `OtpDelivery` interface with a `ConsoleDelivery` implementation in version 1, so a provider adapter can be added without touching the auth flow. Mailpit stays in the dev compose for when one is.
- Sessions: server-side `sessions` table, opaque token in an httpOnly, `SameSite=Lax`, secure cookie, 7 day sliding expiry. Logout deletes the row.
- Users are created by an admin (or by the seed). An unknown email on OTP request still gets 202 and no event, to avoid enumeration.

## 13. Docker topology

`docker-compose.yml`

| Service | Image | Notes |
|---|---|---|
| postgres | postgres:17-alpine | named volume, healthcheck, `POSTGRES_DB=audit` |
| api | built from `apps/api/Dockerfile` (oven/bun) | runs migrations on start, port 3000, volume `uploads:/data/uploads` |
| worker | built from `apps/worker/Dockerfile` | same image base, `CLAUDE_CLIENT=bridge`, mounts `./.run:/run/claude` |
| web | multi-stage: bun build → nginx | serves the SPA, proxies `/api` to api, port 8080 |

`docker-compose.dev.yml` starts only postgres and mailpit. `bun run dev` then runs api, worker, and web on the host with hot reload, `CLAUDE_CLIENT=exec`, and no bridge needed.

`docker-compose.mac.yml` override sets `CLAUDE_BRIDGE_URL=http://host.docker.internal:8787` for the worker.

The bridge is documented as a host process in the README with `bun run bridge`. It is intentionally not a compose service because it needs the host's CLI login.

Storage: local disk adapter under `/data/uploads/<sha256 prefix>/<id>`. Files are kept until a user deletes the agreement; there is no automatic purge. An S3-compatible adapter is a later milestone.

## 14. Testing strategy

Runner: `bun test` for unit and integration, Playwright for end to end. `bunfig.toml` preloads `packages/test-utils/setup.ts`.

### 14.1 Unit (`packages/domain`, `packages/contracts`, `packages/claude-client`)

- Each command handler: given events, when command, then expected events. One test per transition in the audit-run state machine, including every illegal transition.
- Verdict computation for the four status mixes, and effective verdict recomputation after an override and after clearing it.
- Override commands: rejected on a run that is not completed, rejected for an unknown rule id, idempotent when repeated with the same status.
- `AuditOutputSchema` accepts the fixture outputs and rejects a missing rule, a duplicate rule, an unknown rule, and a bad status.
- Evidence matcher handles whitespace and quote normalization.
- Prompt builder output is snapshot-tested so prompt changes are reviewed.

### 14.2 Integration (`packages/db`, `apps/api`, `apps/worker`)

- Real Postgres from `docker compose -f docker-compose.dev.yml up postgres`. Each test file creates a database from a migrated template and drops it after, so files run in parallel.
- Event store: append, replay order, unique version conflict → `ConcurrencyError`, idempotent append by event id.
- Projections: after a scripted scenario, `db:rebuild` produces tables equal to the live ones.
- Job queue: two workers claim different jobs, expired lease is requeued, `max_attempts` leads to `AuditRunFailed`.
- API routes through Hono's `app.request()`: auth cookie, role guard, validation errors, 409 on stale version, 413 and 415 on uploads.
- Worker pipeline end to end with `StubClaudeClient`, once per fixture in the matrix (section 15.1): upload → extraction → audit → `AuditRunCompleted` with the verdict and per-rule statuses from `seeds/expected/`. Includes the malformed-output scenario producing two `AuditRunClaudeOutputRejected` events then success, and the timeout scenario producing `AuditRunFailed`.
- `ExecClaudeClient` against a fake `claude` binary placed first on `PATH` by `test-utils`. The fake reads `FAKE_CLAUDE_SCENARIO` (`valid`, `malformed`, `prose_around_json`, `timeout`, `nonzero_exit`) and prints the matching envelope.
- Bridge contract test: start the bridge with the fake binary, call it over TCP and over the unix socket.

### 14.3 End to end (`apps/web/e2e`, Playwright)

Run against the dev stack with `CLAUDE_CLIENT=stub` and seeded data:

1. Login with the dev OTP code, land on the dashboard.
2. Create a rule, see it in the list, edit it, see version 2 in history.
3. Upload `nda-compliant`, see the extraction spinner then "text ready".
4. Run an audit, watch the status chip move to completed, open the report, see a pass verdict and verified evidence badges.
5. Upload `msa-multiple-failures`, run, see a fail verdict with three findings grouped by severity and a verified evidence quote on each.
6. Upload `scanned-no-text-layer`, see the extraction error state with the reason. Upload `oversized-agreement`, run, see the run failed state with `too_large`.
7. Upload a `.exe` renamed to `.pdf`, see the 415 toast.
8. Open the audit log, filter by event type `AuditRunCompleted`, open the detail drawer, follow the link to the run.
9. Viewer role cannot see the "Run audit" button and gets 403 on a direct request.
10. On the `saas-auto-renewal` report, override the failing finding as accepted risk with a note, see the effective verdict flip to pass while the Claude verdict still reads fail, and find `FindingOverridden` in the audit log.

### 14.4 CI

GitHub Actions: postgres service container, `bun install`, typecheck, lint, unit, integration, web build, Playwright against the built stack with the stub client. No job talks to the real Claude CLI.

## 15. Seeds

`bun run seed` is idempotent and refuses to run when `APP_ENV=production`. It goes through the command handlers, so every seeded row has real events behind it and the audit log starts populated.

Contents:

- Users: `admin@example.com` (admin), `auditor@example.com` (auditor), `viewer@example.com` (viewer).
- 12 rules across categories: liability cap, termination notice at least 30 days, governing law Poland, payment terms at most 30 days, confidentiality term, IP assignment, non-compete limits, GDPR data-processing clause, no auto-renewal, insurance requirement, dispute resolution, signature authority.
- Fixture agreements generated from markdown sources in `seeds/agreements` into PDF, DOCX, and MD. Each one is written to produce a known outcome against the seeded rules (section 15.1).
- `seeds/claude-fixtures/<slug>.json`: one canned Claude output per agreement, matching the schema. The seed runs audits through `StubClaudeClient`, so completed runs, findings, and failed runs exist for the UI.
- `seeds/expected/<slug>.json`: the expected verdict and per-rule status for each fixture. Tests compare against this file, not against the canned output, so the two cannot drift silently.
- The same fixtures serve the tests and the `CLAUDE_CLIENT=stub` demo mode.

### 15.1 Fixture agreement matrix

Every fixture is authored so a human reader can confirm the expected result by reading the clause. The markdown source carries an HTML comment per rule (`<!-- rule: liability-cap expect: fail reason: cap is 200% of fees -->`) that a generator script turns into `seeds/expected/<slug>.json`.

| Slug | Type | Format | Expected verdict | What drives it |
|---|---|---|---|---|
| `nda-compliant` | NDA | PDF | pass | Every applicable rule satisfied; 5-year confidentiality, Polish law, 30-day notice |
| `nda-missing-governing-law` | NDA | DOCX | fail | Governing law clause absent (critical); everything else passes |
| `nda-partial-confidentiality` | NDA | MD | warn | Confidentiality term 1 year where rule needs 3: `partial`; no critical failures |
| `msa-compliant` | MSA | PDF | pass | Liability cap 100% of fees, 45-day payment terms within a 60-day MSA rule |
| `msa-multiple-failures` | MSA | DOCX | fail | Unlimited liability (critical), auto-renewal clause (high), 90-day payment (medium) |
| `saas-auto-renewal` | SaaS | PDF | fail | Single failing high rule: auto-renewal without opt-out; proves one high failure is enough |
| `saas-not-applicable-rules` | SaaS | MD | pass | Employment-only rules must come back `not_applicable`, not `fail` |
| `employment-noncompete-too-long` | Employment | DOCX | fail | 24-month non-compete against a 6-month rule; GDPR clause present |
| `employment-ambiguous-ip` | Employment | PDF | warn | IP assignment clause contradictory across two sections: `unclear` with confidence below 0.5 |
| `scanned-no-text-layer` | NDA | PDF (image only) | extraction failed | Exercises `AgreementTextExtractionFailed` with `no_text_layer` |
| `oversized-agreement` | MSA | TXT | run failed | 400k characters; exercises the size guard and `AuditRunFailed` with `too_large` |
| `injection-attempt` | NDA | MD | fail | Contains text instructing the auditor to mark everything as pass; the expected output still fails the missing liability cap |

Each `expected/<slug>.json` lists: `verdict`, `findings[]` with `ruleSlug`, `status`, and for `fail` and `partial` a `mustCiteQuote` fragment that the evidence array has to contain, so the evidence verifier is exercised too.

### 15.2 How the matrix is used

- **Seeds**: every fixture is uploaded, extracted, and audited through the stub client, so the dashboard opens with passes, warnings, failures, and both failure modes visible in the audit log.
- **Unit tests**: `StubClaudeClient` outputs are validated against the schema and against `expected/`, so a fixture edit that breaks the expectation fails at unit level.
- **Integration tests**: the worker pipeline runs each fixture end to end and asserts the verdict, the per-rule statuses, and the presence of the `mustCiteQuote` evidence.
- **End to end**: Playwright scenarios 3 to 7 pick their agreements from this table.
- **Real Claude smoke test**: `bun run smoke:claude` runs the whole matrix through `ExecClaudeClient` on the host and compares against `expected/`. Verdicts must match exactly; per-rule statuses allow `partial` and `unclear` to swap, since those depend on model judgement. This script is opt-in, spends real tokens, never runs in CI, and is the acceptance check before milestone 4 is called done. Its results are written to `seeds/expected/smoke-report.md` so prompt changes can be compared over time.

## 16. Milestones

| # | Milestone | Deliverable |
|---|---|---|
| 0 | Scaffold | Monorepo, compose, Drizzle migrations, CI, health endpoint |
| 1 | Event store and audit log | Append, projections, rebuild, audit-log API and view, OTP auth |
| 2 | Rules | CRUD with versions, UI screens, tests |
| 3 | Agreements | Upload, storage, extraction worker, detail UI with states |
| 4 | Claude | Bridge, exec and stub clients, audit pipeline, report UI, SSE progress; done when the smoke test passes on the fixture matrix |
| 5 | Hardening | Finding overrides, lease reaper, retries, error states audit, role guards, Playwright suite |
| 6 | Seeds and docs | Seed script, fixture matrix with expected outcomes, real-Claude smoke test, README with host bridge setup |
| 7 | Later | Chunking for long agreements, S3 storage |

## 17. Open questions

Resolved on 2026-09-25: single-entity reads are logged; default model is `opus`; full prompt stored per attempt; files kept until deleted; costs recorded but never capped; rules scoped by `appliesTo` tags, no rule sets.

1. Production OTP delivery: SMTP, Resend, or another provider? Deferred; the `OtpDelivery` adapter keeps this open without blocking implementation.

## 18. Discovery questions

The questions to ask the customer before milestone 2 live in `DISCOVERY-QUESTIONS.md`. Each one names the part of this plan its answer changes.

## 19. PII redaction

Options and design for redacting personal data before text reaches Claude are in `PII-REDACTION.md`. Not scheduled; its plan impact is listed there.
