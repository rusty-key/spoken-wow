-- Additive. A token may carry `generate`, the right to queue regeneration on its owner's key.
-- Existing tokens default to false, so none gains spending power. `access` gains 'none' for a
-- generate-only token; the second check keeps a token from having no scope at all.

alter table "api_token" add column "generate" boolean not null default false;

alter table "api_token" drop constraint "api_token_access_check";
alter table "api_token" add constraint "api_token_access_check" check ("access" in ('none', 'read', 'write'));
alter table "api_token" add constraint "api_token_has_scope" check ("access" <> 'none' or "generate");
