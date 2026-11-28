// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";

import { LangProvider } from "@/components/LangProvider";
import { UiTextProvider } from "@/components/UiTextProvider";
import { EN } from "@/lib/ui-text/en";

import WowheadLink from "./WowheadLink";

afterEach(cleanup);

test("a Korean maintainer reading the site in English opens Korean Wowhead", () => {
  // The words follow the reader's interface language; the lines on the page are the team's.
  render(
    <LangProvider lang="koKR">
      <UiTextProvider text={EN}>
        <WowheadLink questId={97968} />
      </UiTextProvider>
    </LangProvider>,
  );
  expect(screen.getByRole("link").getAttribute("href")).toBe("https://www.wowhead.com/forever/ko/quest=97968");
  expect(screen.getByRole("link").getAttribute("title")).toBe(EN.common.lookUpOnWowhead);
});
