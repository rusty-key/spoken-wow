-- A language described in the database, not only in code.
--
-- Until now `language` said only whether a code was switched on; what a language IS -- its
-- name, BCP 47 tag, the provider's language code, whether a game client runs in it -- lived in
-- pipelines/lib/locales.mjs. Teams are about to create languages at runtime, so a row has to
-- carry all of it. The thirteen languages that exist today are seeded from that list; existing
-- rows keep `enabled`, new ones start off (enUS on).
--
-- `provider` is the language_code sent to the speech provider (ISO 639-1). `client` is
-- false for a language no game client runs in.
--
-- name, native, bcp47 and provider stay NULLABLE for now: the previous release's setEnabled
-- upserts (code, enabled) only, and Postgres checks NOT NULL before conflict detection, so
-- after a rollback every toggle would fail. A later migration sets them NOT NULL once no
-- pre-0106 release runs.
--
-- The notify trigger lets a running server learn of a language added or changed by another
-- process without polling.

alter table "language"
  add column "name"      text,
  add column "native"    text,
  add column "bcp47"     text,
  add column "provider"  text check ("provider" ~ '^[a-z]{2}$'),
  add column "client"    boolean not null default false,
  add column "createdAt" timestamptz not null default now();

insert into "language" ("code", "name", "native", "bcp47", "provider", "client", "enabled") values
  ('enUS', 'English', 'English', 'en-US', 'en', true, true),
  ('deDE', 'German', 'Deutsch', 'de-DE', 'de', true, false),
  ('esES', 'Spanish (EU)', 'Español (EU)', 'es-ES', 'es', true, false),
  ('esMX', 'Spanish (AL)', 'Español (AL)', 'es-MX', 'es', true, false),
  ('frFR', 'French', 'Français', 'fr-FR', 'fr', true, false),
  ('itIT', 'Italian', 'Italiano', 'it-IT', 'it', false, false),
  ('plPL', 'Polish', 'Polski', 'pl-PL', 'pl', false, false),
  ('ptBR', 'Portuguese', 'Português', 'pt-BR', 'pt', true, false),
  ('ruRU', 'Russian', 'Русский', 'ru-RU', 'ru', true, false),
  ('koKR', 'Korean', '한국어', 'ko-KR', 'ko', true, false),
  ('zhCN', 'Chinese (S)', '简体中文', 'zh-CN', 'zh', true, false),
  ('zhTW', 'Chinese (T)', '繁體中文', 'zh-TW', 'zh', true, false),
  ('viVN', 'Vietnamese', 'Tiếng Việt', 'vi-VN', 'vi', false, false)
on conflict ("code") do update set
  "name"     = excluded."name",
  "native"   = excluded."native",
  "bcp47"    = excluded."bcp47",
  "provider" = excluded."provider",
  "client"   = excluded."client";

create function "language_notify"() returns trigger
language plpgsql as $$
begin
  perform pg_notify('spoken_language', coalesce(new."code", old."code"));
  return null;
end $$;

create trigger "language_notify"
  after insert or update or delete on "language"
  for each row execute function "language_notify"();
