// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { afterEach, expect, test, vi } from "vitest";

import { FilterDates } from "@/components/catalogue/CatalogueSearch";
import QuestsSearchBar from "@/components/SearchBar";
import { SearchBar as PlacesSearchBar } from "@/components/places/SearchBar";
import { SearchBar as ReadablesSearchBar } from "@/components/readables/SearchBar";

afterEach(cleanup);

// Every Explorer builds its URL from the params it rendered with, so two writes in one click
// leave only the second. "All" has to clear the audio state and the reports filter at once.
const both = { state: "missing", reports: "open" } as const;
const cleared = { state: undefined, reports: undefined };

async function pressAll() {
  await userEvent.setup().click(screen.getByRole("button", { name: "All" }));
}

test("quests: All clears the audio state and the reports filter in one write", async () => {
  const onFilters = vi.fn();
  render(
    <QuestsSearchBar
      query=""
      filters={{ ...both }}
      facets={{ races: [], genders: [], flavors: [], voices: [], flavorScopes: [], zones: [] }}
      onQuery={() => {}}
      onFilters={onFilters}
      onClearAll={() => {}}
      canTriage
    />,
  );
  await pressAll();
  expect(onFilters.mock.calls).toEqual([[cleared]]);
});

test("places: All clears the audio state and the reports filter in one write", async () => {
  const onChange = vi.fn();
  render(
    <PlacesSearchBar
      section={{ facetLabel: "Zone", facets: [], labels: { name: "Name", text: "Text", search: "Search" } } as never}
      fields={["any"]}
      kinds={[]}
      filters={{ ...both }}
      canTriage
      query=""
      inputRef={createRef()}
      onQueryChange={() => {}}
      onQuerySubmit={() => {}}
      onChange={onChange}
      onClearAll={() => {}}
    />,
  );
  await pressAll();
  expect(onChange.mock.calls).toEqual([[cleared]]);
});

test("readables: All clears the audio state and the reports filter in one write", async () => {
  const onChange = vi.fn();
  render(
    <ReadablesSearchBar
      books={[]}
      filters={{ ...both }}
      query=""
      inputRef={createRef()}
      onQueryChange={() => {}}
      onQuerySubmit={() => {}}
      onChange={onChange}
      onClearAll={() => {}}
      canTriage
    />,
  );
  await pressAll();
  expect(onChange.mock.calls).toEqual([[cleared]]);
});

test("All is not pressed while a reports filter the viewer has no button for narrows the list", () => {
  render(
    <PlacesSearchBar
      section={{ facetLabel: "Zone", facets: [], labels: { name: "Name", text: "Text", search: "Search" } } as never}
      fields={["any"]}
      kinds={[]}
      filters={{ reports: "open" }}
      canTriage={false}
      query=""
      inputRef={createRef()}
      onQueryChange={() => {}}
      onQuerySubmit={() => {}}
      onChange={() => {}}
      onClearAll={() => {}}
    />,
  );
  expect(screen.queryByRole("button", { name: "Reported" })).toBeNull();
  expect(screen.getByRole("button", { name: "All" }).getAttribute("aria-pressed")).toBe("false");
});

// A browser fires a change for every digit typed into a date's year, each a valid date in year
// 2, 20, 202. Each would be a URL write, a history entry and a search.
test("Made between writes a typed year once it has all four digits", () => {
  const onChange = vi.fn();
  render(<FilterDates label="Made between" after={undefined} before={undefined} onChange={onChange} />);
  const from = screen.getByLabelText("Made between: from");
  for (const value of ["0002-11-18", "0020-11-18", "0202-11-18", "2026-11-18"]) fireEvent.change(from, { target: { value } });
  expect(onChange.mock.calls).toEqual([[{ generatedAfter: "2026-11-18" }]]);
  fireEvent.change(from, { target: { value: "" } });
  expect(onChange).toHaveBeenLastCalledWith({ generatedAfter: undefined });
});

test("readables: a viewer with no take filters gets no empty take group", async () => {
  render(
    <ReadablesSearchBar
      books={[]}
      filters={{}}
      query=""
      inputRef={createRef()}
      onQueryChange={() => {}}
      onQuerySubmit={() => {}}
      onChange={() => {}}
      onClearAll={() => {}}
      canTriage={false}
    />,
  );
  await userEvent.setup().click(screen.getByRole("button", { name: /Filters/ }));
  expect(screen.queryByRole("group", { name: "The take" })).toBeNull();
  expect(screen.queryByRole("group", { name: "The book" })).not.toBeNull();
});

test("Made between drops a half-typed year when the field loses focus", () => {
  const onChange = vi.fn();
  render(<FilterDates label="Made between" after={undefined} before={undefined} onChange={onChange} />);
  const from = screen.getByLabelText("Made between: from") as HTMLInputElement;
  fireEvent.change(from, { target: { value: "0002-01-01" } });
  fireEvent.blur(from);
  expect(from.value).toBe("");
  expect(onChange).not.toHaveBeenCalled();
});

test("Done closes the filter panel and puts focus back on Filters", async () => {
  const user = userEvent.setup();
  render(
    <QuestsSearchBar
      query=""
      filters={{}}
      facets={{ races: [], genders: [], flavors: [], voices: [], flavorScopes: [], zones: [] }}
      onQuery={() => {}}
      onFilters={() => {}}
      onClearAll={() => {}}
      canTriage={false}
    />,
  );
  const filters = screen.getByRole("button", { name: /^Filters/ });
  await user.click(filters);
  await user.click(screen.getByRole("button", { name: "Done" }));
  expect(filters.getAttribute("aria-expanded")).toBe("false");
  expect(document.activeElement).toBe(filters);
});
