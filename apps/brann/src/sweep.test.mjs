import assert from "node:assert/strict";
import { test } from "node:test";

import { answerComponents, ratedComponents } from "./feedback.mjs";
import { transcript } from "./sweep.mjs";

const msg = (id, author, content, extra = {}) => ({ id, author, content, timestamp: "2026-11-15T14:02:00.000Z", ...extra });
const ana = { id: "1", username: "ana" };
const mod = { id: "2", username: "nucabe", global_name: "Nucabe" };
const brann = { id: "9", username: "brann", bot: true };

test("the transcript marks moderators, Brann, replies and the asker's verdict, and links every reference", () => {
  const { text, links } = transcript([
    {
      guild: "g", channel: "c", title: "#general",
      messages: [
        msg("10", ana, "Where do I get   the packs?"),
        msg("11", mod, "Use the Manager", { message_reference: { message_id: "10" } }),
        msg("12", brann, "<@1> Install the packs", { components: ratedComponents(answerComponents({ dm: true }), false) }),
        msg("13", ana, ""),
      ],
    },
    { guild: "g", channel: "e", title: "#empty", messages: [msg("20", ana, "  ")] },
  ], { meId: "9", moderators: new Set(["2"]) });
  assert.equal(text, [
    "### #general",
    "[m1] 2026-11-15 14:02 ana: Where do I get the packs?",
    "[m2] 2026-11-15 14:02 Nucabe (mod) ↪m1: Use the Manager",
    "[m3] 2026-11-15 14:02 Brann (bot): <@1> Install the packs [asker: not helped]",
  ].join("\n"));
  assert.equal(links.get("m2"), "https://discord.com/channels/g/c/11");
  assert.equal(links.size, 3);
});
