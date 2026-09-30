import type { AgreementLanguage } from "@app/domain";

const POLISH_WORDS = new Set(
  "i w z ze na się oraz jest lub przez do nie że od po a o dla za przy jako który która które tym tego pod nad umowa umowy strony stron zł wynosi zawarta pomiędzy".split(
    " ",
  ),
);
const ENGLISH_WORDS = new Set("the and of to shall by this agreement in or is be any with".split(" "));
const POLISH_LETTERS = /[ąćęłńóśźż]/giu;

/**
 * Polish or English, from common words and Polish letters. Other languages count as English.
 * A bilingual Polish/English agreement counts as Polish, since the Polish version usually prevails.
 */
export function detectLanguage(text: string): AgreementLanguage {
  const sample = text.slice(0, 20_000).toLowerCase();
  let pl = 0;
  let en = 0;
  for (const w of sample.match(/\p{L}+/gu) ?? []) {
    if (POLISH_WORDS.has(w)) pl++;
    else if (ENGLISH_WORDS.has(w)) en++;
  }
  pl += (sample.match(POLISH_LETTERS)?.length ?? 0) / 4;
  return pl > en ? "pl" : "en";
}
