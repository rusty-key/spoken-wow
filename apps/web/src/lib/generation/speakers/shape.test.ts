import { describe, expect, it } from "vitest";

import { PARAGRAPH_BREAK, SHAPE } from "./shape";

describe("how fish.audio is sent a line", () => {
  it("marks each paragraph break once, and flattens every other run of whitespace", () => {
    expect(SHAPE.fish("esa es ella.\n\nEstá en   nuestra casa.  \r\n \n Ven.", undefined)).toBe(
      ["esa es ella.", "Está en nuestra casa.", "Ven."].join(PARAGRAPH_BREAK),
    );
  });

  it("drops breaks at either end", () => {
    expect(SHAPE.fish("\n\n Hello there. \n", undefined)).toBe("Hello there.");
  });

  it("opens every paragraph with the accent, since each is spoken on its own", () => {
    expect(SHAPE.fish("Aye.\n\n<hic> <He points north.>\nGo.", "[Scottish accent]")).toBe(
      [
        "[Scottish accent] Aye.",
        "[Scottish accent] [hic] <He points north.>",
        "[Scottish accent] Go.",
      ].join(PARAGRAPH_BREAK),
    );
  });
});

describe("a voice marker on fish.audio", () => {
  it("carries its slot's accent into the paragraphs after it", () => {
    const tags = { dwarf: "[Scottish accent]", goblin: "[nasal]" };
    expect(SHAPE.fish("Aye.\n\n_goblin-male-zany_\nOne.\n\nTwo.", tags.dwarf, tags)).toBe(
      ["[Scottish accent] Aye.", "_goblin-male-zany_", "[nasal] One.", "[nasal] Two."].join(
        PARAGRAPH_BREAK,
      ),
    );
  });
});

describe("how ElevenLabs is sent a line", () => {
  it("keeps its paragraph breaks as written, so its takes do not all turn stale", () => {
    expect(SHAPE.elevenlabs("One.\n\nTwo.", undefined)).toBe("One.\n\nTwo.");
  });
});
