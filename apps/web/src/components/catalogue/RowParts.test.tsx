// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";

import { RowActions, type RowAction } from "@/components/catalogue/RowParts";

afterEach(cleanup);

const report: RowAction = { label: "Report a problem", aria: "Report Goldshire", onClick: () => {} };
const ignore: RowAction = { label: "Never voice this line", aria: "Ignore Goldshire", onClick: () => {} };

test("a lone action is a plain button, not a menu of one", () => {
  render(<RowActions subject="Goldshire" primary={[]} more={[report]} />);
  expect(screen.queryByRole("button", { name: "Report Goldshire" })).not.toBeNull();
  expect(screen.queryByRole("button", { name: "More actions for Goldshire" })).toBeNull();
});

// Two text buttons side by side overflow the narrow actions column a viewer without edit
// actions gets, so two rare actions go behind More even with nothing else on the row.
test("two rare actions go behind More even without edit actions", () => {
  render(<RowActions subject="Goldshire" primary={[]} more={[report, ignore]} />);
  expect(screen.queryByRole("button", { name: "Report Goldshire" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Ignore Goldshire" })).toBeNull();
  expect(screen.queryByRole("button", { name: "More actions for Goldshire" })).not.toBeNull();
});
