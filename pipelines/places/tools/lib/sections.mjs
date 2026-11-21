// Deciding which parts of a wiki article are lore.
//
// A warcraft.wiki.gg article is written for players, and only some of it is the
// story of a place. The rest -- quest tables, NPC lists, "Patch changes", the RPG
// sourcebook material the wiki itself marks non-canon -- is noise for an addon that
// narrates lore, and the earlier lead-only scrape avoided it by never looking past
// the intro. That also cost us every article's History section, which is where the
// pre-WoW lore lives.
//
// So: read the whole article, and classify by heading. Measured over the 224 full
// articles cached under tools/cache/, the headings are consistent enough to do this
// deterministically -- which matters, because the alternative is asking a model to
// decide what counts as lore, and a deterministic filter is one fewer thing that can
// go wrong silently.

// Headings whose prose is the story of the place. Everything else is dropped.
//
// Geography is usually a bulleted list of sub-locations rather than prose, and
// contributes little; it is kept because on the articles where it *is* prose it is
// good prose, and the rewrite discards lists anyway.
//
// Overview is the one risky member: Sen'jin Village's Overview is "the first
// settlement most orcs encounter ... only two professions trained here", exactly the
// fourth-wall noise this whole pipeline exists to remove. It earns its place because
// on most articles it is ordinary description, and the rewrite step is what strips
// player-facing framing.
export const LORE_SECTIONS = /^(?:history|background|description|overview|geography|lore|the zone)$/i;

// The wiki opens every RPG section with this sentence. Checked in addition to the
// heading, so a renamed "In the RPG" section is still caught.
const NON_CANON = /considered non-canon/i;

// Banner templates. explaintext renders them as ordinary sentences in the middle of
// otherwise good prose -- "This section concerns content related to Warcraft III",
// "From the World Dungeons page on the official World of Warcraft Community Site:"
// -- so they survive both the heading filter and the era filter, and read to the
// rewrite step as facts about the world rather than furniture from a website.
const BANNERS = [
  /^This (?:section|article|page) (?:concerns|contains|is|describes|covers)\b/i,
  /^From the .*(?:official World of Warcraft|Community Site)/i,
  /^(?:For|See) .*,? see\b/i,
  /^Not to be confused with\b/i,
  /^The subject of this (?:section|article)\b/i,
];

function stripBanners(text) {
  return text
    .split("\n")
    .filter((line) => !BANNERS.some((re) => re.test(line.trim())))
    .join("\n")
    .trim();
}

// Subsection headings that name a post-vanilla era. The wiki organises History
// chronologically with one subsection per expansion -- Astranaar's reads
// "World of Warcraft | Cataclysm | Mists of Pandaria | Battle for Azeroth" --
// and folding them blindly into their parent was the single largest source of
// wrong-era lore in the shipped corpus (dist/review-findings.md: ~237 of 360
// non-vanilla flags trace to Cataclysm-and-later content, most of it sitting
// under exactly these headings). Matched by containment so "The Shattering:
// Prelude to Cataclysm" and "World of Warcraft: Legion" are caught; a plain
// "World of Warcraft" heading means vanilla and is kept. "Exploring Azeroth"
// is the Shadowlands-era book series.
export const POST_VANILLA_SECTIONS =
  /Burning Crusade|Lich King|Cataclysm|Shattering|Pandaria|Warlords of Draenor|Legion|Battle for Azeroth|Shadowlands|Dragonflight|War Within|Midnight|Exploring Azeroth|Hearthstone/i;

// explaintext renders headings as "== Foo ==" lines. The lead section has no heading.
const HEADING = /^\s*(=+)\s*(.+?)\s*\1\s*$/;

/**
 * Split explaintext output into its sections.
 *
 * `level` is the number of equals signs: 2 for a top-level "== Foo ==", 3 for a
 * "=== Bar ===" subsection. The lead comes back with a null heading and level 0.
 */
export function splitSections(plaintext) {
  const sections = [];
  let current = { heading: null, level: 0, lines: [] };

  for (const line of plaintext.split("\n")) {
    const m = line.match(HEADING);
    if (m) {
      sections.push(current);
      current = { heading: m[2], level: m[1].length, lines: [] };
    } else {
      current.lines.push(line);
    }
  }
  sections.push(current);

  return sections.map((s) => ({
    heading: s.heading,
    level: s.level,
    text: s.lines.join("\n").trim(),
  }));
}

/**
 * The lead, plus the top-level sections with subsections folded into their parent.
 *
 * Subsections are merged rather than judged on their own: "=== Map ===" under
 * "== Geography ==" is lore or noise according to its parent, and a subsection
 * heading in isolation ("Flight") says nothing useful. The one exception is a
 * subsection whose heading names a post-vanilla era -- that one is dropped,
 * along with any deeper headings nested under it, and recorded in `dropped`.
 */
export function foldSections(plaintext) {
  let lead = "";
  const sections = [];
  const dropped = [];
  let droppingBelow = null;

  for (const s of splitSections(plaintext)) {
    if (s.heading === null) {
      lead = s.text;
      continue;
    }
    if (droppingBelow !== null && s.level > droppingBelow) continue;
    droppingBelow = null;

    if (s.level > 2 && sections.length > 0) {
      if (POST_VANILLA_SECTIONS.test(s.heading)) {
        dropped.push(s.heading);
        droppingBelow = s.level;
        continue;
      }
      const parent = sections[sections.length - 1];
      if (s.text) parent.text = parent.text ? `${parent.text}\n\n${s.text}` : s.text;
      continue;
    }
    sections.push({ heading: s.heading, text: s.text });
  }

  return { lead, sections, dropped };
}

/** The lore-bearing sections of an article, in article order, banners removed. */
export function loreSections(plaintext) {
  const { lead, sections, dropped } = foldSections(plaintext);
  const kept = sections
    .filter((s) => s.text && LORE_SECTIONS.test(s.heading) && !NON_CANON.test(s.text))
    .map((s) => ({ heading: s.heading, text: stripBanners(s.text) }))
    .filter((s) => s.text);
  return { lead: stripBanners(lead), kept, dropped };
}

//------------------------------------------------------------------------------
// Source assembly
//
// Two experiments, run side by side so their output can be compared before either
// is committed to the corpus:
//
//   A  the "(Classic)" page's lead -- purpose-written about the 1.x world -- in
//      front of the main article's lore sections, which carry the deep history the
//      Classic pages lack.
//
//   B  the main article's lore sections alone, with no lead at all. A pure history
//      read, to see how much of the lead was carrying its weight.
//
// Both fall back to a lead when the article has no lore sections at all: 169 of the
// 224 cached articles have no History section, and a variant that emitted nothing
// for those would leave most subzones silent. Every fallback is reported, so the
// comparison can account for how often each experiment actually ran as designed.
//------------------------------------------------------------------------------

export const VARIANTS = ["a", "b"];

/**
 * Build the text handed to the rewrite step.
 *
 * @param mainPlaintext  the full main article
 * @param classicLead    the "(Classic)" page's lead, or null when the wiki has none
 * @returns { text, sections, fallback } -- `sections` names what was used, and
 *   `fallback` records which substitution was made, if any, for the report.
 */
export function assembleSource(variant, mainPlaintext, classicLead = null) {
  const { lead, kept, dropped } = loreSections(mainPlaintext);
  const body = kept.map((s) => s.text).join("\n\n");
  const sections = kept.map((s) => s.heading);
  const droppedNote = dropped.length ? `dropped era subsections: ${dropped.join(", ")}` : null;

  if (variant === "a") {
    const notes = [];
    if (!classicLead) notes.push("no (Classic) page -- used the main lead");
    if (!body) notes.push("no lore sections -- lead only");
    if (droppedNote) notes.push(droppedNote);
    return {
      text: [classicLead || lead, body].filter(Boolean).join("\n\n"),
      sections,
      fallback: notes.join("; ") || null,
    };
  }

  if (variant === "b") {
    if (body) return { text: body, sections, fallback: droppedNote };
    return {
      text: lead,
      sections: [],
      fallback: ["no lore sections -- used the main lead", droppedNote].filter(Boolean).join("; "),
    };
  }

  throw new Error(`unknown variant ${variant}`);
}
