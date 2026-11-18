// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { LangProvider } from "./LangProvider";
import TeamPicker, { BannerShown } from "./TeamPicker";

const navigation = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  params: new URLSearchParams(),
  role: null as string | null,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: navigation.push, replace: vi.fn(), refresh: navigation.refresh }),
  usePathname: () => "/deDE/places",
  useSearchParams: () => navigation.params,
}));
vi.mock("@/lib/auth-client", () => ({
  useSession: () => ({ data: navigation.role ? { user: { id: "u", role: navigation.role } } : null }),
}));

const fetchMock = vi.fn();

beforeEach(() => {
  navigation.push.mockReset();
  navigation.refresh.mockReset();
  navigation.params = new URLSearchParams("q=town");
  navigation.role = null;
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const main = { id: "t-main", slug: "main-crew", name: "Main Crew", privileged: true };
const second = { id: "t-second", slug: "second-crew", name: "Second Crew", privileged: false };
const mainOwn = { team: main.id, slug: main.slug, name: main.name, own: true };
const secondOwn = { team: second.id, slug: second.slug, name: second.name, own: true };

const picker = (props: Partial<React.ComponentProps<typeof TeamPicker>> = {}) =>
  render(
    <LangProvider lang="deDE">
      <TeamPicker teams={[main, second]} viewed={mainOwn} home={main.slug} {...props} />
    </LangProvider>,
  );

test("one team renders nothing", () => {
  const { container } = picker({ teams: [main] });
  expect(container.innerHTML).toBe("");
});

test("two teams render a select labelled Team, the main team first and marked", () => {
  picker({ teams: [second, main], viewed: secondOwn, home: second.slug });
  const select = screen.getByLabelText("Team") as HTMLSelectElement;
  expect([...select.options].map((option) => [option.value, option.textContent])).toEqual([
    ["main-crew", "Main Crew (main)"],
    ["second-crew", "Second Crew"],
  ]);
  expect(select.value).toBe("second-crew");
  expect(screen.queryByText(/You are listening to/)).toBeNull();
});

test("a visitor's pick navigates to the view, saving nothing", async () => {
  picker();
  await userEvent.setup().selectOptions(screen.getByLabelText("Team"), "second-crew");
  expect(navigation.push).toHaveBeenCalledWith("/deDE/places?q=town&team=second-crew", { scroll: false });
  expect(fetchMock).not.toHaveBeenCalled();
});

test("another team's view says whose takes play", () => {
  picker({ viewed: { ...mainOwn, own: false }, home: second.slug });
  expect(screen.getByText("You are listening to Main Crew. Their takes play; their work is theirs.")).not.toBeNull();
});

test("a site owner's pick is saved first, then shown as their own view", async () => {
  navigation.role = "admin";
  fetchMock.mockResolvedValue(Response.json({ team: second.slug, home: second.slug }));
  picker();
  await userEvent.setup().selectOptions(screen.getByLabelText("Team"), "second-crew");
  await waitFor(() => expect(navigation.push).toHaveBeenCalled());
  expect(fetchMock).toHaveBeenCalledWith("/api/teams/acting", expect.objectContaining({ method: "POST" }));
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ lang: "deDE", team: "second-crew" });
  // The acting team is the pick now, so the address names no team.
  expect(navigation.push).toHaveBeenCalledWith("/deDE/places?q=town", { scroll: false });
  expect(navigation.refresh).toHaveBeenCalled();
});

test("a site owner's pick of the main team drops the team from the address", async () => {
  navigation.role = "admin";
  navigation.params = new URLSearchParams("q=town&team=second-crew");
  fetchMock.mockResolvedValue(Response.json({ team: null, home: main.slug }));
  picker({ viewed: secondOwn, home: second.slug });
  await userEvent.setup().selectOptions(screen.getByLabelText("Team"), "main-crew");
  await waitFor(() => expect(navigation.push).toHaveBeenCalledWith("/deDE/places?q=town", { scroll: false }));
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ lang: "deDE", team: "main-crew" });
});

test("a refused save navigates nowhere and says why", async () => {
  navigation.role = "admin";
  fetchMock.mockResolvedValue(Response.json({ error: "not allowed" }, { status: 403 }));
  picker();
  await userEvent.setup().selectOptions(screen.getByLabelText("Team"), "second-crew");
  expect(await screen.findByText("not allowed")).not.toBeNull();
  expect(navigation.push).not.toHaveBeenCalled();
});

test("below the site owner's banner the explorer's picker hides, so one select shows", () => {
  const { container } = render(
    <LangProvider lang="deDE">
      <BannerShown shown>
        <TeamPicker teams={[main, second]} viewed={secondOwn} home={second.slug} />
      </BannerShown>
    </LangProvider>,
  );
  expect(container.innerHTML).toBe("");
  cleanup();
  picker({ viewed: secondOwn, home: second.slug });
  expect(screen.getByLabelText("Team")).not.toBeNull();
});
