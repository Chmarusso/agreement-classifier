# @app/anonymizer

Local PII anonymizer for Polish and English agreements. It runs before any text is sent to the LLM
and replaces personal data with consistent placeholders such as `<PERSON_1>` or `<IBAN_1>`.
The core is Python standard library only (3.11+); spaCy NER is an optional extra layer.

## What it detects

| Label | How |
|---|---|
| `PESEL`, `NIP`, `REGON` (9/14), `IBAN`, `BANK_ACCOUNT` (26-digit NRB), `ID_CARD` (dowód osobisty), `CARD` | Pattern + checksum. A number that fails the checksum is still anonymized after a cue word (`PESEL:`, `NIP`, `nr rachunku`, `IBAN`, ...) |
| `KRS`, `PASSPORT`, `COMPANY_NO` (Companies House, HRB) | Pattern + required cue word |
| `VAT_ID` (`PL5260250274`, `DE123456789`), `SSN` | Pattern (PL VAT validated as NIP) |
| `EMAIL`, `PHONE` | Pattern (`+48 600 700 800`, `(22) 123 45 67`, `+1 (415) 555-0100`, `tel.` cue) |
| `ADDRESS` | `ul. Marszałkowska 10/12, 00-590 Warszawa`, `00-590 Warszawa`, `221B Baker Street, London NW1 6XE`, US street + `CA 94043`, EU `Street 8, 111 43 City` |
| `DATE_OF_BIRTH` | Only after `born on`, `date of birth`, `urodzony/a`, `data urodzenia` |
| `ORG` | Capitalised name before a legal form (`sp. z o.o.`, `S.A.`, `Ltd`, `LLC`, `GmbH`, `B.V.`, ...), also quoted: `„Acme” sp. z o.o.` |
| `PERSON` | Names after cues (`Name:`, `Mr`, `represented by`, `Imię i nazwisko:`, `Pani`, `reprezentowana przez`, `Anna Nowak, zamieszkała`, `, PESEL`, `– Prezes Zarządu`) |

Every later mention of a detected person or organisation gets the same placeholder: exact and
case-insensitive matches, lone surnames (`Mr Kowalski`), Polish inflected forms (`Jan Kowalski` ↔
`Jana Kowalskiego` ↔ `Janowi Kowalskiemu`, `Anna Nowak` ↔ `Annie Nowak`) and company names without the
legal form (`Northwind Analytics`). Cities alone, governing law, dates, amounts, section numbers and
defined terms (`the Company`, `Zleceniodawca`) are left alone.

Overlaps resolve by priority: validated identifiers > email/IBAN > address > org > person > phone > NER,
then the longer span. Output is deterministic; placeholders already in the text are never touched.

## HTTP API

`bun run dev` (or `python3 -m anonymizer.server`) listens on `ANONYMIZER_HOST:ANONYMIZER_PORT`
(default `127.0.0.1:8090`). Request bodies are limited to 5 MB. The log has one line per request and
never contains text.

```
GET  /health       -> {"ok": true, "version": "1", "ner": false, "engine": "rules"}
POST /anonymize    {"text": "...", "language": "pl" | "en" | null, "keep": ["Northwind Analytics"]}
                   -> {"text", "language", "engine",
                       "entities": [{"placeholder", "label", "value", "count", "variants"}],
                       "spans":    [{"start", "end", "label", "placeholder", "text"}]}
POST /deanonymize  {"text": "...", "entities": [{"placeholder", "value"}, ...]} -> {"text"}
```

`spans` offsets point into the original text and are sorted and non-overlapping. `keep` terms
(case-insensitive) are never anonymized. Errors return `400 {"error": "..."}` (`413` above 5 MB).

## CLI preview

```
python3 -m anonymizer contract.md                    # highlighted original + entity table
python3 -m anonymizer contract.md --format side      # original | anonymized columns
python3 -m anonymizer - --format json < contract.txt # API response
python3 -m anonymizer contract.md --format anonymized --keep "Northwind Analytics" --lang pl
```

Colors are off when stdout is not a TTY, with `--no-color` or with `NO_COLOR` set. For PDF or DOCX use
`bun run anonymize <file>`, which extracts text first.

## Optional NER (spaCy)

```
pip install '.[ner]'
python -m spacy download pl_core_news_sm
python -m spacy download en_core_web_sm
```

`ANONYMIZER_NER=spacy` forces the layer, `off` disables it, unset or `auto` enables it when spaCy and a
model are installed. NER adds PERSON and ORG spans (for example companies without a legal form) at the
lowest priority; `engine` then reports `rules+spacy`. The Docker image includes it with
`--build-arg WITH_NER=1`.

## Tests

```
bun run test   # python3 -m unittest discover -s tests -t .
```

## Known limitations

- Person names are found only after cues or as later mentions of a cued name; an uncued name in running
  text needs the NER layer.
- Organisations need a legal form (or NER). A lone surname that is also part of a company name
  (`Lindqvist` for `Erik Lindqvist` and `Lindqvist Data Services AB`) is labelled PERSON.
- Polish inflection is suffix-based: stem alternations (`Marek` ↔ `Marka`) and very short names
  (`Ewa` ↔ `Ewy`) are not linked; the male and female forms of one surname share stems.
- The entity `value` of a Polish name is the most nominative-looking form seen, so `deanonymize`
  restores that form rather than each inflected variant.
