-- Text maintainers and the team's `edit` come apart. language_grant keeps storing `edit`, read as
-- the capability `text`, since the previous release reads `edit` there and rollback must keep
-- working. team_member gains the team-level `edit`.
--
-- Nobody loses anything: an `edit` holder keeps both meanings, and a team admin, who no longer
-- implies `text`, is appointed. The audio rows 0091 left in language_grant go: no release reads them.

-- migrate.sh runs psql at warning level; the row counts below are notices.
set local client_min_messages = notice;

alter table "team_member" drop constraint "team_member_capability_check";
alter table "team_member" add constraint "team_member_capability_check"
  check ("capability" in ('edit', 'regenerate', 'configure', 'ignore', 'admin', 'record'));

-- A function so the test can run the backfill on rows it seeded.
create function "grant_text_maintainers"() returns void
language plpgsql as $$
declare
  v_members     integer;
  v_maintainers integer;
  v_stranded    integer;
begin
  insert into "team_member" ("teamId", "userId", "lang", "capability", "grantedAt", "grantedBy")
  select team_of_lang(g."lang"), g."userId", g."lang", 'edit', g."grantedAt", g."grantedBy"
    from "language_grant" g
   where g."capability" = 'edit' and team_of_lang(g."lang") is not null
  on conflict do nothing;
  get diagnostics v_members = row_count;

  select count(*) into v_stranded
    from "language_grant" g
   where g."capability" = 'edit' and team_of_lang(g."lang") is null;

  insert into "language_grant" ("userId", "lang", "capability", "grantedBy")
  select distinct m."userId", m."lang", 'edit', null::text
    from "team_member" m
   where m."capability" = 'admin'
  on conflict do nothing;
  get diagnostics v_maintainers = row_count;

  raise notice 'grant_text_maintainers: % team edit rows, % admins appointed, % edit grants in a language with no team',
    v_members, v_maintainers, v_stranded;
end
$$;

do $$
declare
  v_deleted integer;
begin
  perform grant_text_maintainers();
  delete from "language_grant" where "capability" <> 'edit';
  get diagnostics v_deleted = row_count;
  raise notice '0092: % audio rows deleted from language_grant', v_deleted;
end
$$;

alter table "language_grant" drop constraint "language_grant_capability_check";
alter table "language_grant" add constraint "language_grant_capability_check"
  check ("capability" = 'edit');
