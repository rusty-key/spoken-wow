import type { Metadata } from "next";
import { notFound } from "next/navigation";

import LanguageTable from "@/components/LanguageTable";
import UserSearch from "@/components/UserSearch";
import UserTable from "@/components/UserTable";
import { userIdsWithApiKey } from "@/lib/api-key";
import { listGrants, viewerOf } from "@/lib/grants/store";
import { langName } from "@/lib/lang";
import { languageStates } from "@/lib/languages/store";
import { isAdmin, langsWhere } from "@/lib/permissions";
import { currentSession } from "@/lib/session";
import { userSortOf } from "@/lib/users/sort";
import { listUsers } from "@/lib/users/store";
import LocaleLink from "@/components/LocaleLink";
import { Contained, Wide } from "@/components/Width";

export const metadata: Metadata = { title: "Users · Spoken" };

export const dynamic = "force-dynamic";

/** Users per page, oldest first. */
const PAGE_SIZE = 25;

/**
 * Who may do what, in one place: a global admin's whole user list with each person's role
 * and languages, or -- for somebody who is admin in a language -- the people working in the
 * languages they look after, and the means to bring more in without asking anybody.
 *
 * The real access boundary is api/grants and the admin plugin's own routes; this decides
 * only what to draw. A 404 for everyone else: a member has no business learning it exists.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string; sort?: string; dir?: string }>;
}) {
  const session = await currentSession();
  const viewer = await viewerOf(session);
  const administered = langsWhere(viewer, "admin");
  if (!session || !viewer || administered.length === 0) notFound();

  const global = isAdmin(viewer.role);
  const params = await searchParams;
  const page = Math.max(1, Number.parseInt(params.page ?? "", 10) || 1);
  const q = params.q?.trim() ?? "";
  const sort = userSortOf(params.sort, params.dir);
  // A language admin's list is built from the grants alone (UserTable adds their holders),
  // not from listUsers, which lists every address on the site -- more than looking after one
  // language entitles anybody to.
  //
  // Only a global admin's list is paged, searched and sorted on the server: a language
  // admin's is however many people work in their languages, a handful the table filters and
  // sorts itself.
  const [{ users, total }, grants, keyed, languages] = global
    ? await Promise.all([
        listUsers({ q, sort, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }),
        listGrants(),
        // Which accounts hold a key, and nothing else about it. An admin hands out what
        // spends, so they must be able to take back what it spends with; reading a
        // colleague's credential is not part of that, so no value crosses this boundary --
        // not even the redacted hint the owner sees on their own profile.
        userIdsWithApiKey(),
        languageStates(),
      ])
    : [{ users: [], total: 0 }, await listGrants(administered), null, null];

  return (
    <main className="pt-6 pb-36">
      <Contained>
        <h1 className="text-xl font-semibold">Users</h1>
        {global && (
          <LocaleLink href="/admin/teams" className="text-muted-foreground text-sm hover:underline">
            Teams
          </LocaleLink>
        )}
        <LocaleLink href="/admin/release" className="text-muted-foreground ml-4 text-sm hover:underline">
          Release
        </LocaleLink>
        <p className="text-muted-foreground mt-1 mb-5 text-sm">
          {global ? (
            <>
              Everyone who registers starts as a member. What somebody may do beyond reading is
              granted one language at a time, English included; an admin may do everything
              everywhere. Regenerating spends credits from the person&apos;s own ElevenLabs or
              fish.audio account, so a grant is only half of it — the key is theirs, set on
              their profile.
            </>
          ) : (
            <>
              Who works on {administered.map(langName).join(", ")}. You may let somebody edit or
              regenerate there; they need to have registered first.
            </>
          )}
        </p>
      </Contained>
      <Wide>
        <UserSearch q={q} sort={sort} />
        <UserTable
          // Remounted per page, search and sort: the table keeps what it was given in state.
          key={`${page}:${q}:${sort.column}:${sort.direction}`}
          users={users}
          grants={grants}
          viewer={viewer}
          currentUserId={session.user.id}
          keyedUserIds={keyed}
          q={q}
          sort={sort}
          page={global ? { page, pageCount: Math.ceil(total / PAGE_SIZE) } : null}
        />
      </Wide>
      <Contained>
        {languages && (
          <>
            <h2 className="mt-10 text-lg font-semibold">Languages</h2>
            <p className="text-muted-foreground mt-1 mb-4 text-sm">
              A language switched on appears in everyone&apos;s header. One that is off can still
              be opened by an admin at its address, to prepare it before anybody else sees it.
            </p>
            <LanguageTable
              initial={languages.map((state) => ({ ...state, name: langName(state.code) }))}
            />
          </>
        )}
      </Contained>
    </main>
  );
}
