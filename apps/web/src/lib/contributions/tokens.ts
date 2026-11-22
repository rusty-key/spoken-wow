/**
 * A contributed English line's text from its template: `written_text` in
 * pipelines/quests/tts_cli/tts_utils.py, which is what the extract does to every line it reads.
 *
 * A contribution is stored with the reader's name, class and race put back as `$N`, `$C` and
 * `$R` (reader.ts), so it is the same kind of text the extract starts from: the template is the
 * line's `originalText`, and this is its `text`. The tokens stay, as the extract's do, for
 * player-words.ts to say in English's words.
 *
 * Must match the Python exactly: a contributed line written one way and an extracted one another
 * would be the same corpus speaking two ways.
 */
const REPLACE: readonly (readonly [string, string])[] = [
  ["$b", "\n"],
  ["$B", "\n"],
];

// The site leaves a token glued to a letter ("$nath") unsaid, and its takes say the word.
const GLUED_TOKEN = /\$([NnCcRr])(?=\p{L})/gu;
const GLUED_WORDS: Readonly<Record<string, string>> = {
  n: "adventurer",
  N: "Adventurer",
  c: "adventurer",
  C: "Adventurer",
  r: "traveler",
  R: "Traveler",
};

export function writtenFromTemplate(template: string): string {
  return REPLACE.reduce((text, [token, word]) => text.replaceAll(token, word), template).replace(
    GLUED_TOKEN,
    (_, token: string) => GLUED_WORDS[token],
  );
}
