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
 * reaches the tables from the dump, from another source for Portuguese, from a player and from a
 * translator, and one place to substitute covers all of them without rewriting any of them;
 * the words themselves are a native speaker's call, and changing one reaches every line at once
 * (and marks its takes stale, which is what they then are).
 *
 * The languages a game client runs in keep default words here. A language's row
 * (`language."playerWords"`), which its text maintainers edit on the site, wins over them, and
 * is a team's language's only words; it must be registered before the text is spoken.
 *
 * ruRU wraps a token in the client's declension escape, `|3-6($c)`: the client prints the class
 * in grammatical case 6. A reader's `cases` give the word for each case; a case with none keeps
 * the whole escape, so the gate refuses the line rather than voice "|3-6(путник)".
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
const WORDS = {
  enUS: {
    m: { name: "adventurer", race: "traveler" },
    f: { name: "adventurer", race: "traveler" },
    quantity: "an order of",
  },
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
  ptBR: {
    m: { name: "aventureiro", race: "viajante" },
    f: { name: "aventureira", race: "viajante" },
    quantity: "algumas unidades de",
  },
  ruRU: { m: { name: "путник", race: "странник" }, f: { name: "путница", race: "странница" } },
  koKR: { m: { name: "모험가", race: "여행자" }, f: { name: "모험가", race: "여행자" } },
  zhCN: { m: { name: "冒险者", race: "旅行者" }, f: { name: "冒险者", race: "旅行者" } },
  zhTW: { m: { name: "冒險者", race: "旅行者" }, f: { name: "冒險者", race: "旅行者" } },
};

// The database's words for languages beyond WORDS, by code. On globalThis because the site loads
// this module once per bundle layer.
const registeredKey = Symbol.for("spoken.playerWords");
const registered = (globalThis[registeredKey] ??= { byLang: new Map() });

/** Whether Spoken has default words for `lang`, which a row's words replace. */
export function hasBuiltinPlayerWords(lang) {
  return Object.hasOwn(WORDS, lang);
}

export function hasRegisteredPlayerWords(lang) {
  return registered.byLang.has(lang);
}

export function builtinPlayerWordsOf(lang) {
  return hasBuiltinPlayerWords(lang) ? WORDS[lang] : null;
}

export function playerWordsOf(lang) {
  return registered.byLang.get(lang) ?? builtinPlayerWordsOf(lang);
}

/** Replaces every registered language's words: `entries` is [code, words] pairs, words as stored. */
export function registerPlayerWords(entries) {
  const byLang = new Map();
  for (const [lang, words] of entries) {
    const valid = validPlayerWords(words);
    if (valid) byLang.set(lang, valid);
  }
  registered.byLang = byLang;
}

/** The database's words as `code, JSON text` rows, for a build outside the site to register. */
export const PLAYER_WORDS_SQL = `select "code", "playerWords"::text from "language" where "playerWords" is not null`;

/** Registers PLAYER_WORDS_SQL's rows, as [code, JSON text] pairs. */
export function registerPlayerWordRows(rows) {
  registerPlayerWords(rows.map(([code, json]) => [code, JSON.parse(json)]));
}

export const WORD_LIMIT = 40;
const REQUIRED = ["name", "race"];
const OPTIONAL = ["nameGenitive", "classPlural"];
const CASE = /^[1-9]$/;

function validWord(value) {
  if (typeof value !== "string") return null;
  const word = value.trim().normalize("NFC");
  // A `$` would be read as a token again; a word ending a branch would break one.
  if (!word || word.length > WORD_LIMIT || /[$:;\n]/.test(word)) return null;
  return word;
}

function validForms(value) {
  if (!value || typeof value !== "object") return null;
  const forms = {};
  for (const key of REQUIRED) {
    const word = validWord(value[key]);
    if (!word) return null;
    forms[key] = word;
  }
  for (const key of OPTIONAL) {
    const word = optionalWord(value[key]);
    if (word === null) return null;
    if (word) forms[key] = word;
  }
  if (value.cases != null) {
    const cases = validCases(value.cases);
    if (cases === null) return null;
    if (cases) forms.cases = cases;
  }
  return forms;
}

/** `{ "1": { name?, race? }, ... }` without its empty words: undefined when none is left, null when invalid. */
function validCases(value) {
  if (typeof value !== "object" || Array.isArray(value)) return null;
  const cases = {};
  for (const n of Object.keys(value).sort()) {
    if (!CASE.test(n) || !value[n] || typeof value[n] !== "object") return null;
    const declined = {};
    for (const key of REQUIRED) {
      const word = optionalWord(value[n][key]);
      if (word === null) return null;
      if (word) declined[key] = word;
    }
    if (Object.keys(declined).length) cases[n] = declined;
  }
  return Object.keys(cases).length ? cases : undefined;
}

/** An optional word: undefined when absent or empty, null when unspeakable. */
function optionalWord(value) {
  return value == null || value === "" ? undefined : validWord(value);
}

/**
 * Words as `{ m: { name, race, nameGenitive?, classPlural?, cases? }, f: {...}, quantity? }`,
 * trimmed, or null when any is missing, empty, longer than WORD_LIMIT, or holds a `$`, `:`, `;` or
 * line break, or a case is not a digit 1 to 9.
 * `quantity` is what a Craftsman's Writ's `$2oa` says.
 */
export function validPlayerWords(value) {
  if (!value || typeof value !== "object") return null;
  const m = validForms(value.m);
  const f = validForms(value.f);
  const quantity = optionalWord(value.quantity);
  if (!m || !f || quantity === null) return null;
  return quantity ? { m, f, quantity } : { m, f };
}

/** German capitalises every noun; the rest only at the start of a sentence. */
const ALWAYS_CAPITAL = new Set(["deDE"]);

// A letter that glues to a token. Chinese and Japanese write no spaces at all, and Korean
// attaches its particles ("$N님"), so a character of theirs after a token is the next word,
// not the same one.
const GLUED = String.raw`(?![\p{sc=Han}\p{sc=Hangul}\p{sc=Hiragana}\p{sc=Katakana}])\p{L}`;
// Not followed by a glued letter: see "glued" above.
// Not inside a declension escape: one without its case's word must keep its `$` for the gate.
const UNDECLINED = String.raw`(?<!\|3-\d+\()`;
const TOKEN = new RegExp(String.raw`${UNDECLINED}\$([NnCcRr])(?!${GLUED})`, "gu");
const DECLINED = /\|3-(\d+)\(\$([NnCcRr])\)/g;
// Not $R: "des Reisenden" is no glued s, so "$Rs" stays refused.
const TOKEN_GENITIVE = new RegExp(String.raw`${UNDECLINED}\$([NnCc])s(?!\p{L})`, "gu");
// Not $N or $R: the class is the only glued plural seen in frFR text. Not before an apostrophe
// either: "$cs'il" is "$c s'il" with its space lost, not a plural.
const TOKEN_CLASS_PLURAL = new RegExp(String.raw`${UNDECLINED}\$[Cc]s(?![\p{L}'’])`, "gu");
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
// second. ptBR writes a glued "x" ("5x Tisana"). Every other language says its words'
// `quantity`; one with none keeps the token, so the gate still refuses the line.
const QUANTITY = /\$\d+oax?\s+/g;
const RU_FORMS = /\$\d+oa\s+([^\s:]+(?:\s+[^\s:]+)*):((?:\s*[^\s,.;:!?]+)+)/g;

function speakQuantities(text, lang, forms) {
  if (lang === "ruRU") {
    return text.replace(RU_FORMS, (whole, few, rest) => {
      const count = few.split(/\s+/).length;
      const words = rest.trim().split(/\s+/);
      if (words.length < count) return whole;
      const many = words.slice(0, count).join(" ");
      const after = words.slice(count).join(" ");
      return `несколько ${many}${after ? ` ${after}` : ""}`;
    });
  }
  return forms.quantity ? text.replace(QUANTITY, `${forms.quantity} `) : text;
}

/** Whether a text branches on the player's gender, and so is two lines rather than one. */
export function branchesOnPlayerGender(text) {
  return HAS_GENDER.test(text);
}

const ANY_TOKEN = /\$\$?([NnCcRr])/g;
const ANY_GENDER = new RegExp(HAS_GENDER.source, "gu");

function writtenTokens(text) {
  const counts = { N: 0, C: 0, R: 0 };
  for (const [, token] of text.matchAll(ANY_TOKEN)) counts[token.toUpperCase()] += 1;
  return counts;
}

/**
 * The player tokens `lang` speaks in a text: `G`, its gender branches, and for each reader (`m`,
 * `f`) the `N`, `C` and `R` that speakPlayerTokens replaces on that reader's side. A token the
 * gate refuses ("$Nama") is not one. Correction acceptance compares these to find what a client
 * filled in for one reader; a language with no words counts its branches only.
 */
export function playerTokenCounts(text, lang) {
  const sides = playerGenderSides(text);
  const spoken = (side, gender) => {
    const written = writtenTokens(sides[side]);
    const left = writtenTokens(speakPlayerTokens(text, lang, gender));
    return { N: written.N - left.N, C: written.C - left.C, R: written.R - left.R };
  };
  return { G: text.match(ANY_GENDER)?.length ?? 0, m: spoken(0, "m"), f: spoken(1, "f") };
}

/** The text as a male and a female reader read it, every `$G` branch taken to its side. */
export function playerGenderSides(text) {
  return [text.replace(GENDER, "$1").replace(SWAPPED, "$1"), text.replace(GENDER, "$2").replace(SWAPPED, "$2")];
}

/**
 * The text with its player tokens in the two forms the addon fills (Utils:FillPlayerTokens): `$N`
 * and `$gmale:female;`. A doubled `$$`, `$u`, its swapped separators and ruRU's third field are not.
 */
export function writtenPlayerTokens(text) {
  return text.replace(DOUBLED, "$").replace(GENDER, "$$g$1:$2;").replace(SWAPPED, "$$g$1:$2;");
}

/** The text as it is spoken in `lang`, by a reader of `playerGender` where the line has one. */
export function speakPlayerTokens(text, lang, playerGender = null) {
  const forms = playerWordsOf(lang);
  if (!forms) return text;
  text = speakQuantities(text, lang, forms);
  const words = playerGender === "f" ? forms.f : forms.m;
  const cased = (word, at, whole) =>
    ALWAYS_CAPITAL.has(lang) || SENTENCE_START.test(whole.slice(0, at))
      ? word[0].toUpperCase() + word.slice(1)
      : word;

  const side = playerGender === "f" ? "$2" : "$1";
  let spoken = text.replace(DOUBLED, "$").replace(GENDER, side).replace(SWAPPED, side);
  spoken = spoken.replace(DECLINED, (whole, n, token, at, all) => {
    const word = words.cases?.[n]?.[token.toUpperCase() === "R" ? "race" : "name"];
    return word ? cased(word, at, all) : whole;
  });
  const genitive = words.nameGenitive;
  if (genitive) {
    spoken = spoken.replace(TOKEN_GENITIVE, (_, _token, at, whole) =>
      cased(genitive, at, whole),
    );
  }
  const plural = words.classPlural;
  if (plural) {
    spoken = spoken.replace(TOKEN_CLASS_PLURAL, (_, at, whole) => cased(plural, at, whole));
  }
  return spoken.replace(TOKEN, (_, token, at, whole) =>
    cased(token.toUpperCase() === "R" ? words.race : words.name, at, whole),
  );
}
