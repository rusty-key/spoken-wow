-- Another team's live takes, and the override text they speak, readable by anyone.
--
-- A live take is public across teams; the rest of a team's rows are its own. Row-level security
-- hides every row of another team, and loosening a per-team policy would open its history with
-- its live rows (TEAMS.md, "Isolation with row-level security"). So the read goes through these
-- two functions instead: security definer, owned by the migration role, which bypasses
-- row-level security (0090), and executable by the app role only. Each answers nothing for a
-- team that does not voice the language.
--
-- team_live_takes returns what plays a take and dates it: the line, file, version, spoken hash,
-- characters, duration, size and date, plus the archive location and checksum the server needs
-- to serve its bytes (never sent to a browser). It leaves out credits, cost, model, voice,
-- provider, settings, author and older versions, which would reveal how the team works and
-- what it spent.
--
-- team_live_overrides returns an override's key and text, only for a line with a live take made
-- at or after the override's last save: that take speaks those words. An override with no such
-- take is still in progress, and stays private as other unfinished work does. A quest override
-- is keyed by its line's file and spoken by its voice files (`{stem}-{voice}.mp3`) too; a take
-- speaks the one override the site resolves for its file. `createdAt >= updatedAt` trusts the
-- take's insert time: a take committed after an override saved during its generation still
-- counts as speaking it.
--
-- Additive: the previous release never calls either.

create or replace function "team_live_takes"(p_team uuid, p_lang text, p_source text, p_file text default null)
returns table (
  "lineId"      text,
  "file"        text,
  "version"     integer,
  "spokenHash"  text,
  "characters"  integer,
  "durationSec" numeric,
  "bytes"       bigint,
  "createdAt"   timestamptz,
  "archiveFile" text,
  "sha256"      text
)
language sql stable security definer set search_path = public, pg_temp as $$
  select t."lineId", t."file", t."version", t."spokenHash", t."characters", t."durationSec", t."bytes",
         t."createdAt", t."archiveFile", t."sha256"
    from "take" t
   where t."teamId" = p_team and t."lang" = p_lang and t."source" = p_source and t."isCurrent"
     and (p_file is null or t."file" = p_file)
     and exists (select 1 from "team_language" l where l."teamId" = p_team and l."lang" = p_lang)
$$;

create or replace function "team_live_overrides"(p_team uuid, p_lang text, p_source text)
returns table ("key" text, "text" text)
language sql stable security definer set search_path = public, pg_temp as $$
  with "live" as (
    select t."file", t."createdAt"
      from "take" t
     where p_source = 'quests' and t."teamId" = p_team and t."lang" = p_lang and t."source" = 'quests'
       and t."isCurrent"
  ),
  "own" as (
    select o."file", o."text", o."updatedAt"
      from "line_override" o
     where p_source = 'quests' and o."teamId" = p_team and o."lang" = p_lang
  ),
  -- Each live take's override, as the site resolves a file's text: its own file's, else the
  -- shortest stem whose rest is a voice's name.
  "spoken" as (
    select distinct on (l."file") o."file", o."text", o."updatedAt", l."createdAt"
      from "live" l
      join "own" o
        on o."file" = l."file"
        or (length(o."file") > 4 and right(o."file", 4) = '.mp3'
            and left(l."file", length(o."file") - 3) = left(o."file", length(o."file") - 4) || '-'
            and substr(l."file", length(o."file") - 2) ~ '^[a-z0-9]+(-[a-z0-9]+)*\.mp3$')
     order by l."file", o."file" = l."file" desc, length(o."file")
  )
  select distinct s."file", s."text"
    from "spoken" s
   where s."createdAt" >= s."updatedAt"
     and exists (select 1 from "team_language" g where g."teamId" = p_team and g."lang" = p_lang)
  union all
  select o."lineId", o."text"
    from "text_override" o
   where p_source <> 'quests' and o."teamId" = p_team and o."lang" = p_lang and o."source" = p_source
     and exists (select 1 from "team_language" g where g."teamId" = p_team and g."lang" = p_lang)
     and exists (
       select 1 from "take" t
        where t."teamId" = p_team and t."lang" = p_lang and t."source" = p_source and t."isCurrent"
          and t."lineId" = o."lineId" and t."createdAt" >= o."updatedAt"
     )
$$;

revoke all on function "team_live_takes"(uuid, text, text, text) from public;
revoke all on function "team_live_overrides"(uuid, text, text) from public;
grant execute on function "team_live_takes"(uuid, text, text, text) to "spoken_app";
grant execute on function "team_live_overrides"(uuid, text, text) to "spoken_app";
