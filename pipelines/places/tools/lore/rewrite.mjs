// Turning a wiki article into lore, with Claude.
//
// The scrapers can select text but they cannot rewrite it, and selection alone was
// never going to fix what was wrong with the corpus. A wiki article is written for
// a player reading a website in 2026: it mentions quests, professions, patches and
// "you", it narrates every expansion at once, and its facts arrive in encyclopedic
// order rather than as a story. What the addon needs is a short piece of history
// about a place in a world that stopped at patch 1.15.
//
// So this module does the one job selection cannot: read the assembled source text
// and write it back as 1-3 paragraphs of in-world prose, under 1000 characters,
// inventing nothing.
//
// EVERY RESPONSE IS CACHED ON DISK, keyed by the exact inputs that produced it.
// Iterating on the prompt is the expensive part of this work, and without the cache
// each re-run of an unchanged zone would be a fresh bill. Bump PROMPT_VERSION when
// the prompt changes and the cache turns over by itself.

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

import Anthropic from "@anthropic-ai/sdk";

import { CACHE, isPostVanilla, normalise } from "../lib/wiki.mjs";
import { requireEnvKey } from "../lib/env.mjs";

export const DEFAULT_MODEL = "claude-sonnet-5";

// What the model is aimed at, and the ceiling every per-line budget is capped to.
// Roughly 150 words, which the narrator reads in about 76 seconds.
export const MAX_CHARS = 1000;

/**
 * The length above which a rewrite is withheld from the corpus.
 *
 * Deliberately looser than the target the model is given. Condensing plateaus on
 * the longest articles -- 229 lines used all three passes and were still over --
 * because a model asked to shorten its own draft anchors on it and shaves words
 * instead of dropping an episode. Discarding those lines meant keeping the
 * encyclopedic text they were written to replace, and it fell hardest on zone
 * lines, whose articles are the longest: 28 of 49 zones kept text like "Elwynn
 * Forest is the starting zone for playable humans".
 *
 * 1200 recovers two-thirds of them at about 90 seconds of narration instead of 76.
 * Anything still over that is genuinely bloated and wants a better rewrite rather
 * than a looser rule, so it stays flagged.
 *
 * MUST NOT feed targetChars. The budget is part of the response cache key, so
 * moving it re-bills every line whose source is long enough to be capped -- 282 of
 * them. Keeping the two numbers separate is what makes this threshold free to
 * change.
 */
export const ACCEPT_CHARS = 1200;

/**
 * How long this place's lore should be, given how much the article says about it.
 *
 * One cap for every place was the wrong instrument. Told only "under 1000", the
 * model wrote to the limit whatever it was given: a 342-character stub about
 * Nightmare Vale came back as 790 characters, and the difference was atmosphere it
 * had made up, because three facts do not fill three paragraphs. Meanwhile the
 * 19,000-character Tirisfal article had to be cut to the same 1000 either way.
 *
 * So the target follows the source. Below the cap it is roughly the length of the
 * material itself -- lore prose runs about as long as the facts it is built from,
 * so a short article honestly rendered stays short. Above it, every article gets
 * the same ceiling, and the choosing rule decides what survives.
 *
 * The floor exists because a two-line stub still deserves a readable sentence or
 * two rather than a fragment.
 */
export function targetChars(sourceLength) {
  return Math.min(MAX_CHARS, Math.max(250, Math.round(sourceLength * 0.85)));
}

// How far over a budget is worth a second API call and a line in the report. The
// budget is a steer, not a contract -- a piece that lands three characters over is
// exactly as good as one that lands three under, and treating the two differently
// would spend money to change nothing.
const TOLERANCE = 1.1;

export const overBudget = (text, budget) => text.length > budget * TOLERANCE;

// Bump on any change to SYSTEM_PROMPT or how the user turn is built. The cache key
// includes it, so a bump invalidates every stored response rather than silently
// serving text written under the old rules.
const PROMPT_VERSION = 4;

const REWRITE_CACHE = join(CACHE, "rewrite");

const SYSTEM_PROMPT = `You rewrite encyclopedia articles about places in the world of Azeroth into short pieces of in-world history, for an addon that narrates zone lore to a player exploring World of Warcraft Classic.

You will be given the text of a wiki article about one place. Write the lore of that place as a short story.

RULES

1. Use only facts stated in the article. Never invent a name, date, event, motive or detail that is not there, and never fill a gap from what you already know about Warcraft. In particular, if the article does not say where the place is, do not say where it is. If the article is thin, write something short rather than filling it out.

2. Write about the world, never about the game. The article was written for players; your text is written for someone standing in the place. Remove anything that only makes sense outside the world:
   - quests, quest givers, objectives, rewards, levels, factions as gameplay, reputation
   - professions or trainers available, vendors, flight paths, instance entrances
   - how to travel between places: roads as directions, zeppelin and boat routes, portals
   - references to players, characters, adventurers arriving, "you", or what someone will find here
   - patches, expansions, developers, models, maps, achievements, or the wiki itself
   Where such a sentence contains a real fact about the world, keep the fact and drop the framing: "players can find the Scarlet Crusade quartered here" becomes "the Scarlet Crusade is quartered here".

3. The world stopped before the Burning Crusade. Anything later than the fall of the Lich King's plague and the founding of the Forsaken -- the Dark Portal reopening, Outland, Northrend campaigns, the Cataclysm, and everything after -- is not part of this world. Drop it entirely rather than adjusting the tense. If a place was destroyed or changed after this point, describe it as it still stands.

   The article will often state later events as plain present fact, without naming any expansion: a town described as burned, flooded, rebuilt or retaken, a bridge lying broken, refugees from a disaster, a character holding a role they only took on later. You know the history of Warcraft; use that knowledge to recognize such claims and leave them out even when the article does not label them. This is the one purpose outside knowledge may serve -- removing, never adding. If you cannot place a claim in the timeline, leave it out.

4. Drop anything the article marks as non-canon or speculative, and anything from the Warcraft role-playing game books.

5. **Choose two or three things and tell them properly. This is the most important rule.** Most articles hold far more history than will fit, and a long article does not earn a long answer -- it means you must leave things out. Anyone who wants the complete history can read the article; what you are writing is the part worth hearing while standing here.

   Pick the moments that would make someone look at the place differently, and give each enough room to land -- who did what, why, and what it cost. Prefer:
   - a named person making a choice, and what came of it
   - the single moment the place changed hands, fell, or was made
   - something specific and strange that is still here: an object, a grave, how it got its name
   - whatever explains what a person standing here now would see

   Then cut everything else completely. Do not gesture at what you left out.

6. Do not write a chronicle. These are the failures to avoid, and they are what a long article will pull you toward:
   - walking the timeline: "first the X came, then the Y ruled, then the Z destroyed it". An era that gets half a sentence should not be there at all.
   - listing the settlements, camps, ruins or landmarks that lie within a place
   - summarizing recurring events: "raids continued for years", "the two sides clashed often", "it endured many assaults"
   - naming a faction, king or hero without saying what they did *here*
   A short piece about one betrayal is worth more than a paragraph that spans six centuries. If the article gives only description and no history, describe the place instead -- what it looks like, who holds it, what it feels like to stand in.

7. Each request gives you a character budget, never more than ${MAX_CHARS}. Treat it as a ceiling, not a target. Count the characters before you answer and cut until you are under it, dropping whole events rather than trimming words from every sentence -- what remains should read as unhurried prose.

   Coming in well under the budget is a good answer. A thin article should produce a short piece: say the few things it actually tells you and stop. Never pad to fill the budget with scene-setting, atmosphere, mood, or restatement of something you have already said -- that is inventing, and it is the most common way to get this wrong.

8. Use past tense for history and present tense for what stands there now.

9. Write plain prose. No headings, no bullet points, no parentheses, no citations, no pronunciation guides. Do not open with a definition of the form "X is a place in Y" -- start with something worth hearing.

Return only the finished text. Do not explain what you did or comment on the source.`;

// Built on first use, not at import: everything in this module except the call
// itself -- the cache, the validators -- is useful without a key, and a module that
// throws on import cannot be tested.
let client = null;
async function anthropic() {
  if (!client) {
    client = new Anthropic({ apiKey: await requireEnvKey("ANTHROPIC_API_KEY", "sk-ant-...") });
  }
  return client;
}

//------------------------------------------------------------------------------
// Response cache
//------------------------------------------------------------------------------

function cacheKey({ model, variant, source }) {
  return createHash("sha256")
    .update(`${PROMPT_VERSION} ${model} ${variant} ${source}`)
    .digest("hex");
}

async function readCached(key) {
  const path = join(REWRITE_CACHE, `${key}.json`);
  if (!existsSync(path)) return null;
  return JSON.parse(await readFile(path, "utf8"));
}

async function writeCached(key, entry) {
  await mkdir(REWRITE_CACHE, { recursive: true });
  await writeFile(join(REWRITE_CACHE, `${key}.json`), JSON.stringify(entry, null, 2));
}

//------------------------------------------------------------------------------
// Validation
//
// Nothing here throws. A bad rewrite is a thing to look at in the report and fix in
// the prompt, not a reason to abandon the other forty-five lines of a run.
//------------------------------------------------------------------------------

/**
 * Capitalised words in the output that do not appear in the source.
 *
 * This is the check that matters most: a model that invents a plausible-sounding
 * warlord is worse than one that writes nothing, because nobody reviewing 1300
 * lines will catch it.
 *
 * Checked word by word rather than as multi-word names, which is the version that
 * survived contact with real output. Matching runs like "Scarlet Monastery" looks
 * more precise and is not: the run swallows whatever capitalised word precedes it,
 * so "Under Marcus Redpath" and "Beneath the Tomb of Tyr" both flag as inventions
 * while the model has done nothing wrong. One word at a time cannot make that
 * mistake, and it still catches the failure that matters -- an "Anduin" the article
 * never mentions.
 *
 * Sentence-initial words are skipped, because every sentence starts with a capital
 * and there is no way to tell a name from a verb there. A name that only ever opens
 * a sentence goes unchecked; that is the price of not crying wolf on every line.
 */
/** Lowercased, with every run of non-alphanumerics collapsed to one space. */
const flatten = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export function inventedNames(output, source, vocabulary = null, name = "") {
  // The place's own name counts as known. An article about the Mirage Abyss does
  // not always contain the word "Abyss" -- the wiki puts it in the title and then
  // writes about "the area" -- so a rewrite that calls the place by its name was
  // reading the heading, not inventing. Withholding a line over that is the check
  // being wrong twice: it loses good prose and it buries the real inventions in
  // noise.
  const haystack = normalise(`${name} ${source}`).toLowerCase();
  // The same text with every punctuation mark flattened to a space, for comparing
  // multi-word names whose spelling differs only in punctuation.
  const flatHaystack = ` ${flatten(`${name} ${source}`)} `;
  const found = new Set();
  const inferred = new Set();

  for (const sentence of output.split(/(?<=[.!?])\s+|\n+/)) {
    // Hyphens split here rather than being carried into the comparison. A
    // compound is several words to the article and one token to a naive split,
    // so "Nightmare-twisted" would otherwise read as an unknown name when only
    // the ordinary adjective on the end is new. Splitting first means each part
    // faces the capitalisation test on its own: "Nightmare" is checked, the
    // lower-case "twisted" is not a name and is skipped.
    const words = sentence.trim().split(/\s+/).slice(1).flatMap((w) => w.split(/[-\u2013\u2014]/));
    for (const raw of words) {
      // Strip surrounding punctuation and any possessive, so "Crusade's," and
      // "Crusade" are the same word to the comparison.
      // Strip the possessive in both shapes -- "Crusade's" and the bare "Glades'"
      // a plural takes -- so neither reads as a word the article never used.
      const word = raw.replace(/^[^A-Za-z]+|[^A-Za-z'’]+$/g, "").replace(/['’]s?$/, "");
      if (word.length < 3 || !/^[A-Z][a-z]/.test(word)) continue;

      // A plural of a name the article uses in the singular is not an invention:
      // "Crusaders" for its "Crusade", "Outposts" for its "Outpost".
      const forms = [word, word.replace(/s$/, ""), word.replace(/rs$/, "")].filter(
        (f) => f.length >= 3,
      );
      if (forms.some((f) => haystack.includes(f.toLowerCase()))) continue;

      // Deliberately not policed: a reference reaching outside Azeroth. The game
      // does it too, and a simile is not a leak. What this pipeline defends
      // against is game-ness -- players, quests, levels, mechanics -- which is
      // rule 2 of the prompt's job, not this check's.

      // Not in this article -- but if another article in the same run uses it, it
      // is the shared furniture of the region rather than something conjured up.
      // Naming the undead of Tirisfal "the Forsaken" is a fair inference from an
      // article that describes them without the word; naming a mountain range the
      // region does not touch is not. Only the second is a reason to withhold a
      // line from the corpus.
      if (vocabulary && forms.some((f) => vocabulary.includes(f.toLowerCase()))) {
        inferred.add(word);
        continue;
      }
      found.add(word);
    }
  }
  return { invented: [...found], inferred: [...inferred] };
}

/** What is wrong with a rewrite, as a list of human-readable strings. */
export function validate(text, source, budget = MAX_CHARS, vocabulary = null, name = "") {
  const problems = [];
  let longer = null;
  if (!text) return { problems: ["empty response"], inferred: [], longer: null };
  // Two different things, and conflating them cost the corpus 43 good lines.
  //
  // MAX_CHARS is the real constraint -- it is what the audio length and the
  // sound-pack size are budgeted against -- so exceeding it blocks the line.
  //
  // The per-line budget is only a steer telling the model how much material it
  // has. Prose that lands 20% over it but still under the cap is fine, and
  // rejecting it means keeping the encyclopedic text it was meant to replace.
  // That is reported, not flagged.
  if (text.length > ACCEPT_CHARS) {
    problems.push(`${text.length} characters, over the ${ACCEPT_CHARS} limit`);
  } else if (overBudget(text, budget)) {
    longer = `${text.length} characters against a ${budget} budget`;
  }

  const era = isPostVanilla(text);
  if (era) problems.push(`post-vanilla lore survived the rewrite (/${era}/)`);

  const { invented, inferred } = inventedNames(text, source, vocabulary, name);
  if (invented.length) problems.push(`names not in any source: ${invented.join(", ")}`);

  if (/^(here is|i have|this is a rewrite|the article)/i.test(text)) {
    problems.push("looks like commentary rather than lore");
  }
  return { problems, inferred, longer };
}

//------------------------------------------------------------------------------
// The call
//------------------------------------------------------------------------------

function textOf(response) {
  return response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();
}

function userTurn(name, source, budget) {
  return {
    role: "user",
    content:
      `Place: ${name}\nCharacter budget: ${budget}\n\nArticle:\n\n${source}`,
  };
}

// The note-guided fix turn. Same article, same rules, but instead of writing from
// scratch the model repairs an earlier rewrite that a lore reviewer flagged. The
// review knows things the rewrite model does not -- which obscure names are
// post-vanilla, which claims describe the world's later shape -- so the note does
// the era attribution and the model only has to execute a targeted edit. Removal
// only: the worst outcome of an over-eager fix is a shorter piece, never a new
// invention.
function fixTurn(name, source, budget, fix) {
  return {
    role: "user",
    content:
      `Place: ${name}\nCharacter budget: ${budget}\n\nArticle:\n\n${source}\n\n---\n\n` +
      `Below is an earlier rewrite of this article, and a lore reviewer's note on ` +
      `what is wrong with it. Produce a corrected version that resolves the note. ` +
      `Work by removal and re-anchoring only: cut the flagged claims entirely; where ` +
      `the note states the correct earlier condition of the place, you may state it ` +
      `only if the article above supports it. Do not add new material to make up for ` +
      `what you cut -- coming back shorter is the correct outcome. Every rule above ` +
      `still applies.\n\n` +
      `Earlier rewrite:\n\n${fix.current}\n\nReviewer's note: ${fix.note}`,
  };
}

/**
 * One follow-up turn asking for a shorter version.
 *
 * The length rule in the system prompt gets most of the way there but not all: a
 * model cannot count the characters of text it has not written yet, so a share of
 * first drafts land a little over the cap however firmly the rule is worded. Told
 * the actual number afterwards, it cuts accurately. Only the overruns pay for this,
 * which is why it is a second turn rather than a stricter prompt for everyone.
 */
async function condense({ name, source, text, budget, model, firm = false }) {
  const response = await (await anthropic()).messages.create({
    model,
    max_tokens: 2000,
    system: SYSTEM_PROMPT,
    messages: [
      userTurn(name, source, budget),
      { role: "assistant", content: text },
      {
        role: "user",
        content:
          `That is ${text.length} characters, over the ${budget} limit. Cut it to under ` +
          `${budget}. Drop whole events or details rather than trimming words from every ` +
          `sentence -- keep what remains as readable prose.` +
          (firm
            ? ` You have already tried once and it is still too long, so this time remove an ` +
              `entire episode: pick the least essential of the things you are describing and ` +
              `delete it completely rather than shortening everything again.`
            : "") +
          ` Return only the shortened text.`,
      },
    ],
  });
  return response.stop_reason === "refusal" ? text : normalise(textOf(response));
}

/**
 * Rewrite one place's assembled source text.
 *
 * @returns { text, problems, cached, condensed } -- `cached` is true when neither
 *   the rewrite nor the condense pass had to call the API.
 */
export async function rewrite({
  name,
  source,
  variant,
  model = DEFAULT_MODEL,
  refresh = false,
  vocabulary = null,
  // { current, note } -- repair an earlier rewrite instead of writing fresh; see
  // fixTurn. Part of the cache key: a different note is a different request.
  fix = null,
}) {
  const budget = targetChars(source.length);
  const key = cacheKey({
    model,
    variant: fix ? `${variant}-fix` : variant,
    source: fix ? `${source} ${fix.current} ${fix.note}` : source,
    budget,
  });

  let entry = refresh ? null : await readCached(key);
  let cached = Boolean(entry);

  if (!entry) {
    const response = await (await anthropic()).messages.create({
      model,
      max_tokens: 2000,
      system: SYSTEM_PROMPT,
      messages: [fix ? fixTurn(name, source, budget, fix) : userTurn(name, source, budget)],
    });

    if (response.stop_reason === "refusal") {
      const refusal = { text: "", refused: true };
      await writeCached(key, refusal);
        return { ...refusal, problems: ["the model declined to answer"], inferred: [], cached: false };
    }
    entry = { text: normalise(textOf(response)) };
    await writeCached(key, entry);
  }

  // Runs against a cache hit too, so a first draft stored before this pass existed
  // is condensed and then stays condensed.
  //
  // Three attempts, and the last two aim at MAX_CHARS rather than the soft budget:
  // on the longest articles the first pass reliably lands over the hard cap, and
  // stopping at two left 97 lines too long to write at all -- which meant keeping
  // the encyclopedic text they were meant to replace.
  while (
    !entry.refused &&
    (entry.condensed ?? 0) < 3 &&
    (entry.text.length > ACCEPT_CHARS || overBudget(entry.text, budget))
  ) {
    const firstPass = entry.firstPass ?? entry.text;
    entry = {
      text: await condense({
        name,
        source,
        text: entry.text,
        // Once a draft has already been cut once, ask for the ceiling it must
        // actually clear rather than the steer it merely missed.
        budget: (entry.condensed ?? 0) === 0 ? budget : Math.min(budget, ACCEPT_CHARS),
        firm: (entry.condensed ?? 0) > 0,
        model,
      }),
      firstPass,
      condensed: (entry.condensed ?? 0) + 1,
    };
    await writeCached(key, entry);
    cached = false;
  }

  return { ...entry, budget, ...validate(entry.text, source, budget, vocabulary, name), cached };
}
