-- Progress text is voiced now.
--
-- Until this, every quest line whose source is 'progress' was stored as unvoiceable with
-- skipReason 'progress' - a policy, not a defect in the text - and the generator, the explorer
-- and the voice counts all read that flag. The policy is dropped: those lines are generated
-- like any other, and whether a pack ships them is a separate decision made later.
--
-- A progress line is left unvoiceable only for the reason any other line would be: its text
-- holds $ < or >. That is tts_cli/corpus.py's _skip_reason, applied to the stored text. The
-- site re-decides invalid-chars from the text it would send (lib/text-gate.ts), so a stricter
-- flag here costs nothing but a count.
--
-- Every version is rewritten, not only the current one: an older version made current again
-- should not bring the policy back with it. Re-runnable, and forward-only per
-- deploy/web/bin/migrate.sh: the previous release reads skipReason 'progress' as its only
-- signal, so under this schema it voices these lines too.

update "quest_line"
   set "skipReason"  = case when "text" ~ '[$<>]' then 'invalid-chars' end,
       "generatable" = "text" !~ '[$<>]'
 where "skipReason" = 'progress';
