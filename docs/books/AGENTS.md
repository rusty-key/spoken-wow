# AGENTS.md: books

The root `AGENTS.md` applies. This file covers only the books section. `docs/books/README.md`
is the detailed reference.

## The table is the corpus; the Lua is an export of it

`book_line` is what the site reads and what an editor changes. `addons/Spoken_Books/Data/Books.lua`
is generated from it and committed, so the addon builds on a clone with no Postgres. Nothing on
the site may read that file, because it shows the last export rather than the table. Building
the sound pack does need the database (`books-lookup` reads `DATABASE_URL`).

## The extract must respect `patch`

`gameobject_template` and `item_template` hold one row per content patch, and the server serves
`max(patch)` at or below its own (`pipelines/books/tools/lib/world.mjs`). A query without that
window returns an object under every name it ever had. `page_text` has no patch column.

## The checksum constants are load-bearing

`pageChecksum` in `pipelines/books/tools/lib/naming.mjs` is recomputed by the addon in Lua
(`addons/Spoken_Books/Checksum.lua`) over UTF-8 bytes, using only multiply, add and modulo.
Changing `CHECKSUM_MODULUS` or `CHECKSUM_FACTOR` means re-exporting the data module, whose lookup
tables are keyed on the result. A title and a page number do not identify a page: two different
objects are both named "A Dusty Tome".

## One page is one entry

A page belongs to exactly one book. Where two chains reach the same page, the chain with the
lower first page keeps it. Chains are walked in sorted order, so the choice comes from the data
and not from MySQL's row order.

## Mail is not a book

`ItemTextFrame` also shows mail. A letter with a creator, or the frame opened under `MailFrame`,
is skipped. Otherwise Spoken would read the player's own post aloud.

## Packs

`make books-full-release` chains sync, pull-live and package-audio, then asks once before
uploading. `package-audio` runs `check-synced`, `sounds` and `lookup` itself.
`addons/SpokenBooksAudio/Data/Sounds.lua` is regenerated locally and committed. The site no
longer writes it.
