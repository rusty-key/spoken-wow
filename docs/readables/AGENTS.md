# AGENTS.md: Readables

The root `AGENTS.md` applies. This file covers only the Readables section. `docs/readables/README.md`
is the detailed reference.

## Readables was books

The module is Readables wherever a player reads its name, and its folder is `Spoken_Readables`.
Everything else was keyed books until 2026-10 and says readables now, but the line ids, which are
frozen. The old names players already have are still read (the README lists them): a renamed saved
variable, pack folder or address has to read the old one too, or players lose their settings, packs
or links.

## The table is the corpus; the Lua is an export of it

`book_page` and `book_line` are what the site reads and what an editor changes.
`addons/Spoken_Readables/Data/Books.lua` is generated from them and committed, so the addon builds
on a clone with no Postgres. Nothing on the site may read that file, because it shows the last
export rather than the table. Building the sound pack does need the database (`readables-lookup` reads `DATABASE_URL`).

## A page exists in any language

`book_page` holds a page's structure, once: its book, its number and what opens it. `book_line`
holds each language's words for it, so a page may exist in Spanish and nowhere else. Never read
a page's place from `book_line`.

A readables contribution names no page, so `apps/web/src/lib/contributions/book-match.ts` finds it:
by the item or object it was read from, then the same words in any language, then the title and
page number. Two candidates are never guessed between; a moderator picks. A page nothing in the
corpus has is minted on accept as `b:n{uuid}`, in a minted `n{uuid}` book when it starts one,
and the import folds it into the real page if the world database turns out to have it
(`pipelines/readables/tools/lib/absorb.mjs`).

## The extract must respect `patch`

`gameobject_template` and `item_template` hold one row per content patch, and the server serves
`max(patch)` at or below its own (`pipelines/readables/tools/lib/world.mjs`). A query without that
window returns an object under every name it ever had. `page_text` has no patch column.

## The checksum constants are load-bearing

`pageChecksum` in `pipelines/readables/tools/lib/naming.mjs` is recomputed by the addon in Lua
(`addons/Spoken_Readables/Checksum.lua`) over UTF-8 bytes, using only multiply, add and modulo.
Changing `CHECKSUM_MODULUS` or `CHECKSUM_FACTOR` means re-exporting the data module, whose lookup
tables are keyed on the result. A title and a page number do not identify a page: two different
objects are both named "A Dusty Tome". The reader's title fallback (`TitlePageOf`) also needs
most of the words to match, so never relax it to title and number alone.

## One page is one entry

A page belongs to exactly one book. Where two chains reach the same page, the chain with the
lower first page keeps it. Chains are walked in sorted order, so the choice comes from the data
and not from MySQL's row order.

## Mail is not a book

`ItemTextFrame` also shows mail. A letter with a creator, or the frame opened under `MailFrame`,
is skipped. Otherwise Spoken would read the player's own post aloud.

## Packs

`make readables-full-release` chains sync, pull-live and package-audio, then asks once before
uploading. `package-audio` runs `check-synced`, `sounds` and `lookup` itself.
`addons/SpokenReadablesAudio/Data/Sounds.lua` is regenerated locally and committed. The site no
longer writes it.
