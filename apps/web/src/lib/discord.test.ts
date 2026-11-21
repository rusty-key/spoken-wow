import { describe, expect, it } from "vitest";

import { DISCORD_INVITE, discordRedirects } from "./discord";

describe("spoken.quest/discord", () => {
  it("sends the bare path to the invite", () => {
    expect(discordRedirects).toEqual([{ source: "/discord", destination: DISCORD_INVITE, permanent: false }]);
  });

  it("names an invite, not the redirect itself", () => {
    expect(DISCORD_INVITE).toMatch(/^https:\/\/discord\.gg\/\w+$/);
  });
});
