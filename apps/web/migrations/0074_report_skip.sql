-- Reports a triager put aside in the sorting queue (/reports/sort), per person.
--
-- Per report rather than per line: a line stays out of someone's queue only while every open
-- report on it is one they skipped, so a new report brings the line back without anybody
-- resetting anything. In the database rather than the browser so a skip on the phone also
-- holds at the desk.
create table "report_skip" (
  "userId"    text        not null references "user" ("id") on delete cascade,
  "reportId"  bigint      not null references "report" ("id") on delete cascade,
  "createdAt" timestamptz not null default now(),
  primary key ("userId", "reportId")
);
