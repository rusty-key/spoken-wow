/**
 * The reader, against envelopes the addon's own writer produced.
 *
 * The fixtures come from tests/lua/contribute_envelope_test.lua via `make contribute-fixtures`.
 * Hand-written expectations here would test this file against itself; these test it against
 * the Lua.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { checkEnvelope } from "./contributions";
import { checksum, decodeFragment, formatEnvelope, parseEnvelope } from "./envelope";

const fixture = (name: string) =>
  readFileSync(new URL(`../../../../../tests/fixtures/contributions/${name}`, import.meta.url), "utf8");

describe("parseEnvelope", () => {
  it("reads a quests envelope the addon wrote", () => {
    const result = parseEnvelope(fixture("quests-accept.txt"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.source).toBe("quests");
    expect(result.value.fields.quest).toBe("9123");
    expect(result.value.fields.event).toBe("accept");
    expect(result.value.fields.locale).toBe("ruRU");
    expect(result.value.text).toBe("Убей шестерых.\n\nПотом возвращайся.");
  });

  it("reads a places envelope, which carries no text", () => {
    const result = parseEnvelope(fixture("places-subzone.txt"));
    expect(result.ok && result.value.text).toBe(null);
    expect(result.ok && result.value.fields.subzone).toBe("A Nook With No Lore");
  });

  it("reads the open-part-of-a-zone envelope's subzone field as empty, not absent", () => {
    // The addon always writes the field (Contribute.lua never omits it the way it omits
    // x/y); this is the shape checkEnvelope's bare-map branch has to treat as "no subzone".
    const result = parseEnvelope(fixture("places-zone.txt"));
    expect(result.ok && result.value.fields.subzone).toBe("");
  });

  it("unescapes a >> line inside the text", () => {
    const result = parseEnvelope(fixture("quests-fenced.txt"));
    expect(result.ok && result.value.text).toBe("before\n>>\nafter");
  });

  it("refuses a body that does not match its checksum", () => {
    const tampered = fixture("quests-accept.txt").replace("9123", "9124");
    expect(parseEnvelope(tampered)).toEqual({ ok: false, error: "checksum" });
  });

  it("refuses a truncated paste", () => {
    const half = fixture("readables-page.txt").slice(0, 120);
    expect(parseEnvelope(half).ok).toBe(false);
  });

  it("refuses a version it does not know", () => {
    const future = fixture("readables-page.txt").replace("!SPOKEN1", "!SPOKEN2");
    expect(parseEnvelope(future)).toEqual({ ok: false, error: "version" });
  });

  it("refuses a source it does not know", () => {
    const wrong = fixture("readables-page.txt").replace("!SPOKEN1 readables", "!SPOKEN1 mail");
    expect(parseEnvelope(wrong)).toEqual({ ok: false, error: "source" });
  });

  it("refuses a NUL byte, which Postgres text cannot store", () => {
    const body = "!SPOKEN1 quests\nnpc=1 X\ntext<<\nHa\u0000il.\n>>\n";
    expect(parseEnvelope(`${body}sum=${checksum(body)}\n`)).toEqual({ ok: false, error: "malformed" });
  });

  it("refuses an oversize paste before parsing it", () => {
    expect(parseEnvelope("!SPOKEN1 books\n" + "x".repeat(70_000))).toEqual({
      ok: false,
      error: "oversize",
    });
  });

  it("tolerates the whitespace a paste picks up", () => {
    expect(parseEnvelope(`\n  \n${fixture("readables-page.txt")}\n\n`).ok).toBe(true);
  });

  it("parses a paste whose newlines came from a Windows client", () => {
    const crlf = fixture("quests-accept.txt").replace(/\n/g, "\r\n");
    const result = parseEnvelope(crlf);
    expect(result.ok).toBe(true);
    expect(result.ok && result.value.text).toBe("Убей шестерых.\n\nПотом возвращайся.");
  });
});

/**
 * Envelopes the modules' own Capture functions wrote in their Lua tests, so the reader is held
 * to what the addon sends today: the pack field, an item offering a quest, gossip with no
 * quest, a zone with no subzone.
 */
describe("envelopes the addon captured", () => {
  const captured = (name: string) => {
    const result = parseEnvelope(fixture(`captured-${name}.txt`));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(name);
    expect(checkEnvelope(result.value).ok).toBe(true);
    return result.value;
  };

  it("reads a quest's text with the client's locale and the packs' language", () => {
    const quest = captured("quests-accept");
    expect(quest.fields).toMatchObject({ quest: "9123", event: "accept", locale: "enUS", pack: "enUS" });
    expect(quest.text).toBe("Kill six of them.\nThen come back.");
  });

  it("reads gossip, which names its speaker and no quest", () => {
    const gossip = captured("quests-gossip");
    expect(gossip.fields.quest).toBeUndefined();
    expect(gossip.fields.npc).toMatch(/^12345 /);
    expect(gossip.text).toBe("We stand ready.");
  });

  it("reads what a modern client observes of the speaker", () => {
    expect(captured("quests-observed").fields).toMatchObject({
      kind: "creature",
      model: "122055",
      sex: "2",
      creature: "Humanoid",
    });
  });

  it("reads a quest an item offers as the item", () => {
    expect(captured("quests-item").fields).toMatchObject({ kind: "item", npc: "211315 Underground Map" });
  });

  it("reads a zone with a subzone, and one without, which leaves the field out", () => {
    expect(captured("places-subzone").fields).toMatchObject({ map: "1537", subzone: "A Nook With No Lore" });
    const zone = captured("places-zone");
    expect(zone.fields.map).toBe("1537");
    expect(zone.fields.subzone).toBeUndefined();
  });

  it("reads a book page with its packs' language", () => {
    const page = captured("readables-page");
    expect(page.fields).toMatchObject({ book: "Ledger of Nothing", number: "2", pack: "enUS" });
  });
});

describe("decodeFragment", () => {
  it("decodes the fixture Contribute:Encode wrote into the byte-identical plaintext envelope", async () => {
    const encoded = fixture("readables-page.e1.txt").trim();
    const result = await decodeFragment(encoded);
    expect(result).toEqual({ ok: true, text: fixture("readables-page.txt") });
  });

  it("refuses an empty fragment", async () => {
    expect(await decodeFragment("")).toEqual({ ok: false, error: "malformed" });
  });

  it("refuses a fragment that is not valid base64url", async () => {
    expect(await decodeFragment("not valid base64url!!!")).toEqual({ ok: false, error: "corrupt" });
  });

  it("refuses a truncated fragment (valid base64url, broken deflate)", async () => {
    const encoded = fixture("readables-page.e1.txt").trim();
    const result = await decodeFragment(encoded.slice(0, Math.floor(encoded.length / 2)));
    expect(result).toEqual({ ok: false, error: "corrupt" });
  });

  // Bite-check: an assertion that would still pass with DecompressionStream deleted is not
  // pinning anything -- this one only means something if the branch above it is provably live.
  it("reports 'unsupported' when DecompressionStream is missing (older Safari)", async () => {
    const real = globalThis.DecompressionStream;
    // @ts-expect-error -- simulating an engine that never defined it
    delete globalThis.DecompressionStream;
    try {
      expect(await decodeFragment("anything")).toEqual({ ok: false, error: "unsupported" });
    } finally {
      globalThis.DecompressionStream = real;
    }
  });
});

describe("checksum", () => {
  it("agrees with the Lua writer on a real envelope", () => {
    const raw = fixture("quests-accept.txt");
    const [, body, sum] = raw.match(/^([\s\S]*\n)sum=(\d+)\n$/)!;
    expect(checksum(body)).toBe(Number(sum));
  });
});

describe("formatEnvelope", () => {
  it.each(["quests-accept.txt", "quests-fenced.txt", "readables-page.txt", "places-zone.txt"])(
    "writes %s back byte for byte, as the addon wrote it",
    (name) => {
      const raw = fixture(name);
      const parsed = parseEnvelope(raw);
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;
      expect(formatEnvelope(parsed.value)).toBe(raw);
    },
  );

  it.each([
    ["legacy-books-page.txt", "readables"],
    ["legacy-zones-zone.txt", "places"],
  ])("writes %s, as a released addon wrote it, back under its section's new key", (name, source) => {
    const parsed = parseEnvelope(fixture(name));
    expect(parsed.ok && parsed.value.source).toBe(source);
    if (!parsed.ok) return;
    const written = formatEnvelope(parsed.value);
    expect(written.startsWith(`!SPOKEN1 ${source}\n`)).toBe(true);
    expect(parseEnvelope(written)).toEqual(parsed);
  });
});
