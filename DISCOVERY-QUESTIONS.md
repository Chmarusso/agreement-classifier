# Discovery questions for the customer

Companion to PLAN.md. Ask before milestone 2. Each question changes a concrete part of the plan, named in brackets.

## Rules and procedures

1. Who writes the rules today, and where do they live now: a policy document, a lawyer's checklist, tribal knowledge? [rule import, seed content]
2. Can you give five real rules with a real example of an agreement breaking each one? [fixture matrix, prompt tuning]
3. Which rules are hard blockers versus preferences? Should a single blocker fail the whole agreement? [severity levels, verdict rule]
4. Do rules differ by agreement type, counterparty size, or country? [appliesTo tags, possibly rule sets later]
5. How often do rules change, and who approves a change? [rule versioning, admin role, approval step]

## Agreements

6. How many agreements per month, and how long are they typically? [worker concurrency, size guard, chunking priority]
7. What share arrives as scanned PDFs or photos? [OCR decision, rejection message]
8. Are agreements in English only, or also in Polish or other languages? [prompt language, fixtures]
9. Do you audit drafts before signing, signed agreements, or both? [revision handling, status field]
10. Where do agreements live today: email, Google Drive, a CLM system? [upload flow, future integrations]

## Audit results

11. Who reads the report, and what do they do with a fail: negotiate, escalate, reject? [report layout, export, override reasons]
12. Is a lawyer's confirmation required before a result counts, or is the AI result enough? [override workflow, reviewed status]
13. What level of false positives is acceptable versus missed problems? [prompt strictness, confidence thresholds]
14. Should evidence be quoted verbatim from the agreement, or is a summary enough? [evidence verifier]

## Access and compliance

15. Who needs access, and with which roles? How do people join and leave? [user management, deactivation event]
16. Can agreement text be sent to Anthropic under your confidentiality obligations and data processing agreements? [legal blocker, data residency]
17. How long must the audit trail be kept, and does anyone outside the company need to read it? [retention, export of the audit log]
18. Is a login with an email code acceptable, or is SSO required? [auth milestone]

## Operations

19. Where should this run: a laptop, an office server, or cloud? [bridge placement, Docker profile]
20. Who watches it when an audit fails or Claude is unreachable, and how should they be told? [health view, notifications]
21. Is there a budget for Claude usage per month? [cost projection, future cap]
