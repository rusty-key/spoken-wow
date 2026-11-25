-- Additive. A token may carry `packs`, the right to submit its owner's community packs. Any
-- member may submit a pack, so no language grant backs it and a packs-only token has no language.
-- Existing tokens default to false and all have a language, so none changes.

alter table "api_token" add column "packs" boolean not null default false;

alter table "api_token" alter column "lang" drop not null;
alter table "api_token" add constraint "api_token_lang_needed"
  check ("lang" is not null or ("access" = 'none' and not "generate"));

alter table "api_token" drop constraint "api_token_has_scope";
alter table "api_token" add constraint "api_token_has_scope"
  check ("access" <> 'none' or "generate" or "packs");
