-- Who a report waits for. The default keeps reports from before this release, and any the previous
-- release files during the deploy, with the audio team.
alter table "report" add column "queue" text not null default 'audio'
  check ("queue" in ('text', 'audio'));
