"""Preview CLI: python3 -m anonymizer FILE|- [--lang] [--keep] [--format] [--no-color]."""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import sys
import textwrap
from itertools import zip_longest
from pathlib import Path

from .engine import AnonymizationResult, Anonymizer
from .ner import load_ner
from .spans import PLACEHOLDER_RE

_BINARY_SUFFIXES = {".pdf", ".docx", ".doc", ".odt", ".rtf"}
_RESET = "\x1b[0m"
_DIM = "\x1b[2m"
_BOLD = "\x1b[1m"
_LABEL_COLORS = {
    "PERSON": "\x1b[1;31m",
    "ORG": "\x1b[1;35m",
    "ADDRESS": "\x1b[1;33m",
    "EMAIL": "\x1b[1;36m",
    "PHONE": "\x1b[1;36m",
    "DATE_OF_BIRTH": "\x1b[1;32m",
}
_ID_COLOR = "\x1b[1;34m"


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    if args.file != "-" and Path(args.file).suffix.lower() in _BINARY_SUFFIXES:
        print(
            f"{args.file}: binary documents need text extraction first; run `bun run anonymize {args.file}`",
            file=sys.stderr,
        )
        return 2
    try:
        text = sys.stdin.read() if args.file == "-" else Path(args.file).read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as e:
        print(f"cannot read {args.file}: {e}", file=sys.stderr)
        return 1

    result = Anonymizer(ner=load_ner()).anonymize(text, args.lang, args.keep)
    color = not args.no_color and "NO_COLOR" not in os.environ and sys.stdout.isatty()
    render = {"diff": render_diff, "side": render_side, "json": render_json, "anonymized": render_anonymized}
    sys.stdout.write(render[args.format](text, result, color))
    return 0


def _parse_args(argv: list[str] | None) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        prog="python3 -m anonymizer", description="Preview PII anonymization of a text file."
    )
    p.add_argument("file", help="UTF-8 .txt/.md file, or - for stdin")
    p.add_argument("--lang", choices=["pl", "en"], help="language (auto-detected by default)")
    p.add_argument(
        "--keep", action="append", default=[], metavar="TERM", help="term never anonymized (repeatable)"
    )
    p.add_argument("--format", choices=["diff", "side", "json", "anonymized"], default="diff")
    p.add_argument("--no-color", action="store_true", help="disable ANSI colors")
    return p.parse_args(argv)


def _paint(s: str, code: str, color: bool) -> str:
    return f"{code}{s}{_RESET}" if color else s


def _label_color(label: str) -> str:
    return _LABEL_COLORS.get(label, _ID_COLOR)


def render_diff(text: str, result: AnonymizationResult, color: bool) -> str:
    out, cursor = [], 0
    for span in result.spans:
        out.append(text[cursor : span.start])
        if color:
            out.append(f"{_label_color(span.label)}{span.text}{_RESET}{_DIM}→{span.placeholder}{_RESET}")
        else:
            out.append(f"⟦{span.text} → {span.placeholder}⟧")
        cursor = span.end
    out.append(text[cursor:])
    body = "".join(out)
    if not body.endswith("\n"):
        body += "\n"
    return body + "\n" + render_table(result, color)


def render_table(result: AnonymizationResult, color: bool) -> str:
    header = (
        f"{result.language} · {result.engine} · {len(result.entities)} entities, {len(result.spans)} spans\n"
    )
    if not result.entities:
        return header
    rows = [("PLACEHOLDER", "LABEL", "COUNT", "VALUE")] + [
        (e.placeholder, e.label, str(e.count), _truncate(e.value, 60)) for e in result.entities
    ]
    widths = [max(len(r[i]) for r in rows) for i in range(3)]
    lines = []
    for n, (ph, label, count, value) in enumerate(rows):
        line = f"{ph:<{widths[0]}}  {label:<{widths[1]}}  {count:>{widths[2]}}  {value}"
        lines.append(_paint(line, _BOLD, color) if n == 0 else line)
    return header + "\n".join(lines) + "\n"


def render_side(text: str, result: AnonymizationResult, color: bool) -> str:
    width = shutil.get_terminal_size((120, 40)).columns
    col = max(20, (width - 3) // 2)
    lines = [f"{'ORIGINAL':<{col}} │ ANONYMIZED", f"{'─' * col}─┼─{'─' * col}"]
    for left, right in zip_longest(text.splitlines(), result.text.splitlines(), fillvalue=""):
        left_rows = textwrap.wrap(left, col) or [""]
        right_rows = textwrap.wrap(right, col) or [""]
        for l_row, r_row in zip_longest(left_rows, right_rows, fillvalue=""):
            if color:
                r_row = PLACEHOLDER_RE.sub(lambda m: _paint(m.group(), _BOLD + "\x1b[35m", True), r_row)
            lines.append(f"{l_row:<{col}} │ {r_row}")
    return "\n".join(lines) + "\n\n" + render_table(result, color)


def render_json(text: str, result: AnonymizationResult, color: bool) -> str:
    return json.dumps(result.to_dict(), ensure_ascii=False, indent=2) + "\n"


def render_anonymized(text: str, result: AnonymizationResult, color: bool) -> str:
    return result.text


def _truncate(value: str, limit: int) -> str:
    value = re.sub(r"\s+", " ", value)
    return value if len(value) <= limit else value[: limit - 1] + "…"


if __name__ == "__main__":
    sys.exit(main())
