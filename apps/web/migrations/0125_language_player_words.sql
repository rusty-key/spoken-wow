-- A language's player words and fish.audio byte width, in its row rather than in code.
--
-- A recording says one word for every reader where the game writes $N, $C or $R
-- (pipelines/lib/player-words.mjs). The languages a game client runs in keep theirs in code; a
-- language a team brings keeps them here, and its text maintainers edit them on the site. A row
-- with none voices no line holding a token: the text gate refuses it. Additive: a release before
-- this one never reads either column.
--
-- Italian, Vietnamese and Polish are teams' languages now, not the project's; their words, and
-- Vietnamese's measured byte width, move here from code unchanged, so no take of theirs goes stale.

alter table "language"
  -- { m: { name, race, nameGenitive?, classPlural? }, f: {...} }; checked by the site
  -- (validPlayerWords) before it is written.
  add column "playerWords" jsonb check ("playerWords" is null or jsonb_typeof("playerWords") = 'object'),
  -- UTF-8 bytes per character at worst, for fish.audio's list price (lib/generation/calibration.ts).
  -- Null is the script's default.
  add column "bytesPerCharacter" numeric check ("bytesPerCharacter" is null or "bytesPerCharacter" between 1 and 4);

update "language" set "playerWords" =
  '{"m": {"name": "avventuriero", "race": "viaggiatore"}, "f": {"name": "avventuriera", "race": "viaggiatrice"}}'
  where "code" = 'itIT' and "playerWords" is null;

update "language" set "playerWords" =
  '{"m": {"name": "wędrowcze", "race": "wędrowiec"}, "f": {"name": "wędrowczyni", "race": "wędrowczyni"}}'
  where "code" = 'plPL' and "playerWords" is null;

update "language" set "playerWords" =
  '{"m": {"name": "nhà thám hiểm", "race": "lữ khách"}, "f": {"name": "nhà thám hiểm", "race": "lữ khách"}}',
  -- Vietnamese mixes ASCII letters with two- and three-byte ones; Forever's translation averages 1.41.
  "bytesPerCharacter" = 1.5
  where "code" = 'viVN' and "playerWords" is null;
