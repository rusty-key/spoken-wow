/**
 * The site owner's banner in the language layout. The session and the cookie jar are mocked;
 * the teams are real.
 *
 * Needs DATABASE_URL and migrations applied.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/lib/db";
import type { Lang } from "@/lib/lang";
import { forgetTeams, secondTeamLangs, type TeamId } from "@/lib/teams/store";
import { dropLang, dropTeam, newTeamIn, systemRows, testUser, uniqueLang } from "@/lib/teams/testing";

const mocks = vi.hoisted(() => ({
  cookie: undefined as string | undefined,
  session: vi.fn(),
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({
    get: (name: string) => (name === "spoken_team" && mocks.cookie !== undefined ? { name, value: mocks.cookie } : undefined),
  }),
}));
vi.mock("@/lib/session", () => ({ currentSession: mocks.session }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/auth-client", () => ({ useSession: () => ({ data: null }) }));

import ActingBanner from "./ActingBanner";

let lang: Lang;
let single: Lang;
let a: TeamId;
let b: TeamId;
let c: TeamId;
let slugs: Record<"a" | "b" | "c", string>;
let names: Record<"b", string>;
let owner: Awaited<ReturnType<typeof testUser>>;

const choose = (choice: Record<string, string>) => {
  mocks.cookie = encodeURIComponent(JSON.stringify(choice));
};
const banner = async (at: Lang) => {
  const element = await ActingBanner({ lang: at });
  return element === null ? null : renderToStaticMarkup(element);
};

beforeAll(async () => {
  lang = await uniqueLang();
  single = await uniqueLang();
  a = await newTeamIn(lang, true, "test-banner-a");
  b = await newTeamIn(lang, false, "test-banner-b");
  c = await newTeamIn(single, true, "test-banner-c");
  owner = await testUser("test-banner-owner");
  const row = async (team: TeamId) =>
    (await systemRows<{ slug: string; name: string }>(`select "slug", "name" from "team" where "id" = $1`, [team]))[0];
  const [ra, rb, rc] = [await row(a), await row(b), await row(c)];
  slugs = { a: ra.slug, b: rb.slug, c: rc.slug };
  names = { b: rb.name };
});

beforeEach(() => {
  forgetTeams();
  vi.restoreAllMocks();
  mocks.cookie = undefined;
  mocks.session.mockReset();
  mocks.session.mockResolvedValue({ user: { id: owner.id, role: "admin" } });
});

afterAll(async () => {
  for (const team of [a, b, c]) await dropTeam(team);
  await owner.cleanup();
  await dropLang(lang);
  await dropLang(single);
  await closeDb();
});

describe("ActingBanner", () => {
  it("says which team a site owner works as, with the picker", async () => {
    choose({ [lang]: slugs.b });
    const html = (await banner(lang))!;
    expect(html).toContain(`Working as ${names.b}`);
    expect(html).toContain("Team</label>");
  });

  it("shows nothing for a member's forged cookie", async () => {
    mocks.session.mockResolvedValue({ user: { id: owner.id, role: "member" } });
    choose({ [lang]: slugs.b });
    expect(await banner(lang)).toBeNull();
  });

  it("shows nothing for the main team, another language's entry or a team of another language", async () => {
    choose({ [lang]: slugs.a });
    expect(await banner(lang)).toBeNull();
    choose({ [single]: slugs.c });
    expect(await banner(lang)).toBeNull();
    choose({ [lang]: slugs.c });
    expect(await banner(lang)).toBeNull();
  });

  it("reads nothing but the cookie without an entry for the language", async () => {
    await secondTeamLangs();
    const pool = db();
    const queries = vi.spyOn(pool, "query");
    const connects = vi.spyOn(pool, "connect");
    expect(await banner(lang)).toBeNull();
    choose({ [lang]: slugs.b });
    expect(await banner(single)).toBeNull();
    expect(mocks.session).not.toHaveBeenCalled();
    expect(queries).not.toHaveBeenCalled();
    expect(connects).not.toHaveBeenCalled();
  });

  it("in a single-team language reads only the memo, and no session", async () => {
    choose({ [single]: slugs.c });
    await secondTeamLangs();
    const pool = db();
    const queries = vi.spyOn(pool, "query");
    const connects = vi.spyOn(pool, "connect");
    expect(await banner(single)).toBeNull();
    expect(mocks.session).not.toHaveBeenCalled();
    expect(queries).not.toHaveBeenCalled();
    expect(connects).not.toHaveBeenCalled();
  });
});
