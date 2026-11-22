-- Puts $N, $C and $R back into English quest text that holds "Adventurer"/"Traveler" in their
-- place, so a change of English's player words reaches it.
--
-- Only rows whose text is exactly what the extract's old table made of their originalText: any
-- other text was edited by someone and stays. Every version, so one made current again keeps its
-- tokens. The new text is spoken identically, so no take goes stale; a doubled `$$` is not, so a
-- row holding one stays.
--
-- The steps must match tts_cli/tts_utils.py preprocess_dataframe in order: $B, token words, the
-- `<…> ` strip, then the reader's side of each $G. Re-runnable: a rewritten row no longer matches.
--
-- An override records the hash of the text it was written over, and is flagged as drifted when the
-- line's text moves, so the hash of each rewritten line's override moves with it.

with "cleaned" as (
  select q."id", q."text", q."playerGender",
         regexp_replace(q."originalText", '\$[bB]', E'\n', 'g') as "written"
    from "quest_line" q
   where q."lang" = 'enUS' and q."originalText" ~ '\$[NnCcRr]' and q."originalText" !~ '\$\$'
), "forms" as (
  select "id", "text", "playerGender", "written" as "form", false as "baked" from "cleaned"
  union all
  select "id", "text", "playerGender",
         regexp_replace(regexp_replace(regexp_replace(regexp_replace("written",
           '\$[nc]', 'adventurer', 'g'), '\$[NC]', 'Adventurer', 'g'),
           '\$r', 'traveler', 'g'), '\$R', 'Traveler', 'g'),
         true
    from "cleaned"
), "said" as (
  select "id", "text", "baked",
         case "playerGender"
           when 'm' then regexp_replace(s."stripped", '\$[Gg]\s*([^:;]+?)\s*:\s*([^:;]+?)\s*;', '\1', 'g')
           when 'f' then regexp_replace(s."stripped", '\$[Gg]\s*([^:;]+?)\s*:\s*([^:;]+?)\s*;', '\2', 'g')
           else s."stripped"
         end as "form"
    from "forms" f
    cross join lateral (select regexp_replace(f."form", '<[^\n]*?>\s', '', 'g') as "stripped") s
), "rewrite" as (
  select k."id", k."text" as "old", k."form" as "text"
    from "said" k
    join "said" b on b."id" = k."id" and b."baked"
   where not k."baked" and b."form" = k."text" and k."form" <> k."text"
), "rewritten" as (
  update "quest_line" q
     set "text" = r."text"
    from "rewrite" r
   where q."id" = r."id"
  returning q."lineId", q."isCurrent", r."old", r."text"
)
update "line_override" o
   set "originalHash" = encode(sha256(convert_to(l."text", 'UTF8')), 'hex')
  from "rewritten" l
 where l."isCurrent" and o."lang" = 'enUS' and o."lineId" = l."lineId"
   and o."originalHash" = encode(sha256(convert_to(l."old", 'UTF8')), 'hex');
