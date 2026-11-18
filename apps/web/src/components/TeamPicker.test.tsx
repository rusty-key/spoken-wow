// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";

import TeamPicker from "./TeamPicker";

afterEach(cleanup);

const main = { id: "t-main", slug: "main-crew", name: "Main Crew", privileged: true };
const second = { id: "t-second", slug: "second-crew", name: "Second Crew", privileged: false };

test("one team renders nothing", () => {
  const { container } = render(
    <TeamPicker teams={[main]} viewed={{ team: main.id, slug: main.slug, name: main.name, own: true }} onPick={vi.fn()} />,
  );
  expect(container.innerHTML).toBe("");
});

test("two teams render a select labelled Team, the main team first and marked", () => {
  render(
    <TeamPicker
      teams={[second, main]}
      viewed={{ team: second.id, slug: second.slug, name: second.name, own: true }}
      onPick={vi.fn()}
    />,
  );
  const select = screen.getByLabelText("Team") as HTMLSelectElement;
  expect([...select.options].map((option) => [option.value, option.textContent])).toEqual([
    ["main-crew", "Main Crew (main)"],
    ["second-crew", "Second Crew"],
  ]);
  expect(select.value).toBe("second-crew");
  expect(screen.queryByText(/You are listening to/)).toBeNull();
});

test("picking calls onPick with the slug", async () => {
  const onPick = vi.fn();
  render(
    <TeamPicker
      teams={[main, second]}
      viewed={{ team: second.id, slug: second.slug, name: second.name, own: true }}
      onPick={onPick}
    />,
  );
  await userEvent.setup().selectOptions(screen.getByLabelText("Team"), "main-crew");
  expect(onPick).toHaveBeenCalledWith("main-crew");
});

test("another team's view says whose takes play", () => {
  render(
    <TeamPicker
      teams={[main, second]}
      viewed={{ team: main.id, slug: main.slug, name: main.name, own: false }}
      onPick={vi.fn()}
    />,
  );
  expect(screen.getByText("You are listening to Main Crew. Their takes play; their work is theirs.")).not.toBeNull();
});
