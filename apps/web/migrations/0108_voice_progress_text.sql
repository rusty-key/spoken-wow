-- Progress lines are voiceable unless their text holds $ < or >, as any other line. The site
-- re-decides invalid-chars from the text it sends, so this flag only feeds counts.
--
-- Every version is rewritten, so an older one made current again stays voiceable.
-- Re-runnable. Forward-only: the previous release reads skipReason 'progress' as its only
-- signal, so under this schema it voices these lines too.

update "quest_line"
   set "skipReason"  = case when "text" ~ '[$<>]' then 'invalid-chars' end,
       "generatable" = "text" !~ '[$<>]'
 where "skipReason" = 'progress';
