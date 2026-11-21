-- A report a triager has set aside: real, but not worth anyone's attention right now.
--
-- A status rather than a skip (0074): a skip is one person's and comes back with the next
-- report, where this is everyone's answer and holds until someone reopens or resolves it.
-- Not 'open', so the open counts, the explorer's badge and the sorting queue leave it out
-- without any of them learning a new word.
alter table "report" drop constraint "report_status_check";
alter table "report" add constraint "report_status_check"
  check ("status" in ('open', 'minor', 'fixed', 'not_an_issue'));
