-- Which pages exist, where each sits, and what opens it -- the same in every language.
--
-- book_line holds each language's words for a page; book_page is the page's structure, once
-- per page, so a page exists in any language whether English has it or not.
--
-- "lineId" is 'b:{pageTextID}' for a page the world database has, or 'b:n{uuid}' for one a
-- player's client showed and nothing else names. "bookId" is text for the same reason: the
-- first page's pageTextID, or 'n{uuid}'. A book's page count is the count of its pages, so it
-- is not stored.
--
-- "aliasOf" is set on a minted page later found in the world database: everything moved to the
-- real page, and the minted id is kept so a pack that shipped it still plays.
--
-- Additive: book_line keeps its structure columns, written as before, for the previous release
-- to read.

create table "book_page" (
  "lineId"     text primary key,
  "pageTextId" integer,
  "bookId"     text    not null,
  "pageNumber" integer not null,
  "ownerKind"  text    check ("ownerKind" in ('object', 'item')),
  "ownerIds"   integer[],
  "material"   integer,
  "aliasOf"    text    references "book_page" ("lineId"),
  "createdAt"  timestamptz not null default now()
);

-- One live page per place in a book. Deferred, so a re-extract that swaps two pages of one book
-- writes both before it is checked.
alter table "book_page" add constraint "book_page_place"
  exclude using btree ("bookId" with =, "pageNumber" with =) where ("aliasOf" is null)
  deferrable initially deferred;
create index "book_page_owner" on "book_page" using gin ("ownerIds");

-- Every page book_line has, placed as its English row places it, or failing that its
-- lowest-language current row.
insert into "book_page" ("lineId", "pageTextId", "bookId", "pageNumber", "ownerKind", "ownerIds", "material")
select distinct on ("lineId")
       "lineId", "pageId", "bookId"::text, "pageNumber", "ownerKind", "ownerIds", "material"
  from "book_line"
 where "isCurrent"
 order by "lineId", ("lang" = 'enUS') desc, "lang";

-- A moderator's answer to "which page is this?", replacing "pageId": a page in any language, a
-- place in a book, or a new book. All null and false when nobody has answered.
alter table "contribution" add column if not exists "matchLineId" text;
alter table "contribution" add column if not exists "matchBookId" text;
alter table "contribution" add column if not exists "matchPageNumber" integer;
alter table "contribution" add column if not exists "matchNewBook" boolean not null default false;

update "contribution" set "matchLineId" = 'b:' || "pageId"
 where "pageId" is not null and "matchLineId" is null;
