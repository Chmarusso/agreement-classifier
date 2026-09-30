import re
import unittest
from pathlib import Path

from anonymizer import anonymize

SOURCES = Path(__file__).resolve().parents[3] / "seeds" / "agreements" / "sources"
NAME_LINE = re.compile(r"^(?:Name|Imię i nazwisko):[ \t]*(\S.*)$")


@unittest.skipUnless(SOURCES.is_dir(), f"fixtures not found at {SOURCES}")
class FixtureTest(unittest.TestCase):
    def test_fixtures(self):
        files = sorted(SOURCES.glob("*.md"))
        self.assertTrue(files)
        for path in files:
            with self.subTest(fixture=path.name):
                text = path.read_text(encoding="utf-8")
                result = anonymize(text)
                original_lines = text.splitlines()
                anonymized_lines = result.text.splitlines()
                self.assertEqual(len(original_lines), len(anonymized_lines))
                for before, after in zip(original_lines, anonymized_lines):
                    if before.startswith("#"):
                        self.assertEqual(after, before)
                    name = NAME_LINE.match(before)
                    if name:
                        self.assertRegex(after, r"^(?:Name|Imię i nazwisko):[ \t]*<PERSON_\d+>$")
                        self.assertNotIn(name.group(1), result.text)


if __name__ == "__main__":
    unittest.main()
