-- Each team of a language keeps its own lexicon, so an account's copy of it is the team's too.
-- Keyed by language alone, one team's save would update another's dictionary: for English, the
-- one ../wow-lore pins.
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
select team_of_lang(d."lang"), d."lang", d."account", d."dictionaryId", d."versionId", d."syncedDigest"
  from "lexicon_account_dictionary" d
 where team_of_lang(d."lang") is not null;
