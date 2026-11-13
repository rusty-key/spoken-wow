/**
 * Telling an NPC's words apart from the game's stage directions.
 *
 * Blizzard writes directions inside angle brackets, inside the NPC's own quest text:
 * "<Advisor Belgrum opens the note and begins to read.>" is not the dwarf speaking, and having
 * him read it aloud in character is worse than saying nothing.
 *
 * Free of node imports on purpose: the search filter and the result row both need this and run
 * in the browser. Same reasoning as the note atop lib/line-fields.ts.
 */

/**
 * The one narrator, for now.
 *
 * Not in the corpus and not a `race-gender-flavor` slot, so it is resolved by name against the
 * account's voices at generation time. Choosing a narrator per line or per race is a later
 * setting; hardcoding it keeps this change to the mechanism.
 */
export const NARRATOR_VOICE = "narrator-male";

/**
 * `voice` is set on an npc segment spoken by a slot other than the line's own: see VOICE_MARKER.
 * Absent, the line's own voice speaks it, which is every line without a marker.
 */
export type Segment = { speaker: "npc" | "narrator"; voice?: string; text: string };

/**
 * A capitalised bracketed span, and nothing else.
 *
 * Blizzard writes both stage directions and NPC sounds in angle brackets, and capitalisation is
 * what separates them - across all 90 spans in the corpus, with no exceptions. A direction
 * names someone: "Eva weeps.", "Motega shrugs his shoulder". A sound is a bare lowercase word:
 * <hic>, <cough>, <sigh>, <mutters>.
 *
 * Capitalisation alone, note. Also requiring a closing full stop is tempting and wrong -
 * "Motega shrugs his shoulder" has none.
 *
 * A lowercase span stays with the NPC and is handed to audioTags instead: the NPC performs the
 * sound, nobody narrates the word.
 */
const DIRECTION = /(<[A-Z][^<>]*>)/;

/**
 * A voice slot named between underscores - `_goblin-male-zany_` - handing the rest of the line,
 * up to the next marker, to that slot.
 *
 * For the line whose giver cannot be the speaker: Wizbang's Buzzbox quests are given by an
 * object, so the line is correctly narrator-male, yet most of it is Wizbang talking over the
 * machine. Nothing in Blizzard's text says so, and the corpus has no way to - so a rewrite says
 * it. Underscores because the text has no other use for them, and angle brackets are taken:
 * a lowercase `<goblin-male-zany>` would read as a sound.
 *
 * A slot name only, `race-gender-flavor` or `narrator-male`: at least one hyphen, lowercase. The
 * line's own voice again is its own slot name. Stage directions inside a marked stretch are
 * still the narrator's.
 */
const SLOT = String.raw`[a-z][a-z0-9]*(?:-[a-z0-9]+)+`;
const VOICE_MARKER = new RegExp(String.raw`(?<!\w)_(${SLOT})_(?!\w)`);

/** A direction or a marker, whichever comes first: what a line is cut at. */
const CUT = new RegExp(String.raw`(<[A-Z][^<>]*>|(?<!\w)_${SLOT}_(?!\w))`);

/** The slot a piece names, when the piece is nothing but a marker. */
function markedVoice(piece: string): string | undefined {
  const match = piece.trim().match(VOICE_MARKER);
  return match && match[0] === piece.trim() ? match[1] : undefined;
}

/** The race a slot is cast from, which is what an accent direction is keyed by. */
function raceOf(voice: string): string {
  return voice.split("-")[0];
}

/**
 * The direction a slot is spoken with: its race's, then its own.
 *
 * The map is keyed by race (`gnome`) or by slot (`gnome-male-young`). A race's direction is
 * the accent every voice of it shares; a slot's is what one voice needs on top - the young
 * gnome whose neutral clips eleven_v3 reads as a woman. Both rather than the slot's alone, so
 * giving one dwarf flavor a direction does not quietly drop its brogue.
 */
export function directionFor(voice: string, tags: Record<string, string>): string | undefined {
  const race = raceOf(voice);
  const own = [tags[race], voice === race ? undefined : tags[voice]].filter(Boolean);
  return own.length > 0 ? own.join(" ") : undefined;
}

/**
 * A stored direction as it is typed: its words, without the square brackets around them.
 *
 * Stored bracketed, because that is the form eleven_v3 performs and the form every take so far
 * was hashed with - settings.ts adds them on save. Leaves a value that is not one bracketed
 * span as it is, so it round-trips through the form unchanged.
 */
export function bareDirection(tag: string): string {
  const match = tag.trim().match(/^\[([^[\]]*)\]$/);
  return match ? match[1].trim() : tag.trim();
}

/** A lowercase bracketed span: a sound the NPC makes, not the game narrating. */
const SOUND = /<([a-z][^<>]*)>/g;

/**
 * The NPC's own sounds, rewritten into ElevenLabs' audio-tag syntax.
 *
 * Blizzard writes them in angle brackets - `<hic>`, `<cough>`, `<sigh>`, `<mutters>` - and
 * ElevenLabs writes them in square ones. eleven_v3, the default everywhere, performs a tag
 * rather than reading it; the angle-bracket form is not syntax to any model and would be
 * spoken aloud or refused by the gate.
 *
 * Applied to the whole line before segments(), so it reaches the single-voice path too: a line
 * whose only bracket is a sound never goes near the dialogue endpoint. Capitalised directions
 * are left untouched for segments() to hand to the narrator, and an unbalanced bracket is left
 * as damage for the gate to refuse.
 */
export function audioTags(text: string): string {
  return text.replace(SOUND, "[$1]");
}

/**
 * The direction for a slot (see directionFor), prefixed to the words the NPC says.
 *
 * Dwarves are the reason this exists: they are meant to have a strong Scottish brogue, and
 * an instant clone read by eleven_v3 returns something closer to RP. The model has no other
 * channel for direction - a text-to-speech request carries text, settings and a seed,
 * nothing else - so the direction has to travel inside the text.
 *
 * Applied per stretch of speech rather than once at the front, because a line can be
 * interrupted by a stage direction that `narrator-male` reads. Tagging the whole string would
 * tell the narrator to sound like a dwarf too, and would leave the second half of the NPC's
 * own speech untagged.
 *
 * Runs after audioTags, so the sounds it rewrote are square-bracketed by now and stay with
 * the speech that makes them. Angle brackets are still what separates a direction from
 * speech here, and an unbalanced one is left as damage for the gate to refuse.
 */
export function accentTagged(
  text: string,
  tag: string | undefined,
  raceTags: Record<string, string> = {},
  voice?: string,
): string {
  let current = voice;
  return text
    .split(CUT)
    .map((piece) => {
      const marked = markedVoice(piece);
      if (marked) {
        current = marked;
        return piece;
      }
      // A marked stretch takes its own slot's direction, not the line's: Wizbang is a goblin
      // whoever gave the quest.
      const own = current ? directionFor(current, raceTags) : tag;
      return DIRECTION.test(piece) || !piece.trim() || !own
        ? piece
        : piece.replace(/^(\s*)/, `$1${own} `);
    })
    .join("");
}

/**
 * The slot speaking at the end of `text`, starting from `voice`: how a marker carries across
 * the paragraphs fish.audio is shaped one at a time.
 */
export function voiceAfter(text: string, voice?: string): string | undefined {
  let current = voice;
  for (const piece of text.split(CUT)) current = markedVoice(piece) ?? current;
  return current;
}

export function segments(text: string): Segment[] {
  const out: Segment[] = [];
  let voice: string | undefined;
  for (const piece of text.split(CUT)) {
    const trimmed = piece.trim();
    if (!trimmed) continue;
    const marked = markedVoice(trimmed);
    if (marked) {
      voice = marked;
      continue;
    }
    const direction = DIRECTION.test(trimmed) && trimmed.startsWith("<") && trimmed.endsWith(">");
    out.push(
      direction
        ? { speaker: "narrator", text: trimmed.slice(1, -1).trim() }
        : { speaker: "npc", ...(voice ? { voice } : {}), text: trimmed },
    );
  }
  return out;
}

export function hasNarration(text: string): boolean {
  return segments(text).some((segment) => segment.speaker === "narrator");
}

/**
 * Whether an override only puts stage directions back, changing no words.
 *
 * The pipeline stripped 314 directions before synthesis and they were restored as overrides,
 * which made every one of those lines look hand-rewritten. They are not: the text is
 * Blizzard's own, with a sentence the pipeline had deleted put back. Someone reviewing
 * rewrites wants the lines a human made a judgement about - "adventurerama", the war-effort
 * tallies, the line that is the single letter "x" - not these.
 *
 * Derived rather than recorded, so it needs no column and cannot drift: edit the words of a
 * restored line and it becomes a rewrite, and starts saying so.
 */
export function restoresOnlyNarration(overrideText: string, corpusText: string): boolean {
  return overrideText.replace(/<[A-Z][^<>]*>/g, "").replace(/\s+/g, " ").trim() ===
    corpusText.replace(/\s+/g, " ").trim();
}
