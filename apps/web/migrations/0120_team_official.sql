-- Whether a team is official: an official team's releases need no review, and its packs carry no
-- team label in the Manager (docs/platform/TEAMS.md, *Releases*). Additive.
--
-- A team an approved request made is not official; every other team that exists now was made by
-- a site owner, so it is. From here on a site owner's New team form and a language a site owner
-- adds make official teams, an approved request makes one that is not, and only a site owner
-- changes it on /admin/teams.
alter table "team" add column if not exists "official" boolean not null default false;
update "team" t set "official" = not exists (
  select 1 from "team_request" r where r."approvedTeamId" = t."id" and r."state" = 'approved'
);
