# Place pictures

A place can have a picture above its story, on the map panel and in the Compendium's Places tab.
The other tabs' pages for a place have no picture: they show the faction's seal.
Only pictures chosen by hand and reviewed ship, so a place with no picture shows none.

## From the wiki to a texture

1. `node pipelines/places/tools/pictures/fetch.mjs [--refresh]` asks warcraft.wiki.gg for a picture
   for each zone and area page, preferring files the wiki marks as Classic. It writes
   `pictures/manifest.json` (page, file, licence, author) and the downloads to
   `pipelines/places/tools/cache/pictures/raw/`.
2. `node pipelines/places/tools/pictures/gallery.mjs [out]` downloads every picture on each place's
   pages into a folder per place, to choose from by eye. The one `fetch.mjs` chose is prefixed
   `[picked]`.
3. The chosen picture of each place is cleaned and sharpened with an image model
   (`Textures/Pictures/CREDITS.md` names it). That step runs outside this repository. What `prepare.py` reads is its result: in a folder laid out
   as the Places tab is (`Azeroth/<continent>/<zone>[/<area>]`), `<place> - new.png` beside the
   original, `<place> - old.<ext>`. A place with no `- new` has no picture.
4. `make places-pictures` runs `pipelines/places/tools/pictures/prepare.py`, which writes the textures,
   `Data/Pictures.lua` and `Textures/Pictures/CREDITS.md`.

```sh
make places-pictures CHOICES=<folder> ARGS="--force"
```

`prepare.py` needs Python with numpy, Pillow and scipy. `CHOICES` defaults to the script's own
default folder. The folder may hold only the places being worked on: a place it lacks keeps the
picture `Pictures.lua` gives it, and no texture is deleted. `--prune` is for a folder that holds
every place: only its places are written and the textures no place uses are deleted. `--force`
writes pictures that already exist again.

## What prepare.py does to a picture

- Crops a 2:1 banner where the picture has the most detail (edges), nudged toward the middle.
  `CROPS` in the script keeps the top or bottom of a picture by hand.
- Shrinks it to 512 by 256, tints it 12% toward the parchment it sits on (`WARMTH`,
  `PARCHMENT` 0.88, 0.68, 0.41), lays the paper's grain over it (`GRAIN` 0.08, specks of
  `GRAIN_SIZE` 1.5 pixels over a coarser mottle) and sharpens it a little.
- Fades the paint toward the parchment at the edge: the edge mask blurred by 3 pixels, 75% at the
  edge.
- Writes a DXT1 BLP with its mipmaps. The pictures are larger than the frame draws them, so the
  game shrinks them.

The edge is a mask, so a picture costs no alpha. There are 32 masks, `Mask1.blp` to `Mask32.blp`
(512 by 256, DXT5, white with the mask as alpha). A mask is dry-brush streaks along each side,
broken into specks by the paper's tooth, with up to 40 spatters past the edge. The left side
frays half as deep (`LEFT_SHALLOWER` 0.5) so the picture lines up with the text. Each zone's
places take the masks in a shuffled order of their own, so no two places in a zone share an edge,
and a place keeps the mask its texture was written with.

Textures are named `zone-<uiMapID>.blp` for a zone and `<uiMapID>-<key with hyphens>.blp` for an
area. A place the lore lists twice (a city as an area of its zone, Hillsbrad's Alterac Mountains) is
given the picture of the one that was reviewed.

## In the game

`SpokenPlaces:Picture(mapID, key)` (`Core.lua`) returns the picture's path and its mask's, or nil
for a place with none or with Show Pictures off. `Data/Pictures.lua` is
`SpokenPlaces.pictures[mapID][key or ""] = { texture, mask number }`, where `""` is the zone itself.
`TextView.lua` draws the picture 2:1 and as wide as the text up to `PICTURE_MOST` (400), centred,
`PICTURE_GAP` (10) above the words, at `PICTURE_ALPHA` (0.95), cut by the mask through a mask
texture.

Look at a new picture at the size the game draws it, on the parchment colour. A game client lists
its files when it starts, so a texture added while it runs may draw as solid green until it is
restarted, and `/reload` does not fix it.

## Credits and the files

Each picture's wiki source file is found by matching the original against the downloads in
`cache/pictures`, or named in `pictures/sources.json` for a picture added by hand: a wiki file
name, a URL, or `own: <text>` for a screenshot taken for the addon. The result is
`Textures/Pictures/CREDITS.md`, which also says each picture was cleaned up with Gemini. Add
anything from outside the project to `THIRD_PARTY.md`, and check its terms before it ships. The
pictures are a large part of the addon's size, so raise a big addition with the reviewer.
