# Icons

A gold four-pointed star on a dark octagonal shield. The shield is the Spoken family mark, and
the other addons wear it with a different figure (a play triangle for Spoken, an exclamation
mark for Spoken Quests, a book for Spoken Readables), so the family reads as siblings on a
CurseForge profile without any two being mistaken for each other.

| File | Used for |
|---|---|
| `spoken-zones-512.png` | the source, and the CurseForge avatar for English's addon and pack |
| `spoken-zones-<locale>-512.png` | the same with the language's badge: its pack's avatar |
| `spoken-zones-<locale>.tga` | its pack's addon-list icon, built from the PNG |

The PNGs are the designer's exports. There is no vector source in the tree, so a change to the
art comes back as new PNGs.

## Where they end up

**The website** does not read this directory. `apps/web/public/icons/places.png` is an 84 px
copy, made by hand when the art changes.

**CurseForge avatars are uploaded through the website**, not shipped in the zip, so
`scripts/places/package-audio.sh` deliberately does not include this directory.

## The in-game addon list

Spoken Places and its English pack ship `Textures/AddonIcon.tga` and point `## IconTexture` at
it. It is a **TGA** because the client reads TGA or BLP and neither PNG nor SVG, 64×64 because
the size must be a power of two, and committed rather than converted at build time so that
building an addon needs no ffmpeg. `make places-icon` regenerates both copies, and every
language's TGA here, from the PNGs.

The two English copies are byte-identical on purpose. The addons install as a pair, and giving
them different icons would imply they are alternatives to each other. A language's pack is
staged from English's folder, and `scripts/places/package-audio.sh` copies that language's
badged TGA over the icon.

The script also rewrites the `## IconTexture` path when it stages a pack: the texture lives
under the folder it ships in, and a language's folder is not English's. A path pointing at an
addon the player does not have installed shows no icon at all rather than failing loudly.
