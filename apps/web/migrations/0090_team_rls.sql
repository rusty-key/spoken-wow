-- Row-level security: a per-team row is visible and writable only to its own team. withTeam
-- (lib/db.ts) sets the transaction-local `spoken.team` to a team's id, or '*' (ALL_TEAMS) for
-- system work across teams, so a query that missed its team finds nothing.
--
-- THE APP ROLE. Owners bypass row-level security, so the app connects as `spoken_app`, which
-- owns no table. Migrations, backups, pack builds and the pipelines keep the owner and filter
-- per-team rows by the language's privileged team.
--
-- FORCE binds the owner too unless it bypasses by attribute, as a superuser does. Production's
-- `spoken` is given BYPASSRLS beforehand (deploy/web/README.md, "Teams, deploy 2"): without it
-- the pack builds would read no take and ship silence, so this refuses to run instead.
--
-- Creating the role needs CREATEROLE, which `spoken` lacks; on the droplet `postgres` makes it
-- beforehand, and this creates it only where it can.
--
-- NOT ADDITIVE: deploy 1's code writes activity outside withTeam and writes against keys 0089
-- dropped, so it cannot run here. Rolling back across deploy 2 is unsupported; fix forward.

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

-- A row is its team's, or every team's under ALL_TEAMS.
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

-- A site-wide ignore or event (no team) is everyone's to read. Writing one is left to
-- ALL_TEAMS by the policy above, since no one team speaks for every language.
create policy "site_wide" on "line_ignore" for select using ("teamId" is null);
create policy "site_wide" on "activity" for select using ("teamId" is null);

-- A language's live takes. The policy's "teamId" test is an OR the planner cannot match to the
-- team-first index, so without this the read scans every version (49 ms against 6 ms for deDE)
-- and the owner the whole table. Not unique: the team-first index is the key.
create index "take_live_idx" on "take" ("source", "lang", "file") where "isCurrent";
