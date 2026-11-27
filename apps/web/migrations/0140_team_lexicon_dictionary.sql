-- Each team of a language keeps its own lexicon, so an account's copy of it is the team's too.
-- Keyed by language alone, a second team's save updated the first team's dictionary, and for
-- English the one ../wow-lore pins.
--
-- Additive: the previous release keeps reading and writing lexicon_account_dictionary. Its rows
-- start each language's plain team here; a copy another team made re-uploads once, as its digest
-- no longer matches.
create table "team_lexicon_dictionary" (
  "teamId"       uuid        not null default spoken_team() references "team" ("id"),
  "lang"         text        not null,
  "account"      text        not null,
  "dictionaryId" text        not null,
  "versionId"    text        not null,
  "syncedDigest" text        not null,
  primary key ("teamId", "lang", "account")
);

alter table "team_lexicon_dictionary" enable row level security;
alter table "team_lexicon_dictionary" force row level security;
create policy "team_isolation" on "team_lexicon_dictionary"
  using ("teamId" = spoken_team() or spoken_all_teams())
  with check ("teamId" = spoken_team() or spoken_all_teams());

insert into "team_lexicon_dictionary" ("teamId", "lang", "account", "dictionaryId", "versionId", "syncedDigest")
select tl."teamId", d."lang", d."account", d."dictionaryId", d."versionId", d."syncedDigest"
  from "lexicon_account_dictionary" d
  join "team_language" tl on tl."lang" = d."lang" and tl."packName" = 'plain';
