-- Any team can be deleted (docs/platform/TEAMS.md, *Deleting a team*). Deleting is a job: its
-- packs are delisted through the release queue first, then its rows go (lib/teams/delete.ts).
-- Additive: a release before this one never sets "deletingAt", and reads past it.

-- When the deletion started, or its last Retry; null for a team that is not being deleted. The
-- delist runs that belong to it are the team's created since.
alter table "team" add column "deletingAt" timestamptz;
-- Why the deletion stopped: a delist that failed, or the delete itself. Cleared by a Retry.
alter table "team" add column "deleteError" text;

-- A deleted team's text reports move to another team of the language, else wait on the language's
-- text queue under no team. RLS keeps a row with no team from every team but ALL_TEAMS, which is
-- what the report reads act as.
alter table "report" alter column "teamId" drop not null;
-- Its voice reports are about takes that go with it, so they close and keep no team. No team reads
-- an open voice report with none.
alter table "report" add constraint "report_team_or_text" check ("teamId" is not null or "queue" = 'text' or "status" <> 'open');

-- While a team is being deleted it makes nothing: a take, a recording or a generation job landing
-- after its rows were counted would block the delete, a member added would be granted into a
-- team about to go, and a release would put a pack back on the channel after its delisting.
-- Raises SPTD1 when `p_team` is being deleted. Locked: a deletion starting holds the row, so this
-- waits for its commit and sees it.
create function "team_check_not_deleting"(p_team uuid) returns void
language plpgsql as $$
declare
  slug text;
  deleting timestamptz;
begin
  select t."slug", t."deletingAt" into slug, deleting from "team" t where t."id" = p_team for key share;
  if deleting is not null then
    raise exception '% is being deleted', slug using errcode = 'SPTD1';
  end if;
end
$$;

create function "team_not_deleting"() returns trigger
language plpgsql as $$
begin
  perform "team_check_not_deleting"(new."teamId");
  return new;
end
$$;

-- An invite into it could only be refused when accepted.
create function "invite_team_not_deleting"() returns trigger
language plpgsql as $$
begin
  perform "team_check_not_deleting"(new."joinTeamId");
  return new;
end
$$;

create trigger "invite_team_not_deleting" before insert on "invite"
  for each row execute function "invite_team_not_deleting"();

create trigger "take_team_not_deleting" before insert on "take"
  for each row execute function "team_not_deleting"();
create trigger "recording_team_not_deleting" before insert on "recording"
  for each row execute function "team_not_deleting"();
create trigger "regeneration_batch_team_not_deleting" before insert on "regeneration_batch"
  for each row execute function "team_not_deleting"();
create trigger "regeneration_job_team_not_deleting" before insert on "regeneration_job"
  for each row execute function "team_not_deleting"();
create trigger "team_member_team_not_deleting" before insert on "team_member"
  for each row execute function "team_not_deleting"();
create trigger "team_language_team_not_deleting" before insert on "team_language"
  for each row execute function "team_not_deleting"();
-- A delisting is how the deletion takes its packs off the channel.
create trigger "release_run_team_not_deleting" before insert on "release_run"
  for each row when (new."kind" <> 'delist') execute function "team_not_deleting"();
