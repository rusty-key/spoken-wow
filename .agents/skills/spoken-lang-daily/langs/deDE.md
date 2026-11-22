# deDE rules for /spoken-lang-daily

Maintainer: the deDE team. Decisions here are theirs; change them by PR.

- **Flag:** 🇩🇪
- **Wowhead locale:** `de` (`https://nether.wowhead.com/forever/de/tooltip/npc/<id>`)
- **Spelling reference:** Duden.

## Gender forms (steps 4 and 5)

German addresses the player with gendered nouns and adjectives. Where the enUS line addresses
either player, a baked-in form becomes a branch:

| Baked in | Fix |
| --- | --- |
| „Reisende“, „Reisender“ | `$gReisender:Reisende;` |
| „Bruder“, „Schwester“ | `$gBruder:Schwester;` |
| „meine Liebe“, „Sire“, „Kumpel“ (addressing one player) | the male/female pair that matches the enUS line |
| „junger Krieger“ (enUS has `$C`) | `$C` |

No fix for words that do not mean the player („Schneiderin“, when the speaker talks about herself)
or fit both („Kumpel“, „Freunde“ in the plural).

Corrections that put a gender-bound form on a line without `:m`/`:f`, where `before` is neutral or
male, are rejected: Abenteurer→Abenteurerin, Freund→Freundin, Kumpel→Mädel, Guter→Gute,
Bruder→Schwester.

Class words such as „Paladin“ instead of `$C` are fine in class-only books and quests.

## Names (step 5)

**Names follow the Forever deDE client** (decided 2026-10-31). Forever keeps many proper names
English: Stormwind, Ironforge, Booty Bay, Ratchet, Blackrock, Undercity, Winterspring,
Twilight-Hammer, Sandfury. Era and TBC clients send the German forms (Sturmwind, Eisenschmiede,
Ratschet, Schwarzfels, Winterquell).

- A correction that moves a name away from the Forever form („Stormwind“ → „Sturmwind“) is rejected.
- A contribution with a German name form is accepted and fixed to the Forever form in step 5b.
- A correction that only moves a name to the Forever form is a fix.

## Variants (step 5, "accept as wording")

Typical deDE variants: a Zephras rewrite, another greeting („Lok-tar, $C.“), a reordered sentence.

## Known quirks

- Forever deDE gossip writes `$u` with swapped separators, „$uBürger;Bürgerin:“. The generator knows
  it; it is not an error.
- Console output in Git Bash shows umlauts as „�“. The data is fine; never "repair" umlauts from
  console output.
- Wowhead sometimes renders a gender branch as nothing („danken kann, .“). Fill it from the enUS line.

## Voicing

Default `voicingCap` 1,500 fits a normal day on the ElevenLabs Pro plan.
