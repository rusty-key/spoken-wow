# Voiceover hiccup scan — Vanilla corpus

One command writes both outputs:

```
python3 tools/scan_corpus_hiccups.py
```

- **`--json <file>`** — the findings with every line each one occurs on, written only when
  asked. `/issues` → **Reload scan** loaded it into Postgres until the review queue was
  removed; nothing reads it now, so it is no longer committed or shipped.
- **`pipelines/quests/docs/corpus-hiccups.csv`** — the same findings, one row each, for reading offline.
  Gitignored: it is derivable, and it has empty columns meant to be filled in.

This file is the summary. The counts below are from the scan of 2026-07-31.

Scope: `corpus/corpus.json.gz`, 17,507 lines, of which **14,315 are generatable** — the
other 3,192 are already excluded as `progress` (3,093) or `invalid-chars` (99) by
`tts_cli/corpus.py:38`. Only generatable lines are scanned, so nothing below is a
false alarm about text that never reaches ElevenLabs.

**The scan does not consult the lexicon.** A name that already has a pronunciation entry is
still a detection — it is a resolved one — and only the live lexicon row knows which those
are, so findings carry a `grapheme` and the loader decides coverage when it reads them. The
CSV's `in_lexicon` column says `seed` for the 144 that the *seeded* lexicon
(`apps/web/migrations/0008_seed_pronunciation_lexicon.sql`) covered, which is a reading aid and
nothing more.

Method: a token counts as English if Webster's (`/usr/share/dict/web2`) has it or
`wordfreq` scores it zipf ≥ 2.6. Everything else is treated as invented and classified.
Generator: `tools/scan_corpus_hiccups.py`.

## CSV columns

| column | meaning |
|---|---|
| `priority` | 1 = will mispronounce or read out junk, 2 = likely wrong, 3 = long tail. `severity` in the artifact and the database |
| `category` | see the table below |
| `item` | the token, or the offending fragment for line-level findings |
| `occurrences` | times it appears across generatable lines |
| `variants_in_source` | every casing/possessive spelling Blizzard uses — each needs its own rule, since 6140b1d uploads case-sensitively |
| `example_line` / `example_npc` | one place to hear it. The artifact carries every line, not just this one |
| `in_lexicon` | `seed` if the seeded lexicon already covered the name |
| `verdict` / `ipa` | **empty, for you to fill in while reviewing** |

## Findings by category

| pri | category | rows | occurrences | what it is |
|---|---|---|---|---|
| 1 | `name-apostrophe` | 149 | 1,146 | `Bly'Leggonde`, `Kel'Theril`, `Gahz'rilla` — `'` reads as a possessive. 121 have no seeded entry |
| 1 | `name-drifts-to-english` | 275 | 1,791 | proper noun one edit from a common word, so the model *corrects* rather than guesses: `Rhobart`→hobart, `Mograine`→migraine, `Islen`→isles, `Thredd`→thread, `Kravel`→travel |
| 1 | `abbrev-code` | 32 | 56 | `BS-091`, `LW-8485`, `TR-9999`, `AL-169110`, `OOX-17/TN`, `PX-238`, `SI:7`, `XT:4` |
| 1 | `number-binary` | 15 | 18 | Matrix Punchograph lines — ~40 spoken bytes of `0`/`1` each |
| 1 | `dialect-contraction` | 6 | 208 | `yer`, `ye'll`, `ye're`, `ye've`, `yerself` — normalise to `we'll` / `herself` |
| 1 | `roleplay-asterisk` | 7 | 17 | `*cough*`, `*hic*`, `*Dirk throws the hoof in a pile behind him.*` — the `<…>` form is gated, this one is not |
| 1 | `bug-source-typo` | 3 | 89 | `Exellent` ×47, `Ferelas` ×38, `Erelas` ×4 |
| 1 | `bug-glued-substitution` | 3 | 3 | `$N` with no following space: `adventurerYou've`, `adventurerama`, `adventurerath` |
| 1 | `bug-degenerate-line` | 5 | 5 | a line whose entire text is `"x"`; another that is one newline; Daryl the Youngling's name gags |
| 2 | `name-invented` | 479 | 12,285 | ≥5 occurrences: `Razorfen`, `Ashenvale`, `Felwood`, `Maraudon`, `Stonetalon`, `Dustwallow`, `Astranaar`, `Uldum` … |
| 2 | `punct-double-hyphen` | 359 | 533 | `--` as an em dash, sometimes glued: `Hearthglen--you'll`, `Tharil'zun--we` |
| 2 | `sfx-elongation` | 23 | 110 | `Hmmm` ×45, `Ahhh`, `Brzzzzt`, `Arrrr`, `Anyhooooo` |
| 2 | `roleplay-parenthetical` | 15 | 32 | `(May he rest in peace)`, `(emphasis on STEADY)`, `(s)` |
| 2 | `abbrev-initial` | 7 | 109 | `Kwee Q. Peddlefeet` ×88, `K.E.F.`, `J.D.`, `P.S.`, `G.L.A.` |
| 2 | `abbrev-title` | 8 | 68 | `Venture Co.` ×36, `Mr.`, `Ms.`, `Mrs.`, `Dr.`, `Ltd.`, `Inc.` |
| 2 | `punct-symbol` | 5 | 58 | `lad/lass`, `and/or`, `100%`, `cog #5`, a `______` signature rule |
| 2 | `sfx-stutter` | 10 | 10 | `W-what`, `h-hold` |
| 2 | `number-time` | 2 | 9 | `6PM` (no space) |
| 2 | `bug-source-typo` | 6 | 12 | `Cenarian`, `Smokeywood`, `Ungoro`, `Lakshire`, `Proudmore`, `Bag'thera` |
| 3 | `name-compound` | 793 | 5,896 | `Ironforge`, `Shadowfang`, `Westfall` — parts are real words, usually survive |
| 3 | `name-invented` | 1,370 | 2,512 | invented names under 5 occurrences |
| 3 | `number-bare` | 128 | 689 | `10 Stonesplinter`, `120 Dense Weightstones` |
| 3 | `punct-repeat` | 11 | 149 | `!!`, `??` |
| 3 | `abbrev-roman` | 4 | 15 | `Chapter II / III / IV`, `Hinderweir VII` |
| 3 | `punct-ellipsis` | 1 | 66 | four or more dots |

**3,716 rows total**, over 16,752 finding-line pairs. 3,066 are name rows; the rest are
line-level. 144 name rows were already covered by the seeded lexicon and will drop out of
`/issues` on the first load.

## Things worth knowing before you start reviewing

- **Encoding is clean.** Zero non-ASCII characters in the whole corpus, and one residual
  markup leak (`$Tpunk;` in `q:1:accept`, a Blizzard test row) which the `$` gate already
  catches.
- **The `<…>` stage directions are all handled** — 81 hits including
  `<Thrall grunts.>` and `<Magistrate Solomon opens the sealed letter…>`. The asterisk
  form is the same class of content and is not gated.
- **Case variants matter.** The source spells names inconsistently — `Dor'Danil`/`Dor'danil`,
  `Shen'Dralar`/`Shen'dralar`, `Malaka'Jin`/`Malaka'jin`, `Un'Thuwa`/`Un'thuwa`,
  `Mo'Grosh`/`Mo'grosh`, `Jintha'Alor`/`Jintha'alor`. `variants_in_source` lists them all.
- **Darkshore (54) vs Darkshire (45)** are two real, distinct places that are near
  homophones. Neither is in the lexicon; pinning both keeps them apart.
- `name-compound` is deliberately low priority, but a few need stress marked rather than
  phonemes: `Bonescythe` (BONE-scythe, not bone-SITHE), `Sepulcher`, `Apothecarium`,
  `Samophlange`, `Dreadnaught`.

## Suggested order

1. `name-apostrophe` — 121 rows with no entry, highest risk per line.
2. `name-drifts-to-english` — these fail loudly and are cheap to fix.
3. `name-invented` at priority 2 — the zones and factions as common as what is already in
   the lexicon.
4. Gate or rewrite rather than pronounce: `roleplay-asterisk`, `number-binary`,
   `bug-degenerate-line`.
5. Decide a text-normalisation policy for `punct-double-hyphen` (359 rows) and the
   `$N`-glued lines.
