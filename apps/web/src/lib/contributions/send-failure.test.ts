import { describe, expect, it } from "vitest";

import { sendFailureMessage } from "./send-failure";

describe("sendFailureMessage", () => {
  it("says the site was out of reach when no response came", () => {
    expect(sendFailureMessage(null)).toMatch(/could not reach/);
  });

  it("names the hour's allowance on a 429, so nobody retries in a minute", () => {
    expect(sendFailureMessage(429)).toMatch(/for one hour/);
  });

  it.each([502, 504, 524])("tells a player to wait out a %i and quotes it", (status) => {
    expect(sendFailureMessage(status)).toMatch(new RegExp(`error ${status}.*few minutes`));
  });

  it("quotes the status of anything else it was refused for", () => {
    expect(sendFailureMessage(413)).toContain("error 413");
    expect(sendFailureMessage(400)).toContain("error 400");
  });

  it("names the route's own error when it sent one", () => {
    expect(sendFailureMessage(400, "checksum")).toContain("error 400: checksum");
  });
});
