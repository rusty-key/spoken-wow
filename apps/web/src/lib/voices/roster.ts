/**
 * Every type, gender and flavor an NPC can be, and the voice that reads each combination
 * (migration 0071). Plain data in, so a server page loads it once (roster-store.ts) and hands
 * it to client components as props; a client tree builds one Roster from it and passes that down.
 *
 * A model slot (`model-{ModelID}`) is a type and a voice by pattern, never a row: there is one
 * per model, and which voice each gets is not chosen yet (voices.ts isModelVoice).
 *
 * No gender is null; an empty string from a column that cannot hold null reads the same.
 *
 * Free of node imports: ContributionTable, SpeakerCell and NpcEditor are client components.
 */
import { isModelVoice, type Gender } from "./voices";

export type { Gender };

export type RosterData = {
  races: { key: string; genders: Gender[] }[];
  flavors: { race: string; gender: Gender | null; flavor: string }[];
  /** `race` and `gender` are what the voice's files are named by: md5(text + race + gender). */
  voices: { name: string; race: string; gender: string }[];
  assignments: { race: string; gender: Gender | null; flavor: string | null; voice: string }[];
};

const sorted = (values: Iterable<string>) => [...new Set(values)].sort((a, b) => a.localeCompare(b));
const key = (...parts: (string | null)[]) => parts.map((part) => part ?? "").join("|");

export class Roster {
  readonly races: string[];
  readonly voiceNames: string[];
  private readonly byRace: Map<string, RosterData["races"][number]>;
  private readonly byVoice: Map<string, RosterData["voices"][number]>;
  private readonly byCombination: Map<string, string>;
  private readonly flavorsByGroup: Map<string, string[]>;

  constructor(readonly data: RosterData) {
    this.races = sorted(data.races.map((race) => race.key));
    this.voiceNames = sorted(data.voices.map((voice) => voice.name));
    this.byRace = new Map(data.races.map((race) => [race.key, race]));
    this.byVoice = new Map(data.voices.map((voice) => [voice.name, voice]));
    this.byCombination = new Map(data.assignments.map((a) => [key(a.race, a.gender, a.flavor), a.voice]));
    this.flavorsByGroup = new Map();
    for (const f of data.flavors) {
      const group = key(f.race, f.gender);
      this.flavorsByGroup.set(group, [...(this.flavorsByGroup.get(group) ?? []), f.flavor]);
    }
    for (const [group, flavors] of this.flavorsByGroup) this.flavorsByGroup.set(group, sorted(flavors));
  }

  hasRace(race: string): boolean {
    return this.byRace.has(race);
  }

  gendersOf(race: string): Gender[] {
    return this.byRace.get(race)?.genders ?? [];
  }

  isGenderless(race: string): boolean {
    return this.hasRace(race) && this.gendersOf(race).length === 0;
  }

  flavorsOf(race: string, gender: string | null): string[] {
    return this.flavorsByGroup.get(key(race, gender || null)) ?? [];
  }

  flavorScopes(): { race: string; gender: Gender | null; flavor: string }[] {
    return [...this.data.flavors].sort(
      (a, b) =>
        a.race.localeCompare(b.race) ||
        (a.gender ?? "").localeCompare(b.gender ?? "") ||
        a.flavor.localeCompare(b.flavor),
    );
  }

  // Most specific first, as voice_for() in migration 0071: a type answers for every gender and
  // flavor it does not split by.
  voiceFor(race: string | null, gender: string | null, flavor: string | null): string | null {
    if (!race) return null;
    if (isModelVoice(race)) return race;
    const g = gender || null;
    return (
      this.byCombination.get(key(race, g, flavor)) ??
      this.byCombination.get(key(race, g, null)) ??
      this.byCombination.get(key(race, null, flavor)) ??
      this.byCombination.get(key(race, null, null)) ??
      null
    );
  }

  isVoice(name: string): boolean {
    return this.byVoice.has(name) || isModelVoice(name);
  }

  /** A model slot's gender is the placeholder the corpus has always carried for it. */
  familyOf(voice: string): { race: string; gender: string } | null {
    if (isModelVoice(voice)) return { race: voice, gender: "male" };
    const row = this.byVoice.get(voice);
    return row ? { race: row.race, gender: row.gender } : null;
  }

  /** Why an answer cannot be stored, or null. Nothing at all is an answer: "no type". */
  isAnswer(race: string | null, gender: string | null, flavor: string | null): string | null {
    if (!race) return gender || flavor ? "a gender or flavor needs a type" : null;
    if (isModelVoice(race)) return null;
    if (!this.hasRace(race)) return `${race} is not a type`;
    if (this.isGenderless(race)) {
      if (gender) return `${race} has no gender`;
    } else if (!gender) {
      return `${race} needs a gender`;
    } else if (!this.gendersOf(race).includes(gender as Gender)) {
      return `${race} has no ${gender}`;
    }
    if (flavor && !this.flavorsOf(race, gender).includes(flavor)) {
      return `${flavor} is not a flavor of ${race}${gender ? ` ${gender}` : ""}`;
    }
    return null;
  }
}

/** A new combination's own voice, `race[-gender][-flavor]`: frozen once it has takes. */
export function newVoiceName(race: string, gender: string | null, flavor: string | null): string {
  return [race, gender, flavor].filter(Boolean).join("-");
}
