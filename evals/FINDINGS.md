# Eval findings

Model: `openrouter/deepseek/deepseek-v4-flash-0731`, reasoning off. Fixtures: the 12 agreements in `seeds/agreements`. Measured 2026-09-25.

## Clause-aware extraction

Every fixture splits into one section per numbered clause plus a preamble, in PDF, DOCX, TXT and MD alike. Across all real-model runs after the change, 560 of 562 quotes (99.6%) cited exactly the section they appear in. The report now shows citations such as "§8 Liability" instead of a location the model guessed.

## Majority voting

| Mode | Full suite | Ambiguous-IP repeats | Suite cost |
|---|---|---|---|
| off | 12/12 | 1/4 | $0.008 |
| uncertain | 11/12 | 1/4 | $0.008 |
| all, temperature 0.7, old tie rule | 10/12 | 2/4 | $0.022 |
| all, temperature 0.3 | 10/12 | 2/4 | $0.022 |
| all, temperature 0.7 | 9/12 | 1/4 | $0.022 |

What this shows, with small samples:

- The model states 100% confidence on nearly every finding, including wrong ones, so `uncertain` mode rarely triggers. When it did (the first answer was `unclear`), the extra answers agreed and the result held.
- Voting on every rule costs about 2.7 times more and made results worse. The model's extra answers are noisier than its first answer, so a majority sometimes overturned a correct finding.
- The ambiguous IP case is a judgement problem, not a retrieval or extraction one. This model reads the conflicting clauses as a clear pass in most attempts, whatever the voting mode.

Defaults chosen from this: `AUDIT_VOTING=uncertain`, `AUDIT_VOTE_SAMPLES=2`, `AUDIT_VOTE_TEMPERATURE=0.3`. Voting may pay off with a model whose confidence is calibrated. Rerun the table with `--provider claude-cli` or another `--model` before changing the default.

Result files: `evals/results/2026-09-25T17-22-*` onward.

## Real-length agreements (added 2026-09-25)

Three PDF fixtures of 21 to 23 pages (about 6,000 to 7,500 words, 11,000 to 14,000 prompt tokens) with a contents page, running headers, "Page X of Y" footers, sub-clauses, tables and seven or eight schedules:

| Fixture | What is planted | Where |
|---|---|---|
| `long-msa-deep-medium-issues` | 75-day payment, EUR 250,000 insurance | Schedule 2 §2.4, Schedule 4 §4.1 (body only refers to the schedules) |
| `long-msa-compliant` | Nothing: same text with compliant schedules | Checks false alarms |
| `long-saas-termination-override` | 36-month lock-in overriding a 30-day termination right | Schedule 6 §6.3, last pages; clause 15.1 looks compliant |

### Extraction problems found and fixed

- Running headers and footers were in the text (19 footers, 18 headers in one file), splitting any clause that crossed a page. PDFs are now read page by page and repeated lines and page numbers are removed.
- Schedules were not recognised and their restarted numbering (6.3 after 32.2) failed the sequence check, so every schedule was merged into the last clause and citations into schedules were wrong. Schedule, annex, appendix and exhibit headings now start a new scope, cited as "Schedule 6 §6.3".
- A wrapped body line ("… in / Schedule 3 and shall pay …") was taken for a schedule heading. Schedule headings must now read like titles and appear in order.
- Sub-clauses split only when their first line happened to be short. Every dotted number is now its own section and inherits its clause title, so citations are precise ("§15.1 Termination").
- The signature block merged into the last clause; common unnumbered blocks (Signatures, Execution) are now their own sections.
- The contents page survived only because its lines were long; contents lines (dot leaders or trailing page numbers) are now never headings.

### Model results (3 rounds each)

| Fixture | Before rule fix | After rule fix | Calls |
|---|---|---|---|
| `long-msa-deep-medium-issues` | 3/3, 11/11 rules, all citations exact | 1/1 | 10-94 s, $0.0014-0.0023 |
| `long-msa-compliant` | 3/3, no false alarms | 1/1 | 9-26 s, $0.0011-0.0021 |
| `long-saas-termination-override` | 1/3 (fail, pass, warn) | 4/4 with the final wording (7/7 across both rewordings) | 15-30 s, about $0.001 |

The SaaS misses were not retrieval failures: the model found and quoted both §15.1 and Schedule 6 §6.3 but argued the rule only requires the right to exist. The rule `termination-notice` was reworded to say the right must be available at any time and that a minimum commitment period fails. A first rewording made the model treat an automatic-renewal clause as a lock-in (a regression on `msa-multiple-failures`); scoping the rule to clauses that remove or suspend the termination right, and saying renewal is a separate rule, fixed both (6/6).

Lesson: on long agreements with this model, extraction and citation hold up; the remaining errors come from how the rule text is worded. Rule wording should be evaluated like code, with the fixtures as its tests.

Full suite after the changes: 14/15, the miss being the known `employment-ambiguous-ip` judgement case.
