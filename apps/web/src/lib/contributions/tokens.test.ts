import { describe, expect, it } from "vitest";

import { writtenFromTemplate } from "./tokens";

describe("writtenFromTemplate", () => {
  it("keeps the reader's tokens and breaks the line at $B, as the extract does", () => {
    expect(writtenFromTemplate("$N! A $R $c, $N's kind.$B$BGo.")).toBe("$N! A $R $c, $N's kind.\n\nGo.");
  });

  it("leaves a token it does not know for the text gate to refuse", () => {
    expect(writtenFromTemplate("$2113w crates")).toBe("$2113w crates");
  });
});
