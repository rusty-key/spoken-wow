// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";

import { RowActions, type RowAction } from "@/components/catalogue/RowParts";

afterEach(cleanup);

const report: RowAction = { label: "Report a problem", aria: "Report a problem with Goldshire", onClick: () => {} };
const ignore: RowAction = { label: "Never voice this line", aria: "Never voice this line: Goldshire", onClick: () => {} };

test("a lone action is a plain button, not a menu of one", () => {
  render(<RowActions subject="Goldshire" primary={[]} more={[report]} />);
  expect(screen.queryByRole("button", { name: "Report a problem with Goldshire" })).not.toBeNull();
  expect(screen.queryByRole("button", { name: "More actions for Goldshire" })).toBeNull();
});

// Two text buttons side by side overflow the narrow actions column a viewer without edit
// actions gets, so two rare actions go behind More even with nothing else on the row.
test("two rare actions go behind More even without edit actions", () => {
  render(<RowActions subject="Goldshire" primary={[]} more={[report, ignore]} />);
  expect(screen.queryByRole("button", { name: "Report a problem with Goldshire" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Never voice this line: Goldshire" })).toBeNull();
  expect(screen.queryByRole("button", { name: "More actions for Goldshire" })).not.toBeNull();
});

test("a picked More item runs once the menu has closed", async () => {
  const onClick = vi.fn();
  const user = userEvent.setup();
  render(<RowActions subject="Goldshire" primary={[]} more={[{ ...report, onClick }, ignore]} />);
  await user.click(screen.getByRole("button", { name: "More actions for Goldshire" }));
  await user.click(screen.getByRole("button", { name: "Report a problem with Goldshire" }));
  await waitFor(() => expect(onClick).toHaveBeenCalledOnce());
  expect(screen.queryByRole("button", { name: "Never voice this line: Goldshire" })).toBeNull();
});

// Closing the menu by clicking elsewhere must leave focus where that click put it: pulling it
// back to More swallowed what was typed into the search field next.
test("clicking elsewhere to close More leaves focus there", async () => {
  const user = userEvent.setup();
  render(
    <>
      <input aria-label="Search" />
      <RowActions subject="Goldshire" primary={[]} more={[report, ignore]} />
    </>,
  );
  await user.click(screen.getByRole("button", { name: "More actions for Goldshire" }));
  expect(screen.queryByRole("button", { name: "Report a problem with Goldshire" })).not.toBeNull();
  await user.click(screen.getByRole("textbox", { name: "Search" }));
  await waitFor(() => expect(screen.queryByRole("button", { name: "Report a problem with Goldshire" })).toBeNull());
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Search" }));
});

test("the More menu is named for its line", async () => {
  render(<RowActions subject="Goldshire" primary={[]} more={[report, ignore]} />);
  await userEvent.setup().click(screen.getByRole("button", { name: "More actions for Goldshire" }));
  expect(screen.getByRole("dialog", { name: "More actions for Goldshire" })).not.toBeNull();
});
