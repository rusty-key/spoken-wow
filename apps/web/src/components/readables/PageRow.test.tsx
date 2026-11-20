// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";

import { LangProvider } from "@/components/LangProvider";
import type { ResultLine } from "@/lib/readables/search";

import { PageRow } from "./PageRow";

vi.mock("@/lib/auth-client", () => ({ useSession: () => ({ data: null }) }));

afterEach(cleanup);

const page: ResultLine = {
  id: "b:12",
  pageId: 12,
  key: "12",
  bookId: "12",
  pageNumber: 1,
  pageCount: 1,
  title: "Ein Brief",
  ownerKind: "item",
  ownerIds: [1],
  material: 1,
  text: "Lieber Freund.",
  spoken: "Lieber Freund.",
  chars: 14,
  file: "12",
  generatable: true,
  skipReason: null,
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
          <PageRow
            line={line}
            current={false}
            showMadeBy={false}
            showRecordings={false}
            onRecordingChanged={noop}
            {...may}
            canTriage={false}
            onPlay={noop}
            onRegenerate={noop}
            onReport={noop}
            onRestored={noop}
            onEditText={noop}
            onOverride={noop}
            onOverrideAnswered={noop}
            onClearDirty={noop}
          />
        </tbody>
      </table>
    </LangProvider>,
  );
}

const overrideButton = () => screen.queryByRole("button", { name: "Override the text of page 1 of Ein Brief" });

// Override lives behind the row's More menu, with Regenerate and Report.
async function openMore() {
  const more = screen.queryByRole("button", { name: "More actions for page 1 of Ein Brief" });
  if (more) await userEvent.setup().click(more);
}
const pencil = () => screen.queryByRole("button", { name: "Edit the text of page 1 of Ein Brief" });

test("regenerate alone offers the override and not the pencil", async () => {
  row(page, { canRegenerate: true, canEdit: false });
  await openMore();
  expect(overrideButton()?.getAttribute("title")).toBe("Change what your team says");
  expect(pencil()).toBeNull();
});

test("text alone offers the pencil and not the override", async () => {
  row(page, { canRegenerate: false, canEdit: true });
  await openMore();
  expect(pencil()).not.toBeNull();
  expect(overrideButton()).toBeNull();
});

test("a page with no text of its own in the language has nothing to override", async () => {
  row({ ...page, missing: { text: true, title: false } }, { canRegenerate: true, canEdit: true });
  await openMore();
  expect(overrideButton()).toBeNull();
});

test("an override shows under the page, and its drift is marked", () => {
  row(
    {
      ...page,
      spoken: "Teurer Freund.",
      override: { text: "Teurer Freund.", drifted: true, updatedAt: "2026-11-17T00:00:00Z", updatedBy: null },
    },
    { canRegenerate: true, canEdit: false },
  );
  expect(screen.getByText("Lieber Freund.")).not.toBeNull();
  expect(screen.getByText("Teurer Freund.")).not.toBeNull();
  expect(screen.getByText("The original changed since your override.")).not.toBeNull();
});

test("a current override carries no drift mark", () => {
  row(
    { ...page, override: { text: "Teurer Freund.", drifted: false, updatedAt: "2026-11-17T00:00:00Z", updatedBy: null } },
    { canRegenerate: true, canEdit: false },
  );
  expect(screen.getByText("Teurer Freund.")).not.toBeNull();
  expect(screen.queryByText("The original changed since your override.")).toBeNull();
});
