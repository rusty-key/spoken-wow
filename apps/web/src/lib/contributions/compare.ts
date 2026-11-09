/**
 * Whether a contributed text says what a corpus line already says.
 *
 * Not string equality. The two sides are written down differently even when they are the same
 * line: the corpus keeps the game's own template (`$B` for a paragraph break, `$n` or `$N` for
 * the player's name, `$Gman:woman;` for a word that follows the player's gender), and a
 * contribution is what one player's client displayed, with the paragraph breaks as real
 * newlines, one branch of every `$G` already picked, and the player's name, class and race put
 * back as `$N`, `$C` and `$R` by the addon (addons/Spoken_Quests/Contribute.lua, Detemplate).
 *
 * That last step guesses, and guesses both ways. A paladin reading "the paladins of the
 * alliance" sends "$C" where the corpus has the plain word, and a client that missed the name
 * sends "Index" where the corpus has `$N`. Either is still the same line. So a slot -- `$N`,
 * `$C` or `$R`, on either side -- stands for any one to three words on the other (a race can be
 * two, "Night Elf"), and everything else must match word for word and mark for mark. Spacing
 * and letter case never count: the corpus carries trailing and doubled spaces the client never
 * shows, and a line recapitalised between game versions sounds the same.
 *
 * frFR writes a class plural as `$cs`, and the client prints the s onto the class: "paladins",
 * one word, which the addon does not put back as a slot. So `$cs` is one slot whose run must end
 * in an s. Only `$cs` is read this way: the corpus's other glued forms, `$rs` and `$Ns`, still
 * split into a slot and a stray "s", and never match.
 *
 * Node-free, so the corrections tab's client component can split a line the same way.
 */

export type Token = { kind: "word" | "mark" | "slot"; value: string };

/** The most words a `$N`/`$C`/`$R` slot stands for. */
const SLOT_WORDS = 3;

const TOKEN = /\$[cC][sS](?![\p{L}\p{N}\p{M}])|\$[nNcCrR]|[\p{L}\p{N}\p{M}]+(?:['’\-][\p{L}\p{N}\p{M}]+)*|[^\s\p{L}\p{N}\p{M}]/gu;

const GENDER = /\$[gGuU]\s*([^:;]*?)\s*:\s*([^;]*?)\s*;/g;

/** A text as the words, marks and slots it is made of -- what both sides are compared as. */
export function tokensOf(text: string): Token[] {
  const flat = text.replace(/\$[bB]/g, " ");
  return Array.from(flat.matchAll(TOKEN), ([value]) =>
    value.startsWith("$")
      ? { kind: "slot", value: value.toUpperCase() }
      : /^[\p{L}\p{N}\p{M}]/u.test(value)
        ? { kind: "word", value }
        : { kind: "mark", value },
  );
}

/**
 * A template as a client of each gender shows it, and as it stands: one player has one gender,
 * so every `$G` takes the same side, and a client that left them unexpanded sends the template.
 */
export function genderForms(text: string): string[] {
  if (!/\$[gGuU]/.test(text)) return [text];
  return [text.replace(GENDER, "$1"), text.replace(GENDER, "$2"), text];
}

/** A `$cs` run ends in an s after the class, or "Les s" would pass for "Les $cs". */
function endsRun(word: string, slot: Token): boolean {
  return slot.value !== "$CS" || (word.length > 1 && /s$/i.test(word));
}

function matches(a: Token[], b: Token[]): boolean {
  const memo = new Map<number, boolean>();
  const go = (i: number, j: number): boolean => {
    if (i === a.length || j === b.length) return i === a.length && j === b.length;
    const key = i * (b.length + 1) + j;
    const known = memo.get(key);
    if (known !== undefined) return known;

    let result = false;
    const x = a[i];
    const y = b[j];
    if (x.kind === y.kind && x.value.toLocaleLowerCase() === y.value.toLocaleLowerCase()) result = go(i + 1, j + 1);
    // A slot on one side stands for a run of words on the other.
    for (const [slotSide, words, at, step] of [
      [x, b, j, (n: number) => go(i + 1, j + n)],
      [y, a, i, (n: number) => go(i + n, j + 1)],
    ] as const) {
      if (result || slotSide.kind !== "slot") continue;
      for (let n = 1; n <= SLOT_WORDS && at + n <= words.length && words[at + n - 1].kind === "word"; n++) {
        if (!endsRun(words[at + n - 1].value, slotSide)) continue;
        if (step(n)) {
          result = true;
          break;
        }
      }
    }
    memo.set(key, result);
    return result;
  };
  return go(0, 0);
}

/**
 * Whether `contributed` is the corpus line `current`, as the module docstring says: up to
 * spacing, paragraph breaks, the corpus's `$G` choices, and the addon's `$N`/`$C`/`$R` slots.
 */
export function sameLine(current: string, contributed: string): boolean {
  const theirs = tokensOf(contributed);
  return genderForms(current).some((form) => matches(tokensOf(form), theirs));
}

/**
 * How alike two texts are, 0 to 1: the share of words either uses that both do (Jaccard),
 * letter case aside. What picks, among a moment's wordings, the one a correction is a fix of.
 */
export function closeness(a: string, b: string): number {
  const words = (text: string) =>
    new Set(tokensOf(text).filter((token) => token.kind === "word").map((token) => token.value.toLocaleLowerCase()));
  const x = words(a);
  const y = words(b);
  const both = [...x].filter((word) => y.has(word)).length;
  const either = x.size + y.size - both;
  return either === 0 ? 0 : both / either;
}

/** A corpus template as a reader sees it: the game's `$B` paragraph breaks as line breaks. */
export function readable(template: string): string {
  return template.replace(/\$[bB]/g, "\n");
}

/** A run of one side's text, and whether the other side lacks it. */
export type DiffPart = { text: string; changed: boolean };

/**
 * The words that differ between two texts, for the corrections tab to mark: each side as runs
 * of its own text, the words not in their longest common sequence marked changed. Spacing is
 * kept as each side has it and never marked, and letter case is not a change.
 */
export function wordDiff(before: string, after: string): { before: DiffPart[]; after: DiffPart[] } {
  const a = before.split(/(\s+)/);
  const b = after.split(/(\s+)/);
  // Case-blind, as sameLine is: `$n` against `$N` is not a difference worth marking.
  const wordsA = a.filter((_, index) => index % 2 === 0).map((word) => word.toLocaleLowerCase());
  const wordsB = b.filter((_, index) => index % 2 === 0).map((word) => word.toLocaleLowerCase());

  // lcs[i][j]: the longest common sequence of wordsA from i and wordsB from j.
  const lcs = Array.from({ length: wordsA.length + 1 }, () => new Uint16Array(wordsB.length + 1));
  for (let i = wordsA.length - 1; i >= 0; i--) {
    for (let j = wordsB.length - 1; j >= 0; j--) {
      lcs[i][j] = wordsA[i] === wordsB[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const keptA = new Set<number>();
  const keptB = new Set<number>();
  for (let i = 0, j = 0; i < wordsA.length && j < wordsB.length; ) {
    if (wordsA[i] === wordsB[j]) {
      keptA.add(i++);
      keptB.add(j++);
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) i++;
    else j++;
  }

  const parts = (pieces: string[], kept: Set<number>): DiffPart[] => {
    const wordChanged = (index: number) => index < pieces.length && !kept.has(index / 2);
    const out: DiffPart[] = [];
    for (const [index, text] of pieces.entries()) {
      if (!text) continue;
      // Spacing between two changed words is part of that change, so a changed phrase is one
      // mark rather than one per word; any other spacing is unchanged.
      const changed = index % 2 === 0 ? wordChanged(index) : wordChanged(index - 1) && wordChanged(index + 1);
      const last = out[out.length - 1];
      if (last?.changed === changed) last.text += text;
      else out.push({ text, changed });
    }
    return out;
  };
  return { before: parts(a, keptA), after: parts(b, keptB) };
}
