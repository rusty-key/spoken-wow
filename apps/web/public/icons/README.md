# Section icons

The three addon icons the landing page puts on its cards. The same art CurseForge
and the in-game addon list show, so somebody arriving from either recognises what
they came for.

Copied, not authored. Each is the 512 px PNG beside its pipeline's other assets,
scaled to 84 px: the cards draw it at 28 px, and 84 is that at 3x.

| Here | From |
|---|---|
| `quests.png` | `pipelines/quests/assets/icon/spoken-quests-512.png` |
| `zones.png` | `pipelines/places/assets/spoken-zones-512.png` |
| `books.png` | `pipelines/readables/assets/spoken-books-512.png` |

The favicon (`src/app/icon.png`, `favicon.ico`, `apple-icon.png`) and the shield in
`public/logo.png` are the same play mark as `spoken-player-512.png`, scaled the same way.

`public/` is not part of Next's standalone output, so
`.github/workflows/deploy-web.yaml` copies this directory into the release
explicitly. A new file here needs no change to that; a new directory beside it does
not either, but the smoke test that proves the copy happened names one of these
files.
