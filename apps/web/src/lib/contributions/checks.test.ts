import { describe, expect, it } from "vitest";

import { checkLine } from "./checks";

const de = (text: string | null, english: string | null) => checkLine({ text, english, locale: "deDE" });

describe("checkLine", () => {
  it("keeps a whole German line with the English line's placeholders", () => {
    expect(de("Gut gemacht, $N. Ihr habt Euch Euren Lohn verdient.", "Well done, $N. You have earned your pay.")).toEqual({
      verdict: "clean",
      findings: [],
      fix: undefined,
    });
    // Case and the doubled form of TBC and Forever do not matter.
    expect(de("Gut gemacht, $$N.", "Well done, $n.").verdict).toBe("clean");
    expect(de("Das ist $Ns Schwert.", "That is $N's sword.").verdict).toBe("clean");
  });

  it("ignores a gender branch the player's client already resolved", () => {
    expect(de("Willkommen, Reisende.", "Welcome, $gtraveler:traveler;.").verdict).toBe("clean");
  });

  it("suggests swapping back the one placeholder that changed", () => {
    const check = de("Seid gegrüßt, $R. Habt Ihr Gnolle getötet?", "Hail, $N.  Have you been killing Gnolls?");
    expect(check.verdict).toBe("fix");
    expect(check.fix).toEqual({ removed: "$R", added: "$N", text: "Seid gegrüßt, $N. Habt Ihr Gnolle getötet?" });
    expect(check.findings[0].message).toMatch(/name \(\$N\).*race \(\$R\)/);
  });

  it("flags a name or class spelled out where English has its placeholder, with no fix to guess", () => {
    const named = de("Habt Ihr Orcs erschlagen, Digawen?", "Have you been slaying orcs, $N?");
    expect(named.verdict).toBe("fix");
    expect(named.fix).toBeUndefined();
    expect(named.findings[0].message).toMatch(/name \(\$N\).*spelled out/);
    expect(de("Gut gemacht, Krieger.", "Well done, $c.").findings[0].message).toMatch(/class \(\$C\)/);
  });

  it("flags a placeholder English does not have", () => {
    expect(de("Danke, $N.", "Thank you.").findings[0].message).toMatch(/has \$N, which the English line does not/);
  });

  it("drops a line that was not translated", () => {
    const same = "Orc pressure from Blackrock is still tense.  But have you at least rid us of Tharil'zun?";
    expect(de(same, same).verdict).toBe("drop");
    expect(de("Have you got the things that I need for the work?", "Something else entirely.").verdict).toBe("drop");
    // German words that are spelled like English ones do not make a line English.
    expect(de("Was will er denn hier?", "What does he want here?").verdict).toBe("clean");
    expect(de("Not, Not und nochmals Not!", "Need, need and need again!").verdict).toBe("clean");
    // English is the base language: no English line is "not translated".
    expect(checkLine({ text: same, english: same, locale: "enUS" }).verdict).toBe("clean");
  });

  it("drops a line cut off where the English one goes on", () => {
    const check = de(
      "Die Feldarbeit macht durstig.\n\n...",
      "Farming is thirsty work.\n\nIf you have any, then I'm willing to make a trade.",
    );
    expect(check.verdict).toBe("drop");
    expect(check.findings.map((finding) => finding.message)).toContainEqual(expect.stringMatching(/cut off/));
    // An ellipsis the English line has too is the text's own.
    expect(de("Hm... vielleicht.", "Hmm... perhaps.").verdict).toBe("clean");
  });

  it("names a token the gate cannot speak, as text-hints does", () => {
    const check = de("Ihr seid $einen würdigen Schüler.", "You are a worthy student.");
    expect(check.verdict).toBe("fix");
    expect(check.findings[0].message).toBe("Unspoken token $einen: won't be voiced.");
  });

  it("offers a fix only when it settles the whole line", () => {
    const check = de("Seid gegrüßt, $R, $einen Freund.", "Hail, $N, friend.");
    expect(check.verdict).toBe("fix");
    expect(check.fix).toBeUndefined();
  });

  it("keeps a name that is the same in every language", () => {
    expect(de("Thrall", "Thrall").verdict).toBe("clean");
  });

  it("asks for a look, not a drop, when only a closing ellipsis differs", () => {
    const check = de("Wartet hier …", "Wait here.");
    expect(check.verdict).toBe("look");
    expect(check.findings[0].tone).toBe("info");
  });

  it("counts a gender branch's placeholders on the side the player saw", () => {
    expect(de("Willkommen, $N.", "Welcome, $g$N:$N;.").verdict).toBe("clean");
    expect(de("Willkommen, Fremde.", "Welcome, $gfriend:$N;.").verdict).toBe("clean");
  });

  it("offers a swap only for a unique target", () => {
    // Two $R against $R and $N: which one changes is not knowable.
    const two = de("Nur ein $R darf hinein, $R.", "Only a $R may enter, $N.");
    expect(two.verdict).toBe("fix");
    expect(two.fix).toBeUndefined();
    // Two too many and two too few is not one swap.
    expect(de("Hallo, $R und $R.", "Hello, $N and $N.").fix).toBeUndefined();
  });

  it("keeps the genitive of the token it swaps", () => {
    expect(de("Das ist $Cs Schwert.", "That is $N's sword.").fix).toEqual({ removed: "$Cs", added: "$Ns", text: "Das ist $Ns Schwert." });
  });

  it("asks for a look when there is no English line to compare with", () => {
    expect(de("Ein ganz normaler Satz.", null)).toEqual({
      verdict: "look",
      findings: [{ tone: "info", message: "No English line was found to compare it with." }],
      fix: undefined,
    });
    // English has no original to compare with, and needs none.
    expect(checkLine({ text: "A plain line.", english: null, locale: "enUS" }).verdict).toBe("clean");
    expect(de("", "Hello.").verdict).toBe("drop");
    expect(de(null, "Hello.").verdict).toBe("drop");
  });
});
