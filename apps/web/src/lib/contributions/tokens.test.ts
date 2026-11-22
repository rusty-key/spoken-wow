import { describe, expect, it } from "vitest";

import { writtenFromTemplate } from "./tokens";

describe("writtenFromTemplate", () => {
  it("keeps the reader's tokens and breaks the line at $B, as the extract does", () => {
    expect(writtenFromTemplate("$N! A $R $c, $N's kind.$B$BGo.")).toBe("$N! A $R $c, $N's kind.\n\nGo.");
  });

  it("writes the word into a token glued to a letter, as the extract does", () => {
    expect(writtenFromTemplate("Take it from me, $nama.")).toBe("Take it from me, adventurerama.");
  });

  it("leaves a token it does not know for the text gate to refuse", () => {
    expect(writtenFromTemplate("$2113w crates")).toBe("$2113w crates");
  });
});
