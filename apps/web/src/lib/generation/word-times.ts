/**
 * When each word of a take starts, from ElevenLabs' character alignment.
 *
 * The alignment is of the text that was sent, which is not the text the addon shows: the sent
 * text carries bracketed directions (the race accent, the lead-in), the player's $N spoken as a
 * word, and the committed pronunciation spellings. So the times are found per spoken word and
 * then laid onto the shown words, and a take whose words do not line up keeps none. A take
 * with no times is estimated by the captions, which is safe; times shifted by one word light
 * the wrong word for the rest of the line.
 */

/** One spoken word and when it starts, in seconds. */
export type WordStart = { word: string; start: number };

/** The part of ElevenLabs' `alignment` this reads. */
export type Alignment = {
  characters: string[];
  character_start_times_seconds: number[];
};

/**
 * The words of an alignment, bracketed tags left out: ElevenLabs times a direction as though it
 * were said, and nothing shows it. `breaks` are character indices that start a word with no
 * space before them, as the dialogue endpoint joins its turns ("there.He").
 */
export function wordStarts(alignment: Alignment, breaks: readonly number[] = []): WordStart[] {
  const words: WordStart[] = [];
  const starts = new Set(breaks);
  let current: WordStart | null = null;
  let inTag = false;
  alignment.characters.forEach((char, index) => {
    if (starts.has(index)) current = null;
    if (char === "[") inTag = true;
    if (inTag) {
      if (char === "]") inTag = false;
      current = null;
      return;
    }
    if (/\s/.test(char)) {
      current = null;
      return;
    }
    if (!current) {
      current = { word: "", start: alignment.character_start_times_seconds[index] ?? 0 };
      words.push(current);
    }
    current.word += char;
  });
  return words;
}

/** Letters and digits only, lowercased: enough to tell a title word from a page word. */
function bare(word: string): string {
  return word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

/**
 * One start per word of `shown`, or null when the spoken words cannot be matched to them.
 *
 * Equal counts are matched by position and not by spelling, because a pronunciation rule or a
 * spoken $N changes the spelling and not the count. More spoken words than shown is a book's
 * first page, read with its title ahead of the words the page holds: kept only when the shown
 * words end the spoken ones word for word.
 */
export function timesFor(shown: string, spoken: readonly WordStart[]): number[] | null {
  const words = shown.split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  let matched = spoken;
  if (spoken.length > words.length) {
    matched = spoken.slice(spoken.length - words.length);
    if (!matched.every((word, index) => bare(word.word) === bare(words[index]))) return null;
  } else if (spoken.length < words.length) {
    return null;
  }
  return matched.map((word) => Math.round(Math.max(0, word.start) * 1000) / 1000);
}
