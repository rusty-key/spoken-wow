import { describe, expect, it } from "vitest";

import { queueStatus, type QueueLine } from "./queue-line";

const base: QueueLine = {
  owner: "u",
  name: "Ana",
  pending: 1200,
  running: 4,
  status: "active",
  ahead: 0,
  mine: false,
};

describe("queueStatus", () => {
  it("says what an active queue has in flight and left", () => {
    expect(queueStatus(base)).toBe("4 running · 1,200 pending");
  });

  it("says how many queues a waiting one is behind", () => {
    expect(queueStatus({ ...base, status: "waiting", running: 0, ahead: 3 })).toBe(
      "waiting, 3 ahead · 1,200 pending",
    );
  });

  it("says a paused queue is paused, whatever is still finishing", () => {
    // Running jobs outlive the pause; the row says what the queue will do next.
    expect(queueStatus({ ...base, status: "paused" })).toBe("paused, 4 finishing · 1,200 pending");
    expect(queueStatus({ ...base, status: "paused", running: 0 })).toBe("paused · 1,200 pending");
  });
});
