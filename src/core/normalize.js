// One name normaliser, shared by the pipeline (scripts/) and the app (src/).
// Pure, no DOM, no Node APIs. Two names that a listener would call "the same" should produce the same key.
//
// Steps (see docs/ARCHITECTURE.md, "Name normalisation"):
//   Unicode NFKD -> drop Latin-style combining accents -> fold a few letters NFKD leaves alone (ø, ł, ß ...)
//   -> lowercase -> "&" becomes "and" -> punctuation dropped, all Unicode letters and digits kept
//   -> whitespace collapsed -> a leading "the " dropped.

// Combining-diacritic blocks only. Other marks (kana dakuten, Indic vowel signs, Hangul) carry meaning
// and are kept, otherwise が/か or Hindi names would collapse.
const COMBINING_ACCENTS = /[̀-ͯ᪰-᫿᷀-᷿⃐-⃿︠-︯]/g;

// Letters that NFKD does not decompose but that people type without the stroke/ligature.
const FOLD = { 'ø': 'o', 'ł': 'l', 'đ': 'd', 'ð': 'd', 'þ': 'th', 'æ': 'ae', 'œ': 'oe', 'ß': 'ss', 'ı': 'i' };
const FOLD_RE = /[øłđðþæœßı]/g;

// Apostrophes and dots vanish inside a word ("Guns N' Roses" = "Guns N Roses", "a.m." = "am").
const JOINERS = /['‘’ʼ`´.]/g;
// Every other character that is not a letter, digit, mark or whitespace separates words ("Jay-Z" = "Jay Z").
const SEPARATORS = /[^\p{L}\p{N}\p{M}\s]/gu;

/**
 * @param {unknown} name
 * @returns {string} normalised key; '' only for empty or whitespace-only input
 */
export function normalizeName(name) {
  const input = String(name ?? '').trim();
  if (!input) return '';

  const base = input
    .normalize('NFKD')
    .replace(COMBINING_ACCENTS, '')
    .toLowerCase()
    .replace(FOLD_RE, (c) => FOLD[c])
    .normalize('NFC');

  const key = base
    .replace(/&/g, ' and ')
    .replace(JOINERS, '')
    .replace(SEPARATORS, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^the (?=.)/, '');

  // A name made only of punctuation or symbols ("!!!", "???") must not collapse to '' and collide.
  return key || base.replace(/\s+/g, ' ').trim();
}
