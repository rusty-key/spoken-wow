// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { afterEach, expect, test, vi } from "vitest";

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
      facets={{ races: [], genders: [], flavors: [], voices: [], flavorScopes: [] }}
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
