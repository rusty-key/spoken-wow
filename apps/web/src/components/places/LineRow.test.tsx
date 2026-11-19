// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";

import { LangProvider } from "@/components/LangProvider";
import type { ResultLine } from "@/lib/places/search";

import { LineRow } from "./LineRow";

vi.mock("@/lib/auth-client", () => ({ useSession: () => ({ data: null }) }));

afterEach(cleanup);

const goldshire: ResultLine = {
  id: "s:1429:goldshire",
  kind: "subzone",
  mapID: 1429,
  zoneName: "Elwynn",
  name: "Goldshire",
  text: "A town at a crossroads.",
  spoken: "A town at a crossroads.",
  chars: 23,
  short: true,
  file: "s-1429-goldshire",
  state: "current",
  take: null,
  reportsOpen: 0,
  dirty: false,
  madeBy: null,
  override: null,
};

function row(line: ResultLine, may: { canRegenerate: boolean; canEdit: boolean }) {
  const noop = () => {};
  render(
    <LangProvider lang="deDE">
      <table>
        <tbody>
          <LineRow
            section={{ source: "places", facetLabel: "Zone" }}
            line={line}
            current={false}
            showMadeBy={false}
            showRecordings={false}
            onRecordingChanged={noop}
            {...may}
            canTriage={false}
            onPlay={noop}
            onReport={noop}
            onRestored={noop}
            onEditText={noop}
            onOverride={noop}
            onOverrideAnswered={noop}
            onRename={null}
            onRegenerate={noop}
            onClearDirty={noop}
          />
        </tbody>
      </table>
    </LangProvider>,
  );
}

const overrideButton = () => screen.queryByRole("button", { name: "Override the text of Goldshire" });
const pencil = () => screen.queryByRole("button", { name: "Edit the text of Goldshire" });

// Override lives behind the row's More menu, with Regenerate and Report.
async function openMore() {
  const more = screen.queryByRole("button", { name: "More actions for Goldshire" });
  if (more) await userEvent.setup().click(more);
}

test("regenerate alone offers the override and not the pencil", async () => {
  row(goldshire, { canRegenerate: true, canEdit: false });
  await openMore();
  expect(overrideButton()).not.toBeNull();
  expect(overrideButton()?.getAttribute("title")).toBe("Change what your team says");
  expect(pencil()).toBeNull();
});

test("text alone offers the pencil and not the override", async () => {
  row(goldshire, { canRegenerate: false, canEdit: true });
  await openMore();
  expect(pencil()).not.toBeNull();
  expect(overrideButton()).toBeNull();
});

test("a line with no text of its own in the language has nothing to override", async () => {
  row({ ...goldshire, translated: false }, { canRegenerate: true, canEdit: true });
  await openMore();
  expect(overrideButton()).toBeNull();
});

test("an override shows as the spoken line, and its drift is marked", () => {
  row(
    {
      ...goldshire,
      spoken: "Goldshire, at the crossroads.",
      override: { text: "Goldshire, at the crossroads.", drifted: true, updatedAt: "2026-11-17T00:00:00Z", updatedBy: null },
    },
    { canRegenerate: true, canEdit: false },
  );
  expect(screen.getByText("Goldshire, at the crossroads.")).not.toBeNull();
  expect(screen.getByText("A town at a crossroads.")).not.toBeNull();
  expect(screen.getByText("The original changed since your override.")).not.toBeNull();
  expect(screen.getByRole("button", { name: "Keep" })).not.toBeNull();
  expect(screen.getByRole("button", { name: "Drop" })).not.toBeNull();
});

test("a current override carries no drift mark", () => {
  row(
    { ...goldshire, override: { text: "Goldshire.", drifted: false, updatedAt: "2026-11-17T00:00:00Z", updatedBy: null } },
    { canRegenerate: true, canEdit: false },
  );
  expect(screen.getByText("Goldshire.")).not.toBeNull();
  expect(screen.queryByText("The original changed since your override.")).toBeNull();
});

// Missing or outdated audio makes generating the row's task, so it is a button, not a menu item.
test("a line with no audio offers Generate on the row, and current audio keeps it in More", async () => {
  row({ ...goldshire, state: "missing" }, { canRegenerate: true, canEdit: true });
  expect(screen.queryByRole("button", { name: "Generate Goldshire" })).not.toBeNull();
  cleanup();
  row({ ...goldshire, state: "current" }, { canRegenerate: true, canEdit: true });
  expect(screen.queryByRole("button", { name: /^(Generate|Regenerate) Goldshire/ })).toBeNull();
  await openMore();
  expect(screen.queryByRole("button", { name: "Regenerate Goldshire" })).not.toBeNull();
});
