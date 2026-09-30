"""Recall targets from seeds/anonymization: every mustReplace gone, every mustKeep intact."""

import json
import unittest
from pathlib import Path

from anonymizer import anonymize

SAMPLES = Path(__file__).resolve().parents[3] / "seeds" / "anonymization"
KEEP = ["Northwind Analytics"]  # the auditing company's own name is always on the keep list


def _sample_text(expected: dict) -> str | None:
    for path in (SAMPLES / "sources" / f"{expected['slug']}.md", SAMPLES / "files" / expected["file"]):
        if path.suffix in (".md", ".txt") and path.is_file():
            return path.read_text(encoding="utf-8")
    return None


@unittest.skipUnless((SAMPLES / "expected").is_dir(), f"samples not found at {SAMPLES}")
class SampleRecallTest(unittest.TestCase):
    def test_samples(self):
        files = sorted((SAMPLES / "expected").glob("*.json"))
        self.assertTrue(files)
        for path in files:
            expected = json.loads(path.read_text(encoding="utf-8"))
            with self.subTest(sample=expected["slug"]):
                text = _sample_text(expected)
                if text is None:
                    self.skipTest(f"no text source for {expected['slug']}")
                result = anonymize(text, keep=KEEP)
                self.assertEqual(result.language, expected["language"])
                leaked = [s for s in expected["mustReplace"] if s in result.text]
                lost = [s for s in expected["mustKeep"] if s not in result.text]
                self.assertEqual(leaked, [], "PII left in the output")
                self.assertEqual(lost, [], "text that must stay was anonymized")


if __name__ == "__main__":
    unittest.main()
