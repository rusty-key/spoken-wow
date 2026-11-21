-- team_live_overrides matches a live take to its quest override by key, not by pairing every take
-- with every override.
--
-- 0118 joined the two on an expression Postgres can only test pair by pair, so the function's time
-- grew with live takes times overrides: 21k live takes took 3 s against 200 overrides and 16 s
-- against 1000. Every quests search by a visitor outside the language runs it, and the deploy smoke
-- check timed out on it.
--
-- Each live take now lists the override files that could resolve to it, its own file and
-- `{stem}.mp3` for each `-`, and the overrides are hash-joined on those. Nested loops are off in
-- the function: on stale statistics (an override table that grew since its last analyze) the
-- planner otherwise loops over the overrides and rebuilds every take's candidates for each, which
-- took minutes. JIT is off too: the estimate crosses its threshold, and compiling cost more than
-- the query. Which override a take speaks, and when it counts as published, is unchanged from
-- 0118.

create or replace function "team_live_overrides"(p_team uuid, p_lang text, p_source text)
returns table ("key" text, "text" text)
language sql stable security definer
set search_path = public, pg_temp
set enable_nestloop = off
set jit = off
as $$
  -- A team with no quest overrides skips reading its takes.
  with "live" as (
    select t."file", t."spokenHash"
      from "take" t
     where p_source = 'quests' and t."teamId" = p_team and t."lang" = p_lang and t."source" = 'quests'
       and t."isCurrent"
       and exists (select 1 from "line_override" o where o."teamId" = p_team and o."lang" = p_lang)
  ),
  -- The override files a live take could resolve to: its own, and the part before each `-`.
  -- Splitting on `-` touches each dash rather than each character.
  "candidate" as (
    select l."file", l."spokenHash", l."file" as "key", null::text as "rest"
      from "live" l
    union all
    select l."file", l."spokenHash", s."stem" || '.mp3', s."rest"
      from "live" l
     cross join lateral string_to_array(l."file", '-') as a("parts")
     cross join lateral generate_series(1, cardinality(a."parts") - 1) as i
     cross join lateral (
       select array_to_string(a."parts"[1:i], '-') as "stem", array_to_string(a."parts"[i + 1:], '-') as "rest"
     ) s
     where s."stem" <> ''
  ),
  -- Each live take's override, as the site resolves a file's text: its own file's, else the
  -- shortest stem whose rest is a voice's name. The voice test names the override, so it runs
  -- only on the candidates that found one.
  "spoken" as (
    select distinct on (c."file") o."file", o."text", o."spokenHashes", c."spokenHash"
      from "candidate" c
      join "line_override" o on o."teamId" = p_team and o."lang" = p_lang and o."file" = c."key"
     where o."file" = c."file" or c."rest" ~ '^[a-z0-9]+(-[a-z0-9]+)*\.mp3$'
     order by c."file", o."file" = c."file" desc, length(o."file")
  )
  select s."file", s."text"
    from "spoken" s
   where exists (select 1 from "team_language" g where g."teamId" = p_team and g."lang" = p_lang)
   group by s."file", s."text"
  having bool_and(coalesce(s."spokenHash" = any(s."spokenHashes"), false))
  union all
  select o."lineId", o."text"
    from "text_override" o
   where p_source <> 'quests' and o."teamId" = p_team and o."lang" = p_lang and o."source" = p_source
     and exists (select 1 from "team_language" g where g."teamId" = p_team and g."lang" = p_lang)
     and exists (
       select 1 from "take" t
        where t."teamId" = p_team and t."lang" = p_lang and t."source" = p_source and t."isCurrent"
          and t."lineId" = o."lineId" and t."spokenHash" = o."spokenHash"
     )
$$;
