-- A team that must keep its audio in its own bucket (docs/platform/STORAGE.md). Additive. Every
-- team that exists now keeps our archive; createTeam and foundTeam set it for each team a person
-- creates from here on, and a site admin can change it on /admin/teams. Teams the system makes
-- itself (adopt_lang, giving a language with no team one) keep the default.
alter table "team" add column if not exists "ownStorage" boolean not null default false;
