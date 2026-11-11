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
 * community for Italian, from Forever's translators for Vietnamese, from a player and from a
 * translator, and one place to substitute covers all of them without rewriting any of them;
 * the words themselves are a native speaker's call, and changing one here reaches
 * every line at once (and marks its takes stale, which is what they then are).
 *
 * About nine tokens in ten are the reader being addressed ("Gut gemacht, $C."), where any
 * "adventurer" reads naturally. The rest read as awkwardly as the English does and are fixed
 * per line by a translator.
 *
 * A token glued to a following letter ("$Nama", ruRU's broken "$nдруг:подруга") is left
 * alone, so the text gate still refuses the line: substituting would voice "adventurerama".
 * Two glued s are exceptions: German's genitive ("Legion $Ns"), spoken as the word's own
 * genitive, and French's class plural ("les $cs"), spoken as the word's own plural.
 *
 * CLIENT-SAFE: the explorer asks the text gate, and the gate asks this.
 */
import type { Lang } from "./lang";

type Words = { name: string; race: string; nameGenitive?: string; classPlural?: string };

/**
 * `name` stands for $N and $C, `race` for $R, lowercase as they read mid-sentence.
 * `nameGenitive` is what a $N or $C with a glued "s" says, in a language whose templates write
 * one; the feminine German genitive takes no s. `classPlural` is what a $C with a glued "s" says
 * where that s is a plural, as frFR's "$cs" is: the game prints the class with the s on.
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
  frFR: {
    m: { name: "aventurier", race: "voyageur", classPlural: "aventuriers" },
    f: { name: "aventurière", race: "voyageuse", classPlural: "aventurières" },
  },
  itIT: { m: { name: "avventuriero", race: "viaggiatore" }, f: { name: "avventuriera", race: "viaggiatrice" } },
  plPL: { m: { name: "wędrowcze", race: "wędrowiec" }, f: { name: "wędrowczyni", race: "wędrowczyni" } },
  ptBR: { m: { name: "aventureiro", race: "viajante" }, f: { name: "aventureira", race: "viajante" } },
  ruRU: { m: { name: "путник", race: "странник" }, f: { name: "путница", race: "странница" } },
  koKR: { m: { name: "모험가", race: "여행자" }, f: { name: "모험가", race: "여행자" } },
  zhCN: { m: { name: "冒险者", race: "旅行者" }, f: { name: "冒险者", race: "旅行者" } },
  zhTW: { m: { name: "冒險者", race: "旅行者" }, f: { name: "冒險者", race: "旅行者" } },
  viVN: { m: { name: "nhà thám hiểm", race: "lữ khách" }, f: { name: "nhà thám hiểm", race: "lữ khách" } },
};

/** German capitalises every noun; the rest only at the start of a sentence. */
const ALWAYS_CAPITAL: ReadonlySet<Lang> = new Set(["deDE"]);

// A letter that glues to a token. Chinese and Japanese write no spaces at all, and Korean
// attaches its particles ("$N님"), so a character of theirs after a token is the next word,
// not the same one.
const GLUED = String.raw`(?![\p{sc=Han}\p{sc=Hangul}\p{sc=Hiragana}\p{sc=Katakana}])\p{L}`;
// Not followed by a glued letter: see "glued" above.
const TOKEN = new RegExp(String.raw`\$([NnCcRr])(?!${GLUED})`, "gu");
// Not $R: "des Reisenden" is no glued s, so "$Rs" stays refused.
const TOKEN_GENITIVE = /\$([NnCc])s(?!\p{L})/gu;
// Not $N or $R: the class is the only glued plural seen in frFR text. Not before an apostrophe
// either: "$cs'il" is "$c s'il" with its space lost, not a plural.
const TOKEN_CLASS_PLURAL = /\$[Cc]s(?![\p{L}'’])/gu;
// $gmale:female; and ruRU's $gmale:female:c; whose third field names the token the
// adjective agrees with. The import resolves the two-field form already; the three-field
// form slips past its pattern and arrives here. No branch ends a sentence: one whose `;` was
// lost would otherwise run on to a later sentence's `;` and drop the words between unheard.
const ENDS = ".!?…。！？";
const FIELD = String.raw`[^:;${ENDS}\n]`;
const BRANCH = String.raw`\s*(${FIELD}+?)\s*:\s*(${FIELD}+?)\s*(?::${FIELD}*)?;`;
// $u is the same branch: ptBR's templates write it, and deDE's Forever quests.
const GENDER = new RegExp(String.raw`\$[GgUu]` + BRANCH, "g");
// Forever's deDE gossip also writes $u with its separators swapped, "$uBürger;Bürgerin:", male
// first all the same. Neither field may hold the other's separator, so a normal branch never
// reads as one. Its `;` stands between two letters, where a sentence's own `;` and a normal
// branch's end are followed by a space or a mark: a $u that lost its `:` would otherwise read
// on to a later colon and drop the words between unheard.
const SWAPPED = new RegExp(String.raw`\$[Uu]\s*(${FIELD}+?)(?<=\p{L});(?=\p{L})(${FIELD}+?)\s*:`, "gu");
const HAS_GENDER = new RegExp(`${GENDER.source}|${SWAPPED.source}`, "u");
// TBC Anniversary and Forever send some lines with the token's $ doubled ("$$N, …"), which the
// client reads as the token itself. Left doubled, a genitive "$$Ns" would say "$Abenteurers".
const DOUBLED = new RegExp(String.raw`\$\$(?=[NnCcRr](?!${GLUED})|[NnCc]s(?!\p{L}))`, "gu");
// Whatever may stand between a sentence's end and its first word: space, a line break, an
// opening quote or Spanish's inverted marks.
const SENTENCE_START = new RegExp(String.raw`(?:^|[${ENDS}]|\n)[\s"'«„“¡¿]*$`, "u");

// A Craftsman's Writ asks for `$2oa` of an item: a count the client fills in from the quest's
// objective, which no recording can know. Each language says "some" in words that keep the
// sentence's grammar. ruRU writes the noun phrase twice, "мундира:мундиров", as the count's
// two plural forms, the second having as many words as the first; its "несколько" takes the
// second. ptBR writes a glued "x" ("5x Tisana"). A language with no entry keeps the token,
// so the gate still refuses the line.
const QUANTITY = /\$\d+oax?\s+/g;
const QUANTITY_WORDS: Partial<Record<Lang, string>> = {
  enUS: "an order of ",
  ptBR: "algumas unidades de ",
};
const RU_FORMS = /\$\d+oa\s+([^\s:]+(?:\s+[^\s:]+)*):((?:\s*[^\s,.;:!?]+)+)/g;

function speakQuantities(text: string, lang: Lang): string {
  if (lang === "ruRU") {
    return text.replace(RU_FORMS, (whole, few: string, rest: string) => {
      const count = few.split(/\s+/).length;
      const words = rest.trim().split(/\s+/);
      if (words.length < count) return whole;
      const many = words.slice(0, count).join(" ");
      const after = words.slice(count).join(" ");
      return `несколько ${many}${after ? ` ${after}` : ""}`;
    });
  }
  const words = QUANTITY_WORDS[lang];
  return words ? text.replace(QUANTITY, words) : text;
}

/** Whether a text branches on the player's gender, and so is two lines rather than one. */
export function branchesOnPlayerGender(text: string): boolean {
  return HAS_GENDER.test(text);
}

/** The text as a male and a female reader read it, every `$G` branch taken to its side. */
export function playerGenderSides(text: string): [string, string] {
  return [text.replace(GENDER, "$1").replace(SWAPPED, "$1"), text.replace(GENDER, "$2").replace(SWAPPED, "$2")];
}

/** The text as it is spoken in `lang`, by a reader of `playerGender` where the line has one. */
export function speakPlayerTokens(
  text: string,
  lang: Lang,
  playerGender: "m" | "f" | null = null,
): string {
  const forms = WORDS[lang];
  if (!forms) return text;
  text = speakQuantities(text, lang);
  const words = playerGender === "f" ? forms.f : forms.m;
  const cased = (word: string, at: number, whole: string) =>
    ALWAYS_CAPITAL.has(lang) || SENTENCE_START.test(whole.slice(0, at))
      ? word[0].toUpperCase() + word.slice(1)
      : word;

  const side = playerGender === "f" ? "$2" : "$1";
  let spoken = text.replace(DOUBLED, "$").replace(GENDER, side).replace(SWAPPED, side);
  const genitive = words.nameGenitive;
  if (genitive) {
    spoken = spoken.replace(TOKEN_GENITIVE, (_, _token: string, at: number, whole: string) =>
      cased(genitive, at, whole),
    );
  }
  const plural = words.classPlural;
  if (plural) {
    spoken = spoken.replace(TOKEN_CLASS_PLURAL, (_, at: number, whole: string) => cased(plural, at, whole));
  }
  return spoken.replace(TOKEN, (_, token: string, at: number, whole: string) =>
    cased(token.toUpperCase() === "R" ? words.race : words.name, at, whole),
  );
}
