import { expect, test } from "vitest";

import { DELETED, type DeletionPreview } from "@/lib/teams/delete";

import { deletionLines } from "./DeleteTeamDialog";

const preview = (counts: Partial<DeletionPreview["counts"]> = {}): DeletionPreview => ({
  id: "t1",
  slug: "crew",
  name: "Crew",
  langs: [],
  members: [],
  counts: { ...Object.fromEntries([...DELETED, "report"].map((table) => [table, 0])), ...counts } as DeletionPreview["counts"],
  reports: { moving: 0, closing: 0 },
  pending: 0,
  packs: [],
  refusal: null,
});

test("lists nothing for a team with nothing", () => {
  expect(deletionLines(preview(), (lang) => lang)).toEqual([]);
});

test("names rows no other line covers, such as ignores and the activity log", () => {
  expect(deletionLines(preview({ line_ignore: 3, activity: 1 }), (lang) => lang)).toEqual([
    "Also 3 ignored lines and 1 activity log entry.",
  ]);
});

test("names settings and a lexicon kept with no voices", () => {
  expect(deletionLines(preview({ generation_setting_locale: 1 }), (lang) => lang)).toEqual([
    "Its generation settings and lexicon.",
  ]);
});
