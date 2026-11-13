import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { parseEnvelope } from "./envelope";
import { submissionFrom } from "./submission";
import type { Envelope } from "./envelope";

const fixture = (name: string) =>
  readFileSync(new URL(`../../../../../tests/fixtures/contributions/${name}`, import.meta.url), "utf8");

const quests: Envelope = {
  source: "quests",
  fields: { quest: "9123", event: "accept", locale: "ruRU", build: "1.12.1/5875", npc: "12345 X" },
  text: "Убей шестерых.",
};

describe("submissionFrom", () => {
  it("keys a quest on its id and event", () => {
    expect(submissionFrom(quests, "raw")?.key).toBe("9123:accept");
  });

  it("keys gossip on the npc, which is all a gossip envelope has", () => {
    const gossip: Envelope = { source: "quests", fields: { npc: "12345 X", locale: "enUS" }, text: "Hail." };
    expect(submissionFrom(gossip, "raw")?.key).toBe("npc:12345");
  });

  it("keys a page on the client-side checksum", () => {
    const readables: Envelope = {
      source: "readables",
      fields: { page: "1839201", book: "Ledger", number: "2", locale: "enUS" },
      text: "Words.",
    };
    expect(submissionFrom(readables, "raw")?.key).toBe("1839201");
  });

  it("keys a place on its map and subzone", () => {
    const places: Envelope = {
      source: "places",
      fields: { map: "1537", subzone: "A Nook", zone: "Ironforge", locale: "enUS" },
      text: null,
    };
    const made = submissionFrom(places, "raw");
    expect(made?.key).toBe("1537:A Nook");
    expect(made?.text).toBe(null);
  });

  it("keeps a place's description as its text, and dedups on it", () => {
    const places: Envelope = { source: "places", fields: { map: "1537", subzone: "Nook" }, text: null };
    const a = submissionFrom(places, "raw", "A drafty nook behind the forge.  ");
    const b = submissionFrom(places, "raw", "Somewhere else entirely, by the lake.");
    expect(a?.text).toBe("A drafty nook behind the forge.");
    expect(a?.dedup).not.toBe(b?.dedup);
  });

  it("keys the open part of a zone on the bare map, not nothing", () => {
    // The addon writes subzone="" here (GetSubZoneText() off any subzone), which used to
    // require f.subzone truthy and made this envelope unsubmittable -- the main places gap,
    // not an edge case. A bare mapID mirrors the frozen z:{mapID}/s:{mapID}:{key} split.
    const places: Envelope = {
      source: "places",
      fields: { map: "1537", subzone: "", zone: "Ironforge", locale: "enUS" },
      text: null,
    };
    const made = submissionFrom(places, "raw");
    expect(made?.key).toBe("1537");
  });

  it("refuses an envelope missing a key its source needs", () => {
    expect(submissionFrom({ source: "readables", fields: { locale: "enUS" }, text: "x" }, "raw")).toBe(null);
  });

  it("refuses a quests or readables envelope with no text, which is the whole payload", () => {
    expect(
      submissionFrom({ source: "quests", fields: { quest: "1", event: "accept" }, text: null }, "raw"),
    ).toBe(null);
  });

  it("refuses text that is only whitespace, which normalises to nothing", () => {
    expect(
      submissionFrom({ source: "quests", fields: { quest: "1", event: "progress" }, text: " \n\t" }, "raw"),
    ).toBe(null);
  });

  it("dedups on the normalised text, so trailing whitespace is not a second row", () => {
    const spaced: Envelope = { ...quests, text: "Убей шестерых.   \n\n\n" };
    expect(submissionFrom(spaced, "raw")?.dedup).toBe(submissionFrom(quests, "raw")?.dedup);
  });

  it("does not dedup across locales", () => {
    const other: Envelope = { ...quests, fields: { ...quests.fields, locale: "enUS" } };
    expect(submissionFrom(other, "raw")?.dedup).not.toBe(submissionFrom(quests, "raw")?.dedup);
  });

  it("files an EU English client's contribution as English", () => {
    const gb: Envelope = { ...quests, fields: { ...quests.fields, locale: "enGB" } };
    const us: Envelope = { ...quests, fields: { ...quests.fields, locale: "enUS" } };
    expect(submissionFrom(gb, "raw")?.locale).toBe("enUS");
    expect(submissionFrom(gb, "raw")?.dedup).toBe(submissionFrom(us, "raw")?.dedup);
  });

  it("refuses a locale the site does not know", () => {
    const odd: Envelope = { ...quests, fields: { ...quests.fields, locale: "xxXX" } };
    expect(submissionFrom(odd, "raw")).toBe(null);
  });

  it("keeps the remaining fields as meta and defaults a missing locale", () => {
    const made = submissionFrom({ ...quests, fields: { quest: "1", event: "accept", npc: "7 Y" } }, "raw");
    expect(made?.locale).toBe("enUS");
    expect(made?.meta.npc).toBe("7 Y");
  });

  it("refuses a quest id that isn't numeric, which would collide with a gossip key", () => {
    // Nothing but the paste box stops someone typing this by hand: quest="npc" would
    // otherwise produce the same key as gossip from creature 12345.
    const forged: Envelope = {
      source: "quests",
      fields: { quest: "npc", event: "12345", locale: "enUS" },
      text: "Hail.",
    };
    expect(submissionFrom(forged, "raw")).toBe(null);
  });

  it("refuses a map id that isn't numeric, rather than let a colon in it forge a key", () => {
    const places: Envelope = {
      source: "places",
      fields: { map: "1:2", subzone: "X", locale: "enUS" },
      text: null,
    };
    expect(submissionFrom(places, "raw")).toBe(null);
  });

  it("submits the addon's actual no-subzone envelope end to end", () => {
    // Unlike the hand-built Envelope above, this goes through parseEnvelope on the exact bytes
    // Spoken_Places/Contribute.lua writes for the open part of a zone (fixture regenerated by
    // `make contribute-fixtures`) -- the shape this was previously unsubmittable for.
    const parsed = parseEnvelope(fixture("places-zone.txt"));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const made = submissionFrom(parsed.value, fixture("places-zone.txt"));
    expect(made?.key).toBe("1537");
  });

  it("does not collide a subzone's own colon with the map:subzone separator", () => {
    const a = submissionFrom(
      { source: "places", fields: { map: "1", subzone: "2:X", locale: "enUS" }, text: null },
      "raw",
    );
    const b = submissionFrom(
      { source: "places", fields: { map: "12", subzone: "X", locale: "enUS" }, text: null },
      "raw",
    );
    expect(a?.key).toBe("1:2:X");
    expect(b?.key).toBe("12:X");
    expect(a?.key).not.toBe(b?.key);
  });

  it("refuses a places envelope carrying text, since the client has none to give", () => {
    const places: Envelope = {
      source: "places",
      fields: { map: "1537", subzone: "A Nook", locale: "enUS" },
      text: "This didn't come from our writer.",
    };
    expect(submissionFrom(places, "raw")).toBe(null);
  });

  it("refuses a places envelope with empty-string text, not just non-null text", () => {
    const places: Envelope = {
      source: "places",
      fields: { map: "1537", subzone: "A Nook", locale: "enUS" },
      text: "",
    };
    expect(submissionFrom(places, "raw")).toBe(null);
  });

  it("refuses an npc id with trailing junk that isn't the writer's name suffix", () => {
    const gossip: Envelope = { source: "quests", fields: { npc: "123abc", locale: "enUS" }, text: "Hail." };
    expect(submissionFrom(gossip, "raw")).toBe(null);
  });

  it("accepts the writer's real npc shape, an id followed by a name", () => {
    const gossip: Envelope = {
      source: "quests",
      fields: { npc: "12345 Deathguard Linnea", locale: "enUS" },
      text: "Hail.",
    };
    expect(submissionFrom(gossip, "raw")?.key).toBe("npc:12345");
  });
});
