-- ElevenLabs refuses a request naming a dictionary the key's account cannot read, so each
-- account holds its own copy of a language's lexicon. No team and no row level security: the
-- dictionary belongs to the account, whichever team owns the language.
--
-- "account" is the SHA-256 of the key, because the generation path holds only the key. A rotated
-- key looks like a new account.
create table "lexicon_account_dictionary" (
  "lang"         text        not null,
  "account"      text        not null,
  "dictionaryId" text        not null,
  "versionId"    text        not null,
  "syncedDigest" text        not null,
  primary key ("lang", "account")
);
