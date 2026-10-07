/**
 * What a line says where the game would say the reader's name, class or race.
 *
 * Blizzard writes `$N`, `$C` and `$R` into quest text and the client puts the player's own
 * words there. A recording is one file for everybody, so it says a word that fits anybody.
 * The English quest extract writes "Adventurer" and "Traveler" into its text once, at
 * extraction (REPLACE_DICT in pipelines/quests/tts_cli/tts_utils.py; contributions/tokens.ts),
 * so English quest text reaches here with nothing left to replace. Everything else -- a quest
 * translation, and a book page in any language -- keeps its tokens as stored, and this puts
 * the language's word in at the point the text is judged and sent: the gate, the request and
 * the staleness hash all see the same string. Kept out of the rows on purpose: a translation
 * reaches the tables from the dump, from another source for Portuguese, from the QuestIT
 * community for Italian, from a player and from a translator, and one place to substitute
 * covers all of them without rewriting any of
 * them; the words themselves are a native speaker's call, and changing one here reaches
 * every line at once (and marks its takes stale, which is what they then are).
 *
 * About nine tokens in ten are the reader being addressed ("Gut gemacht, $C."), where any
 * "adventurer" reads naturally. The rest read as awkwardly as the English does and are fixed
 * per line by a translator.
 *
 * A token glued to a following letter ("$Nama", ruRU's broken "$nдруг:подруга") is left
 * alone, so the text gate still refuses the line: substituting would voice "adventurerama".
 * German's genitive s is the one exception ("Legion $Ns"), spoken as the word's own genitive.
 *
 * CLIENT-SAFE: the explorer asks the text gate, and the gate asks this.
 */
import type { Lang } from "./lang";

type Words = { name: string; race: string; nameGenitive?: string };

/**
 * `name` stands for $N and $C, `race` for $R, lowercase as they read mid-sentence.
 * `nameGenitive` is what a $N or $C with a glued "s" says, in a language whose templates write
 * one; the feminine German genitive takes no s.
 *
 * The feminine form is what a line's female variant says: where the English line branches on
 * $G, the translation is imported twice, `playerGender` "m" and "f", and the addon plays the
 * one matching the reader. Every other line is one file for both, and its words are the
 * masculine ones, which is what Blizzard's own translations default to around them
 * ("vous êtes venu").
 */
const WORDS: Partial<Record<Lang, { m: Words; f: Words }>> = {
  enUS: { m: { name: "adventurer", race: "traveler" }, f: { name: "adventurer", race: "traveler" } },
  deDE: {
    m: { name: "Abenteurer", race: "Reisender", nameGenitive: "Abenteurers" },
    f: { name: "Abenteurerin", race: "Reisende", nameGenitive: "Abenteurerin" },
  },
  esES: { m: { name: "aventurero", race: "viajero" }, f: { name: "aventurera", race: "viajera" } },
  esMX: { m: { name: "aventurero", race: "viajero" }, f: { name: "aventurera", race: "viajera" } },
  frFR: { m: { name: "aventurier", race: "voyageur" }, f: { name: "aventurière", race: "voyageuse" } },
  itIT: { m: { name: "avventuriero", race: "viaggiatore" }, f: { name: "avventuriera", race: "viaggiatrice" } },
  ptBR: { m: { name: "aventureiro", race: "viajante" }, f: { name: "aventureira", race: "viajante" } },
  ruRU: { m: { name: "путник", race: "странник" }, f: { name: "путница", race: "странница" } },
  koKR: { m: { name: "모험가", race: "여행자" }, f: { name: "모험가", race: "여행자" } },
  zhCN: { m: { name: "冒险者", race: "旅行者" }, f: { name: "冒险者", race: "旅行者" } },
  zhTW: { m: { name: "冒險者", race: "旅行者" }, f: { name: "冒險者", race: "旅行者" } },
};

/** German capitalises every noun; the rest only at the start of a sentence. */
const ALWAYS_CAPITAL: ReadonlySet<Lang> = new Set(["deDE"]);

// Not followed by a letter: see "glued" above.
const TOKEN = /\$([NnCcRr])(?!\p{L})/gu;
// Not $R: "des Reisenden" is no glued s, so "$Rs" stays refused.
const TOKEN_GENITIVE = /\$([NnCc])s(?!\p{L})/gu;
// $gmale:female; and ruRU's $gmale:female:c; whose third field names the token the
// adjective agrees with. The import resolves the two-field form already; the three-field
// form slips past its pattern and arrives here.
const GENDER = /\$[Gg]\s*([^:;]+?)\s*:\s*([^:;]+?)\s*(?::[^:;]*)?;/g;
// deDE's own templates, the Forever quests' above all, also write the branch as $u.
const GENDER_DE = /\$[GgUu]\s*([^:;]+?)\s*:\s*([^:;]+?)\s*(?::[^:;]*)?;/g;
// Whatever may stand between a sentence's end and its first word: space, a line break, an
// opening quote or Spanish's inverted marks.
const SENTENCE_START = /(?:^|[.!?…。！？]|\n)[\s"'«„“¡¿]*$/u;

/** The text as it is spoken in `lang`, by a reader of `playerGender` where the line has one. */
export function speakPlayerTokens(
  text: string,
  lang: Lang,
  playerGender: "m" | "f" | null = null,
): string {
  const forms = WORDS[lang];
  if (!forms) return text;
  const words = playerGender === "f" ? forms.f : forms.m;
  const cased = (word: string, at: number, whole: string) =>
    ALWAYS_CAPITAL.has(lang) || SENTENCE_START.test(whole.slice(0, at))
      ? word[0].toUpperCase() + word.slice(1)
      : word;

  let spoken = text.replace(lang === "deDE" ? GENDER_DE : GENDER, (_, male: string, female: string) =>
    playerGender === "f" ? female : male,
  );
  const genitive = words.nameGenitive;
  if (genitive) {
    spoken = spoken.replace(TOKEN_GENITIVE, (_, _token: string, at: number, whole: string) =>
      cased(genitive, at, whole),
    );
  }
  return spoken.replace(TOKEN, (_, token: string, at: number, whole: string) =>
    cased(token.toUpperCase() === "R" ? words.race : words.name, at, whole),
  );
}
