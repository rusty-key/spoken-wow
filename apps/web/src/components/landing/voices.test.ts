import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { CODES } from "@/lib/lang";

import { VOICES, type Voice } from "./voices";

const dir = join(__dirname, "voices");
const publicDir = join(__dirname, "..", "..", "..", "public");

const sets: [string, Record<string, Voice[]>][] = [
  ["voices.ts", VOICES],
  ...readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .map((file): [string, Record<string, Voice[]>] => [file, JSON.parse(readFileSync(join(dir, file), "utf8"))]),
];

describe("the front page's voice samples", () => {
  it("has a file for every language", () => {
    for (const code of CODES) expect(existsSync(join(dir, `${code}.json`)), code).toBe(true);
  });

  for (const [name, set] of sets) {
    describe(name, () => {
      const voices = Object.values(set).flat();

      it("has a clip per part, and each part's clips are different", () => {
        for (const [part, list] of Object.entries(set)) {
          expect(new Set(list.map((voice) => voice.audio)).size, part).toBe(list.length);
        }
      });

      it("has one start time per word, in order and inside the clip", () => {
        for (const voice of voices) {
          expect(voice.times, voice.name).toHaveLength(voice.words.length);
          expect(voice.duration, voice.name).toBeGreaterThan(0);
          voice.times.forEach((time, i) => {
            expect(time, `${voice.name} word ${i}`).toBeGreaterThanOrEqual(i ? voice.times[i - 1] : 0);
            expect(time, `${voice.name} word ${i}`).toBeLessThanOrEqual(voice.duration);
          });
          expect(voice.peaks, voice.name).toHaveLength(96);
        }
      });

      it("points at audio and an icon that are in public/ and holds no replacement character", () => {
        for (const voice of voices) {
          expect(existsSync(join(publicDir, voice.audio)), voice.audio).toBe(true);
          expect(existsSync(join(publicDir, voice.icon)), voice.icon).toBe(true);
          expect(JSON.stringify(voice), voice.name).not.toContain("�");
        }
      });
    });
  }

  it("has three hero subtitle lines in every file, with words and no replacement character", () => {
    const heroDir = join(__dirname, "hero");
    expect(existsSync(join(heroDir, "enUS.json"))).toBe(true);
    for (const file of readdirSync(heroDir)) {
      const lines = JSON.parse(readFileSync(join(heroDir, file), "utf8"));
      expect(lines, file).toHaveLength(3);
      for (const line of lines) {
        expect(line.words.length, file).toBeGreaterThan(2);
        expect(JSON.stringify(line), file).not.toContain("�");
      }
    }
  });
});
