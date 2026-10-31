-- Row-level security: a per-team row is visible and writable only to its own team.
--
-- Since 0088 every per-team row says which team it belongs to, and every query on one runs
-- inside withTeam (lib/db.ts), which sets the transaction-local `spoken.team` to a team's id,
-- or to '*' (ALL_TEAMS) for the system work that spans teams: the queue leader's claim, the
-- one queue panel, a site-wide ignore. Postgres now draws that line itself, so a query that
-- missed its team finds nothing rather than another team's rows.
--
-- THE APP ROLE. Owners bypass row-level security, and the app connected as `spoken`, which owns
-- every table. It connects as `spoken_app` instead: no table of its own, every row through a
-- policy. Migrations, backups, pack builds and the pipelines keep the owner, and with it every
-- team's rows; those that read per-team rows filter by the language's privileged team.
--
-- FORCE puts the owner under the policies too, unless it bypasses them by attribute (a
-- superuser does, locally and in CI). In production `spoken` is neither, so it is given
-- BYPASSRLS before this runs (deploy/web/README.md, "Teams, deploy 2"): without it every owner
-- connection -- the pack builds above all -- would read no take at all and say nothing. This
-- refuses to run rather than leave that to be found in an empty pack.
--
-- Creating the role needs CREATEROLE, which `spoken` lacks; on the droplet it is made as
-- `postgres` beforehand, and this only creates it where it can (a workstation, CI).
--
-- NOT ADDITIVE: a release that queries a per-team table outside withTeam sees no rows as
-- `spoken_app`, and one that writes there is refused. Deploy 1's code is such a release: its
-- hand-rolled transactions write activity outside withTeam, with no team. Nor can it be
-- rolled back to as the owner, as 0089 dropped the keys it writes against. Rolling back across
-- deploy 2 is unsupported; fix forward (deploy/web/README.md, "Teams, deploy 2").

do $$
begin
  if not (select "rolsuper" or "rolbypassrls" from "pg_roles" where "rolname" = current_user) then
    raise exception using
      message = format('%I must bypass row-level security before 0090 enables it', current_user),
      hint = format('as postgres: alter role %I bypassrls', current_user);
  end if;
  if not exists (select 1 from "pg_roles" where "rolname" = 'spoken_app') then
    create role "spoken_app" nologin;
  end if;
end
$$;

grant usage on schema public to "spoken_app";
grant select, insert, update, delete on all tables in schema public to "spoken_app";
grant usage on all sequences in schema public to "spoken_app";
-- For every table a later migration adds, made by whoever runs the migrations.
alter default privileges in schema public grant select, insert, update, delete on tables to "spoken_app";
alter default privileges in schema public grant usage on sequences to "spoken_app";

-- Whether this transaction acts for every team (ALL_TEAMS).
create or replace function "spoken_all_teams"() returns boolean
language sql stable as $$
  select coalesce(current_setting('spoken.team', true) = '*', false)
$$;

-- A row is its team's, or every team's under ALL_TEAMS. The same line as TEAM_ROWS in
-- lib/db.ts, whose `current_setting('spoken.team') in ('*', id)` is this read off the team
-- table, for connections the policies do not bind.
do $$
declare
  t text;
begin
  foreach t in array array[
    'take', 'recording', 'take_ack', 'voice', 'voice_assignment', 'voice_clone', 'voice_sample',
    'fish_reference', 'generation_setting', 'generation_setting_locale', 'pronunciation_lexicon',
    'pronunciation_lexicon_locale', 'lexicon_change', 'line_override', 'line_ignore', 'line_flag',
    'line_issue', 'line_issue_line', 'report', 'regeneration_batch', 'regeneration_job',
    'regeneration_pause', 'queue_dismissal', 'activity'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format(
      $f$create policy "team_isolation" on %I
           using ("teamId" = spoken_team() or spoken_all_teams())
           with check ("teamId" = spoken_team() or spoken_all_teams())$f$, t);
  end loop;
end
$$;

-- A site-wide ignore or event (no language, so no team) is everyone's to read: every
-- language's explorer honours the one and every activity page lists the other. Only reading:
-- writing, changing or deleting one is system work, left to ALL_TEAMS by the policy above,
-- since no one team speaks for every language. An event in a language nobody owns has no team
-- either, and is written the same way (activity/store.ts).
create policy "site_wide" on "line_ignore" for select using ("teamId" is null);
create policy "site_wide" on "activity" for select using ("teamId" is null);

-- A language's live takes, as liveTakes reads them (lib/takes/store.ts). 0089 dropped
-- take_current_idx, on these columns, for its team-first twin, and the policy's test of
-- "teamId" is an OR the planner cannot match to that index's leading column. Without this the
-- read takes every version of the language off take_line_idx and drops the old ones: 49 ms
-- against 6 ms for deDE on a copy of spoken_dev, and a sequential scan of the whole table for
-- the owner, whom no policy filters. Not unique: the team-first index is the key.
create index "take_live_idx" on "take" ("source", "lang", "file") where "isCurrent";
