# Icons

A gold book on a dark octagonal shield, the same shield the other Spoken addons carry, so the
four read as siblings on a CurseForge profile without being mistaken for each other.

| File | Used for |
|---|---|
| `spoken-books-512.png` | the source, and the CurseForge avatar for English's addon and pack |
| `spoken-books-<locale>-512.png` | the same with the language's badge: its pack's avatar |
| `spoken-books-<locale>.tga` | its pack's addon-list icon, built from the PNG |

The PNGs are the designer's exports; there is no vector source in the tree.

## Where they end up

**The addon list** reads `addons/Spoken_Readables/Textures/AddonIcon.tga`, a 64×64 uncompressed
TGA built from the 512 PNG by `make readables-icon` and committed, because an addon has to build on
a machine with no ffmpeg. Both English addons carry the same file. A language's pack is staged
from English's folder, and `scripts/readables/package-audio.sh` copies its badged TGA over it.

**The website** shows `apps/web/public/icons/readables.png`, an 84 px copy made by hand.

**CurseForge avatars are uploaded through the website**, not shipped in the zip, so the
packaging deliberately leaves this directory out.
