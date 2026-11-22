# xxXX rules for /spoken-lang-daily

Copy this file to `langs/<lang>.md` and replace every `TODO` with your team's decision. Until no
`TODO` is left, `/spoken-lang-daily` only runs in `plan` mode. `deDE.md` is a filled-in example.

- **Flag:** TODO (emoji for the Discord update)
- **Wowhead locale:** TODO, one of `de`, `es` (esES), `mx` (esMX), `fr`, `it`, `pt` (ptBR), `ru`,
  `ko`, `cn` (zhCN), `tw` (zhTW)
- **Spelling reference:** TODO (dictionary or style guide to settle typos)

## Gender forms (steps 4 and 5)

TODO: how does your language address the player by gender? List the common baked-in words and the
`$gmale:female;` branch each one becomes, like the table in `deDE.md`. If your language does not
mark the player's gender (e.g. koKR, zhCN), say so: then a baked-in gender form never happens and
step 4 only fixes names, classes and races.

TODO: words that look gendered but need no fix (the speaker talking about themself, plural forms).

TODO: which corrections put a gender-bound form on a neutral line and must be rejected (examples).

Check `pipelines/lib/player-words.mjs` for your language's entry and quirks (e.g. ruRU's third
field, frFR's `$cs`).

## Names (step 5)

TODO: which client's proper names win when two clients disagree (Forever, Era, TBC, the official
translation)? Give a few examples of the preferred form. If there is no policy yet, decide one with
your team before the first real run: without it, step 5 cannot tell a fix from a regression.

## Variants (step 5, "accept as wording")

TODO (optional): typical variants in your language that are a second valid wording, not a fix.

## Known quirks

TODO (optional): client or Wowhead quirks of your language that are not errors.

## Voicing

TODO (optional): a `voicingCap` other than 1,500 if your voice plan is smaller or larger.
