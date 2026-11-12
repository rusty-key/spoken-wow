/** Needs DATABASE_URL and migrations applied. */
import { afterAll, afterEach, describe, expect, it } from "vitest";

import { closeDb } from "@/lib/db";
import { isLang, langName, langTag, registerLanguages } from "@/lib/lang";
import { pageLang } from "@/lib/lang-server";
import { listenForTeamChanges, stopListening } from "@/lib/teams/listen";
import { asSystem } from "@/lib/teams/testing";

import { forgetLanguages, loadLanguages } from "./catalogue";

const TEST_CODES = ["jaJP", "qaQA"];

afterEach(async () => {
  await asSystem.query(`delete from "language" where "code" = any($1)`, [TEST_CODES]);
  forgetLanguages();
  registerLanguages([]);
});

afterAll(async () => {
  await stopListening();
  await closeDb();
});

async function insertJapanese(enabled = false): Promise<void> {
  await asSystem.query(
    `insert into "language" ("code", "name", "native", "bcp47", "provider", "client", "enabled")
     values ('jaJP', 'Japanese', '日本語', 'ja-JP', 'ja', true, $1)`,
    [enabled],
  );
}

describe("loadLanguages", () => {
  it("registers every row of the language table", async () => {
    await insertJapanese();
    forgetLanguages();
    await loadLanguages();
    expect(isLang("jaJP")).toBe(true);
    expect(langName("jaJP")).toBe("Japanese");
  });

  it("fills a row an older release left undescribed", async () => {
    await asSystem.query(`insert into "language" ("code") values ('qaQA')`);
    forgetLanguages();
    const qa = (await loadLanguages()).find((info) => info.code === "qaQA");
    expect(qa).toEqual({ code: "qaQA", name: "qaQA", native: "qaQA", bcp47: "qa-QA", provider: "qa", client: false });
    expect(langTag("qaQA")).toBe("qa-QA");
  });
});

describe("pageLang", () => {
  it("serves an enabled language from a cold memo", async () => {
    await insertJapanese(true);
    forgetLanguages();
    registerLanguages([]);
    expect(isLang("jaJP")).toBe(false);
    await expect(pageLang(Promise.resolve({ lang: "jaJP" }))).resolves.toBe("jaJP");
  });
});

// Last: once listening, every fixture write also reloads the registry in the background.
describe("the listener", () => {
  it("follows a language added by another connection", async () => {
    listenForTeamChanges();
    await loadLanguages();
    await asSystem.query(
      `insert into "language" ("code", "name", "native", "bcp47", "provider", "client")
       values ('qaQA', 'Test', 'Test', 'qa-QA', 'qa', false)`,
    );
    const deadline = Date.now() + 1_000;
    while (!isLang("qaQA") && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(isLang("qaQA")).toBe(true);
  });
});
