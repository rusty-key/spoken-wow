-- The language axis, laid under the tables that did not have one.
--
-- The site is about to serve more than English, switched as a whole by a language in the
-- URL. Most of what a language owns already carries `lang` -- take, report, lore_line,
-- book_line, quest_line, quest_line_speaker, line_flag -- and every read pins it to enUS. What
-- does not carry it is the machinery around a take: the queue that produces one, the ack
-- that clears one, the lexicon log that dirties one, the issue scan that reads the text,
-- and the record of the voice clone that speaks it. Each of those would let a Portuguese
-- take and an English take of the same file block, clear or dirty each other.
--
-- Default 'enUS' everywhere, so every existing row is correct without a backfill: nothing
-- but English has ever been queued, acked, logged or scanned.
--
-- WIDENED IN TWO RELEASES, NOT ONE. deploy/web/bin/migrate.sh requires a release to run
-- against the schema of the release after it, and the previous release names its conflict
-- targets -- `on conflict ("source", "file")` in queue.ts and dirty.ts. Dropping the old
-- unique index here would make that release's enqueue fail with "no unique or exclusion
-- constraint matching", so the wider index is added beside it and this release's code moves
-- onto it. The old ones are dropped in a later migration, once no running release names
-- them -- and before the first non-English write, which the old index would refuse.

-- Which languages the site serves. The closed set of codes lives in code
-- (pipelines/lib/locales.mjs, mirrored by apps/web/src/lib/lang.ts) because the proxy has to
-- validate a URL prefix without a database round trip; what lives here is whether a language
-- is switched on, which an admin decides at runtime rather than by deploying.
create table "language" (
  "code"      text        primary key check ("code" ~ '^[a-z]{2}[A-Z]{2}$'),
  "enabled"   boolean     not null default false,
  "updatedAt" timestamptz not null default now(),
  "updatedBy" text references "user" ("id") on delete set null
);

insert into "language" ("code", "enabled") values ('enUS', true);

alter table "regeneration_batch" add column "lang" text not null default 'enUS';
alter table "regeneration_job"   add column "lang" text not null default 'enUS';

-- The credit guard, per language: a Portuguese take of gossip/31ab….mp3 is a different
-- recording from the English one, and queueing both is two jobs, not a duplicate.
create unique index "regeneration_job_one_per_lang_file"
  on "regeneration_job" ("source", "lang", "file")
  where "state" in ('pending', 'running');

-- Clearing an English take says nothing about the Portuguese one.
alter table "take_ack" add column "lang" text not null default 'enUS';
create unique index "take_ack_lang_idx" on "take_ack" ("source", "lang", "file");

-- A voice slot -- dwarf-male-grim -- is the same slot in every language, but the clone
-- behind it is not: a language's clones are made from that language's own clips and are
-- that language's alone.
alter table "voice_clone" add column "lang" text not null default 'enUS';
create unique index "voice_clone_lang_idx" on "voice_clone" ("voice", "lang");

-- A lexicon edit dirties takes in the lexicon's own language only.
alter table "lexicon_change" add column "lang" text not null default 'enUS';

-- An issue is found in one language's text: the same word flagged in English and German is
-- two findings.
alter table "line_issue" add column "lang" text not null default 'enUS';
create unique index "line_issue_lang_idx" on "line_issue" ("category", "item", "lang");
