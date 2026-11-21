/**
 * Reading envelopes back out of the file the game writes.
 *
 * The envelopes are the addon's own fixtures, so what is tested is the Lua-literal layer
 * alone: a file holding them must give back exactly the bytes the writer produced, which is
 * also what parseEnvelope's checksum demands.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { parseEnvelope } from "./envelope";
import { decodeLuaString, envelopesFromSavedVariables } from "./saved-variables";

const fixture = (name: string) =>
  readFileSync(new URL(`../../../../../tests/fixtures/contributions/${name}`, import.meta.url), "utf8");

/** A literal the way the game writes one: `\n` for a newline, quotes and backslashes escaped. */
const escaped = (text: string) =>
  `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;

/** The same, the way Lua's own %q writes it: a backslash before a real newline. */
const quoted = (text: string) =>
  `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\\n")}"`;

function file(literals: string[]): string {
  const lines = literals
    .map((literal, i) => `\t\t{\n\t\t\t["key"] = "k${i}",\n\t\t\t["envelope"] = ${literal},\n\t\t}, -- [${i + 1}]`)
    .join("\n");
  return `\nSpokenContributionsDB = {\n\t["Enabled"] = true,\n\t["Introduced"] = true,\n\t["Lines"] = {\n${lines}\n\t},\n}\n`;
}

describe("envelopesFromSavedVariables", () => {
  const quests = fixture("quests-accept.txt");
  const fenced = fixture("quests-fenced.txt");
  const readables = fixture("readables-page.txt");

  it("gives back every envelope byte for byte, as the game escapes them", () => {
    const found = envelopesFromSavedVariables(file([escaped(quests), escaped(fenced), escaped(readables)]));
    expect(found).toEqual([quests, fenced, readables]);
    for (const envelope of found) expect(parseEnvelope(envelope).ok).toBe(true);
  });

  it("reads Lua's backslash-newline form too", () => {
    expect(envelopesFromSavedVariables(file([quoted(quests)]))).toEqual([quests]);
  });

  it("keeps a repeated envelope once", () => {
    expect(envelopesFromSavedVariables(file([escaped(readables), escaped(readables)]))).toEqual([readables]);
  });

  it("ignores every string that is not an envelope", () => {
    expect(envelopesFromSavedVariables(file([]))).toEqual([]);
  });

  it("finds nothing in a file that is not saved variables", () => {
    expect(envelopesFromSavedVariables("just some text\n")).toEqual([]);
  });
});

describe("decodeLuaString", () => {
  it("decodes the escapes Lua writes", () => {
    expect(decodeLuaString('a\\nb\\t\\"c\\"\\\\d')).toBe('a\nb\t"c"\\d');
  });

  it("joins decimal escapes into the character their bytes spell", () => {
    // "й" is 0xD0 0xB9 in UTF-8.
    expect(decodeLuaString("\\208\\185")).toBe("й");
  });
});
