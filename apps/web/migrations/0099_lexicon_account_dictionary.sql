-- Additive. The app role's grants come from default privileges. No row level security and no
-- team: a dictionary belongs to an ElevenLabs account, whichever team owns the language, and
-- a language that moves team re-uploads because its entries differ, not because of this key.
--
-- ElevenLabs refuses a request naming a dictionary the key's account cannot read, so one id per
-- language can only serve its owner. pronunciation_lexicon(_locale) still says what the editor
-- last uploaded; this says where each account holds that lexicon.
--
-- "account" is the SHA-256 of the key, because the key itself is sealed in elevenlabs_key and the
-- generation path holds only the key. A rotated key looks like a new account, and adopts or
-- creates a dictionary again.
create table "lexicon_account_dictionary" (
  "lang"         text        not null,
  "account"      text        not null,
  "dictionaryId" text        not null,
  "versionId"    text        not null,
  "syncedDigest" text        not null,
  "syncedAt"     timestamptz not null default now(),
  primary key ("lang", "account")
);
