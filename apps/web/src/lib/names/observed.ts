/**
 * A name is offered where it differs from the language's current name, which is what the
 * giver-name export ships to the addon.
 */
import "server-only";

import type { Sighting } from "@/lib/contributions/sighting";
import { recordActivity } from "@/lib/activity/store";
import { query } from "@/lib/db";
import type { ContributionStatus } from "@/lib/contributions/contributions";
import { BASE_LANG, clientLang, isClientLang, type Lang } from "@/lib/lang";
import { withTextTeam } from "@/lib/teams/store";

export type ObservedKind = Sighting["npcType"];

/** English has no names to review: its names are the corpus's. Nor does a language no client runs in. */
export function hasObservedNames(lang: Lang): boolean {
  return lang !== BASE_LANG && isClientLang(lang);
}

/** `lang` is an SQL expression, so the English and the row's own language share one lookup. */
function currentNameSql(alias: string, lang = `${alias}."lang"`): string {
  return `(select e."name" from "entity_name" e
            where e."kind" = ${alias}."kind" and e."entityId" = ${alias}."entityId"
              and e."lang" = ${lang} and e."isCurrent")`;
}

/**
 * Offers every name a sighting carries that differs from the current one, under `uploader`.
 * English is left out: its names are the corpus's. So is an NPC with no English name, which
 * nothing on the site lists. Returns how many names this uploader newly vouched for.
 */
export async function recordObservedNames(sightings: readonly Sighting[], uploader: string): Promise<number> {
  const seen = new Map<string, { kind: ObservedKind; entityId: string; lang: Lang; name: string }>();
  for (const sighting of sightings) {
    const lang = sighting.locale ? clientLang(sighting.locale) : null;
    if (!lang || lang === BASE_LANG || !sighting.name) continue;
    const row = { kind: sighting.npcType, entityId: String(sighting.npcId), lang, name: sighting.name };
    seen.set(JSON.stringify(row), row);
  }
  if (seen.size === 0) return 0;
  const rows = [...seen.values()];
  const vouched = await query<{ contributionId: number }>(
    `with sent as (
       select * from unnest($1::text[], $2::text[], $3::text[], $4::text[]) as s ("kind", "entityId", "lang", "name")
     ), offered as (
       select s.* from sent s
        where ${currentNameSql("s", `'${BASE_LANG}'`)} is not null
          and ${currentNameSql("s")} is distinct from s."name"
     ), saved as (
       insert into "name_contribution" ("kind", "entityId", "lang", "name")
       select "kind", "entityId", "lang", "name" from offered
       on conflict ("kind", "entityId", "lang", "name") do update set "updatedAt" = now()
       returning "id"
     )
     insert into "name_contribution_uploader" ("contributionId", "uploader")
     select "id", $5 from saved
     on conflict do nothing
     returning "contributionId"`,
    [rows.map((r) => r.kind), rows.map((r) => r.entityId), rows.map((r) => r.lang), rows.map((r) => r.name), uploader],
  );
  return vouched.length;
}

export type NameContribution = {
  id: number;
  kind: ObservedKind;
  entityId: string;
  name: string;
  status: ContributionStatus;
  /** How many uploaders sent it: accounts, Manager installs, or anonymous files. */
  uploaders: number;
  english: string | null;
  /** The language's current name; null where it has none and the addon shows the English. */
  currentName: string | null;
  updatedAt: string;
};

type Row = Omit<NameContribution, "updatedAt"> & { updatedAt: Date };

/**
 * A language's names of one status, most vouched for first. New ones the current name already
 * matches, because an edit, an import or another kept name caught up, are left out.
 */
export async function listObservedNames(lang: Lang, status: ContributionStatus): Promise<NameContribution[]> {
  const rows = await query<Row>(
    `select c."id", c."kind", c."entityId", c."name", c."status", c."updatedAt",
            (select count(*) from "name_contribution_uploader" u where u."contributionId" = c."id")::int as "uploaders",
            ${currentNameSql("c", `'${BASE_LANG}'`)} as "english",
            ${currentNameSql("c")} as "currentName"
       from "name_contribution" c
      where c."lang" = $1 and c."status" = $2
        and (c."status" <> 'new' or ${currentNameSql("c")} is distinct from c."name")
      order by "uploaders" desc, c."updatedAt" desc`,
    [lang, status],
  );
  return rows.map((row) => ({ ...row, updatedAt: row.updatedAt.toISOString() }));
}

export async function countObservedNames(lang: Lang): Promise<number> {
  const rows = await query<{ count: number }>(
    `select count(*)::int as "count" from "name_contribution" c
      where c."lang" = $1 and c."status" = 'new' and ${currentNameSql("c")} is distinct from c."name"`,
    [lang],
  );
  return rows[0]?.count ?? 0;
}

/** Read before anything else, so the permission is checked before a missing id is reported. */
export async function observedNameLang(id: number): Promise<string | null> {
  const rows = await query<{ lang: string }>(`select "lang" from "name_contribution" where "id" = $1`, [id]);
  return rows[0]?.lang ?? null;
}

export type ResolveOutcome = { ok: true } | { ok: false; reason: "not-found" };

/** Kept, the name becomes the language's current one. */
export async function acceptObservedName(id: number, lang: Lang, userId: string): Promise<ResolveOutcome> {
  return withTextTeam(lang, async (client, team) => {
    const { rows } = await client.query<{ kind: ObservedKind; entityId: string; name: string }>(
      `select "kind", "entityId", "name" from "name_contribution"
        where "id" = $1 and "lang" = $2 and "status" = 'new' for update`,
      [id, lang],
    );
    const found = rows[0];
    if (!found) return { ok: false, reason: "not-found" };
    // An NPC with no name in the language yet has no row to lock, and two names kept at once
    // would both take the next version.
    await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [
      `entity_name:${found.kind}:${found.entityId}:${lang}`,
    ]);
    await client.query(
      `update "entity_name" set "isCurrent" = false
        where "kind" = $1 and "entityId" = $2 and "lang" = $3 and "isCurrent"`,
      [found.kind, found.entityId, lang],
    );
    const { rows: written } = await client.query<{ version: number }>(
      `insert into "entity_name"
         ("kind", "entityId", "lang", "version", "isCurrent", "origin", "name", "editedBy", "note")
       select $1, $2, $3, coalesce(max("version"), 0) + 1, true, 'observed', $4, $5, $6
         from "entity_name" where "kind" = $1 and "entityId" = $2 and "lang" = $3
       returning "version"`,
      [found.kind, found.entityId, lang, found.name, userId, `name contribution #${id}`],
    );
    await client.query(
      `update "name_contribution" set "status" = 'accepted', "resolvedBy" = $2, "updatedAt" = now() where "id" = $1`,
      [id, userId],
    );
    await recordActivity(
      {
        team,
        kind: "name.observed",
        lang,
        actorId: userId,
        subject: `${found.kind}:${found.entityId}`,
        detail: { version: written[0].version, name: found.name, contribution: id },
      },
      client,
    );
    return { ok: true };
  });
}

/** The same name sent again only counts another uploader, so a dropped name stays dropped. */
export async function rejectObservedName(id: number, lang: Lang, userId: string): Promise<ResolveOutcome> {
  return withTextTeam(lang, async (client, team) => {
    const { rows } = await client.query<{ kind: ObservedKind; entityId: string; name: string }>(
      `update "name_contribution" set "status" = 'rejected', "resolvedBy" = $3, "updatedAt" = now()
        where "id" = $1 and "lang" = $2
       returning "kind", "entityId", "name"`,
      [id, lang, userId],
    );
    const found = rows[0];
    if (!found) return { ok: false, reason: "not-found" };
    await recordActivity(
      {
        team,
        kind: "contribution.resolved",
        lang,
        actorId: userId,
        subject: `name:${found.kind}:${found.entityId}`,
        detail: { status: "rejected", key: found.name },
      },
      client,
    );
    return { ok: true };
  });
}

/** Only a dropped name reopens: a kept one is already written to entity_name. */
export async function reopenObservedName(id: number, lang: Lang): Promise<ResolveOutcome> {
  const rows = await query<{ id: number }>(
    `update "name_contribution" set "status" = 'new', "resolvedBy" = null, "updatedAt" = now()
      where "id" = $1 and "lang" = $2 and "status" = 'rejected'
     returning "id"`,
    [id, lang],
  );
  return rows[0] ? { ok: true } : { ok: false, reason: "not-found" };
}
