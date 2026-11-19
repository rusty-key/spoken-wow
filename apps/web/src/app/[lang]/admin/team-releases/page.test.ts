import { isValidElement, type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import AdminHeader from "@/components/AdminHeader";
import ReviewQueue from "@/components/releases/ReviewQueue";
import type { WaitingVersion } from "@/lib/releases/sections";

const who = vi.hoisted(() => ({ role: "member" as string | null }));
vi.mock("@/lib/session", () => ({
  currentSession: async () => (who.role === null ? null : { user: { id: "u1", role: who.role } }),
}));

const review = vi.hoisted(() => ({ waitingReviews: vi.fn(), liveTeamPacks: vi.fn() }));
vi.mock("@/lib/releases/review", () => review);

const sync = vi.hoisted(() => ({ syncActive: vi.fn() }));
vi.mock("@/lib/releases/sync", () => sync);

import Page from "./page";

const waiting = [{ id: "a" }, { id: "b" }] as WaitingVersion[];

/** Every element in the tree the page returned, depth first. */
function elements(node: ReactNode): ReactElement[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement(node)) return [];
  const props = node.props as { children?: ReactNode };
  return [node, ...elements(props.children)];
}

const propsOf = <P>(tree: ReactNode, type: unknown) => elements(tree).find((el) => el.type === type)?.props as P;

beforeEach(() => {
  review.waitingReviews.mockReset().mockResolvedValue(waiting);
  review.liveTeamPacks.mockReset().mockResolvedValue([]);
  sync.syncActive.mockReset().mockResolvedValue(null);
});

describe("the team releases page", () => {
  it("is not found for anybody but a site owner", async () => {
    for (const role of [null, "member"]) {
      who.role = role;
      await expect(Page()).rejects.toMatchObject({ digest: expect.stringContaining("404") });
    }
    expect(review.waitingReviews).not.toHaveBeenCalled();
    expect(sync.syncActive).not.toHaveBeenCalled();
  });

  it("settles a finished run before it lists, so a version listed meanwhile is not shown as being listed", async () => {
    who.role = "admin";
    await Page();
    expect(sync.syncActive).toHaveBeenCalledTimes(1);
    expect(sync.syncActive.mock.invocationCallOrder[0]).toBeLessThan(review.waitingReviews.mock.invocationCallOrder[0]);
  });

  it("lists the waiting versions, and the header counts the same ones", async () => {
    who.role = "admin";
    const tree = await Page();
    expect(propsOf<{ waiting: WaitingVersion[] }>(tree, ReviewQueue).waiting).toBe(waiting);
    expect(propsOf<{ pendingReleases: number; tab: string }>(tree, AdminHeader)).toMatchObject({
      tab: "team-releases",
      pendingReleases: 2,
    });
  });
});
