import type { Metadata } from "next";
import { notFound } from "next/navigation";

import AdminHeader from "@/components/AdminHeader";
import ApiTokenTable from "@/components/ApiTokenTable";
import LanguageTable from "@/components/LanguageTable";
import TeamMatrix from "@/components/TeamMatrix";
import UserSearch from "@/components/UserSearch";
import UserTable from "@/components/UserTable";
import { userIdsWithApiKey } from "@/lib/api-key";
import { listGrants, viewerOf } from "@/lib/grants/store";
import { viewerTeams, visibleGrants, visibleInvites } from "@/lib/invites/listing";
import { isLang, langName } from "@/lib/lang";
import { languageStates, textByTeam } from "@/lib/languages/store";
import { isAdmin, langsWhere } from "@/lib/permissions";
import { currentSession } from "@/lib/session";
import { readingLang } from "@/lib/lang-server";
import { fill } from "@/lib/site-text/format";
import { uiText } from "@/lib/ui-text";
import { listAllTokens } from "@/lib/tokens/store";
import { userSortOf } from "@/lib/users/sort";
import { listUsers } from "@/lib/users/store";
import { Contained, Wide } from "@/components/Width";

export const metadata: Metadata = { title: "Users · Spoken" };

export const dynamic = "force-dynamic";

/** Users per page, oldest first. */
const PAGE_SIZE = 25;

/**
 * Who may do what, in one place. `?lang=` opens one language's team: who works on it and a
 * grid of what each may do there. Without it a site admin gets every user on the site, and a
 * language admin the team of the first language they look after.
 *
 * The real access boundary is api/grants and the admin plugin's own routes; this decides
 * only what to draw. A 404 for everyone else: a member has no business learning it exists.
 */
export default async function Page({
  params: route,
  searchParams,
}: {
  params: Promise<{ lang: string }>;
  searchParams: Promise<{ lang?: string; page?: string; q?: string; sort?: string; dir?: string }>;
}) {
  const session = await currentSession();
  const viewer = await viewerOf(session);
  const administered = langsWhere(viewer, "admin");
  if (!session || !viewer || administered.length === 0) notFound();

  const global = isAdmin(viewer.role);
  const t = (await uiText(await readingLang((await route).lang))).admin;
  const params = await searchParams;
  // The `[lang]` segment is the site's language; the team shown comes from `?lang=`.
  const asked = isLang(params.lang) ? administered.find((code) => code === params.lang) : undefined;
  const team = asked ?? (global ? null : administered[0]);

  if (team) {
    const teams = await viewerTeams(viewer, session.user.id);
    const [grants, invites, byTeam] = await Promise.all([
      visibleGrants(viewer, teams, [team]),
      visibleInvites(viewer, teams, [team]),
      textByTeam(team),
    ]);
    return (
      <main className="pb-36">
        <AdminHeader
          lang={team}
          administered={administered}
          global={global}
          tab="team"
          description={
            global
              ? fill(t.teamLedeAdmin, { lang: langName(team) })
              : fill(t.teamLedeOwn, { lang: langName(team) })
          }
        />
        <Contained className="pt-6">
          <TeamMatrix
            key={team}
            lang={team}
            grants={grants}
            invites={invites}
            viewer={viewer}
            textByTeam={byTeam}
            currentUserId={session.user.id}
          />
        </Contained>
      </main>
    );
  }

  const page = Math.max(1, Number.parseInt(params.page ?? "", 10) || 1);
  const q = params.q?.trim() ?? "";
  const sort = userSortOf(params.sort, params.dir);
  // Only a site admin gets here: anybody else has a team to show above.
  const [{ users, total }, grants, keyed, languages, tokens] = await Promise.all([
    listUsers({ q, sort, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }),
    listGrants(),
    // Which accounts hold a key, and nothing else about it. An admin hands out what
    // spends, so they must be able to take back what it spends with; reading a
    // colleague's credential is not part of that, so no value crosses this boundary --
    // not even the redacted hint the owner sees on their own profile.
    userIdsWithApiKey(),
    languageStates(),
    listAllTokens(),
  ]);

  return (
    <main className="pb-36">
      <AdminHeader
        lang={null}
        administered={administered}
        global
        tab="team"
        description={t.usersLede}
      />
      <Wide>
        <UserSearch q={q} sort={sort} />
        <UserTable
          // Remounted per page, search and sort: the table keeps what it was given in state.
          key={`${page}:${q}:${sort.column}:${sort.direction}`}
          users={users}
          grants={grants}
          currentUserId={session.user.id}
          keyedUserIds={keyed}
          q={q}
          sort={sort}
          page={{ page, pageCount: Math.ceil(total / PAGE_SIZE) }}
        />
      </Wide>
      <Contained>
        <h2 className="mt-10 text-lg font-semibold">{t.languagesHeading}</h2>
        <p className="text-muted-foreground mt-1 mb-4 text-sm">{t.languagesLede}</p>
        <LanguageTable initial={languages.map((state) => ({ ...state, name: langName(state.code) }))} />
        <ApiTokenTable initial={tokens} />
      </Contained>
    </main>
  );
}
