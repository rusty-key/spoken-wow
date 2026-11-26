# Text API

For text maintainers and audio team members who want a script or an AI agent to read and change
their language's text on spoken.quest. Everything here does what the site's edit dialogs do: each
change is made under your name and listed in the activity log.

Writes go live at once, with no review. The text routes make no audio and spend no credits. An edited
line reads as "audio outdated" until someone regenerates it, which a generate token can do (see
*Generating audio*).

## Getting a token

Open your **Profile**. If you are a text maintainer, or hold regenerate, in a language, there is
an **API tokens** section. Choose a label, a language, no text, read or read-and-write access, and
an expiry. What a write changes depends on what you hold (see *Original or override*). Tick **Generate audio on my key** to let the
token queue audio too; that needs regenerate, spends your own ElevenLabs or fish.audio key, and
stops working when you lose regenerate. The token is shown once, so copy it then.

A token stops working when it expires or when you revoke it. It covers one language, and each of
its scopes follows your grants there now: reading needs text or regenerate, writing the original
needs text, and writing overrides or queuing audio needs regenerate. Losing a grant takes away only
what it backed: a write and generate token whose owner keeps text but loses regenerate still writes
the original, and no longer queues audio. All requests send it as a header:

```sh
curl -H "Authorization: Bearer $SPOKEN_TOKEN" https://spoken.quest/api/v1
```

That first URL describes the API and your token, including the layers it may write
(`token.layers`, see *Original or override*). Pointing an agent at it is usually enough.

## Reading

The sections are `places`, `bosses`, `readables` and `quests`. Gossip lines are part of `quests`.

```sh
curl -H "Authorization: Bearer $SPOKEN_TOKEN" "https://spoken.quest/api/v1/places?zone=1411"
curl -H "Authorization: Bearer $SPOKEN_TOKEN" "https://spoken.quest/api/v1/places/z:1411"
```

| Section | Filter | Gives |
|---|---|---|
| `places` | `?zone={mapID}` | the zone and its subzones |
| `bosses` | `?instance={map}` | an instance's bosses |
| `readables` | `?book={bookId}` | a book's pages |
| `quests` | `?quest={questId}`, `?source=accept\|progress\|complete\|gossip`, `?minLevel={n}`, `?maxLevel={n}` | a quest's lines, one kind of line, or the lines of quests in a level range |

A list returns at most 500 items and a `nextCursor`. Pass it back as `?cursor=` until it is null.
`?limit=` asks for fewer. A parameter this API does not know is an error, so a misspelled filter
never returns the whole language by accident. A level bound leaves out lines with no known level,
which includes all gossip.

An item:

```json
{
  "id": "s:1411:razor-hill",
  "text": "…",
  "override": null,
  "short": "…",
  "version": 3,
  "name": "…",
  "nameVersion": 1,
  "englishText": "…",
  "englishName": "Razor Hill",
  "group": { "kind": "subzone", "mapID": 1411, "zoneName": "…" }
}
```

URL-encode an id in a path, because place and boss ids can contain spaces:
`/api/v1/places/s:1411:burning%20blade%20coven`.

`text: null` means no translation yet, and `englishText` is what to translate from. `short` is on
places only. `variant` is on quest lines only, because a few line ids name two different lines; a
single-item URL takes `?variant=`, default 0, and refuses a `variant` in its body.

`override` is your team's override: when it is not null, it is what your team's audio speaks in
place of `text`. The text shown on the site and in game stays `text`. A list or item gives only your
team's overrides; *Reference text* gives the English team's. Writing the original leaves `override`
in place, so the line keeps speaking the override; see *Original or override* to write the override
itself.

## Reference text

`GET /api/v1/{section}/reference` gives the English text of a section, whatever language the token
is for. It takes the same filters, `cursor` and `limit` as the list, and its items carry `id`,
`variant` (quests), `text`, `override` (the English team's), `short` (places), `name` and `group`,
with no versions. Any valid token can read it: one that reads or writes text, or one that generates.

```sh
curl -H "Authorization: Bearer $SPOKEN_TOKEN" "https://spoken.quest/api/v1/places/reference?zone=1411"
```

## Generating audio

A generate token queues audio in its language, exactly as the Regenerate button does and on your
own ElevenLabs or fish.audio key: the generator you chose for the language on Voices, the same
limits, one job per audio file. It stops working when you lose the right to regenerate there.

`POST /api/v1/{section}/generate` takes either `items`, up to 1000 of `{id, variant?}` as the text
update takes them, or, for quests only, `filters`: the query string of an Explorer URL in the
language (only the keys the Explorer's filters use; `page` is ignored, and an unknown key, a bad value, a key given twice or a `lang` is refused, so a typo cannot widen the batch; `rec` is refused too, since it needs a site session), since "every stale line" is a filter and not seventeen thousand ids. The 1000 caps `items` only (`limits.itemsPerGeneration`); a `filters` batch is not capped, as in the Explorer, so dry-run a wide one first. Neither generate nor the generations routes take a URL query string, and an item takes only `id` and `variant`. A quest item covers
every speaker's line of that id and variant; give the base id (`q:5:accept`), not a voiced
`~voice` id. Add `label` (up to 100 characters) to name the batch
and `"dryRun": true` to price it without queueing anything.

```sh
curl -X POST -H "Authorization: Bearer $SPOKEN_TOKEN" -H "Content-Type: application/json" \
  -d '{"items": [{"id": "z:1411"}], "dryRun": true}' https://spoken.quest/api/v1/places/generate

curl -X POST -H "Authorization: Bearer $SPOKEN_TOKEN" -H "Content-Type: application/json" \
  -d '{"filters": "state=stale&source=accept", "label": "stale accepts"}' https://spoken.quest/api/v1/quests/generate
```

A dry run answers `provider`, `files`, `characters`, `matched`, `dropped`, `unknown`, an
`estimate` per provider and `missingKeys`, the providers whose key you have not set. A real run
answers `batchId`, `queued`, `alreadyQueued` (files already waiting in the queue), and the same
`matched`, `dropped` and `unknown`. A dry run's `files`, `characters` and estimate count every
planned file, even one an earlier batch already queued, which the real run skips and counts in
`alreadyQueued`. `dropped` counts matched lines that became no job, by reason:
`untranslated`, `no-voice`, `invalid-chars` and `shared-file` for quests, `no-text` and
`not-generatable` for places, readables and bosses, and `hidden` for a quest item marked
ignored. `unknown` lists ids found nowhere. A line already done and asked for
again is generated and paid for again.

### Watching and stopping

`GET /api/v1/generations` lists your recent batches in the token's language, whichever way they were
queued, newest first; they are kept at least 30 days (old ones are pruned when a new batch is queued). `GET /api/v1/generations/{batchId}` gives one, with its
job counts by state, credits, cost and up to 100 recent failures; `finished` means nothing is
pending or running. `POST /api/v1/generations/{batchId}/stop` cancels what is still pending, so a
script that queued the wrong set can stop paying for it. Another person's batch, or yours in another
language, answers 404 as an unknown id does.

## Writing

Change one item's original text and name, with a text maintainer's write token (an audio team
writes overrides instead, see *Original or override*):

```sh
curl -X PATCH -H "Authorization: Bearer $SPOKEN_TOKEN" -H "Content-Type: application/json" \
  -d '{"layer": "original", "text": "…", "name": "…", "note": "typo"}' \
  "https://spoken.quest/api/v1/places/z:1411"
```

Change up to 1,000 with one request:

```sh
curl -X PATCH -H "Authorization: Bearer $SPOKEN_TOKEN" -H "Content-Type: application/json" \
  -d '{"layer": "original", "note": "first pass", "items": [{"id": "z:1411", "text": "…"}, {"id": "z:1412", "name": "…"}]}' \
  "https://spoken.quest/api/v1/places"
```

The response has a `batchId` and one result per item, in order. Each item succeeds or fails alone:

```json
{
  "batchId": "…",
  "results": [
    { "id": "z:1411", "text": { "status": "updated", "layer": "original", "version": 4, "lines": ["z:1411"] } },
    { "id": "z:9", "error": { "code": "unknown_id", "message": "…" } }
  ]
}
```

| Result | Meaning |
|---|---|
| `updated` | a new version was written |
| `unchanged` | the text was already this, so no version was written; reruns are safe |
| `removed` | an override was removed (see *Original or override*) |
| `conflict` | `expectedVersion` or `expectedNameVersion` did not match |
| `unknown_id` | no such item |
| `invalid` | the message says why |
| `internal` | a failure on the server; try this item again |

Text and names have separate version numbers. Send `expectedVersion` for text and
`expectedNameVersion` for a name to avoid overwriting someone's newer edit. Both are optional, and
both guard an existing version only: a line with no text has nothing to compare, so they do not
protect a first translation someone saved since you read it. The overwritten text stays in history.

Text can be up to 5,000 characters and a name up to 200. A quest line's override can be up to
2,000 characters (`limits.questOverrideLength`), and a place's, readable's or boss's up to 5,000. A request can be at most 8 MB,
past which the proxy answers 413 with no results, so split a run of very long texts. The same item
twice in one request is `invalid` the second time.

### Original or override

Every line has its original text, which every team in the language shares and which is shown on the
site and in game, and per team an optional override: what that team's audio speaks instead. Text
maintainers write the original; whoever holds regenerate writes their team's overrides.

A `PATCH` takes a top-level `layer`, `"original"` or `"override"`, for every item in the request,
so one run writes one layer. Without it, a token writes the original when its owner is a text
maintainer in the language, and otherwise their team's overrides. A text maintainer who also holds
regenerate sends `"layer": "override"` to write the override. Each text and name result says which
layer it wrote in `layer`.

```sh
curl -X PATCH -H "Authorization: Bearer $SPOKEN_TOKEN" -H "Content-Type: application/json" \
  -d '{"layer": "override", "items": [{"id": "z:1411", "text": "…"}]}' \
  "https://spoken.quest/api/v1/places"
```

A layer the owner may not write refuses the whole request, before anything is written:

| Status | Message |
|---|---|
| 403 | `this token's owner is not a text maintainer in {lang}, so it writes only its team's overrides` |
| 403 | `this token's owner does not hold regenerate in {lang}, so it cannot write overrides` |
| 400 | `layer must be "original" or "override"` |

A `layer` inside one of `items` makes that item `invalid`: `layer goes at the top of the body, not in an item`.

On the override layer:

- **`"text": null` removes the override.** The result is `removed`, or `unchanged` where there was
  none. A removal needs no original under it, so it works on a line whose original has since been
  retired, and it checks no `expectedVersion`. On the original layer a null text is `invalid`.
- **`expectedVersion` guards the original.** An override has no versions of its own. When sent, it
  must equal the original's current version, else `conflict`:
  `the original text is at version {current}, not {expected}`. The result's `version` is the
  original's.
- **An override needs original text under it.** A line with no text in the language is `invalid`:
  `this line has no {lang} text yet`.
- **Names and `short` have no override.** Both are original text. A `name` is `invalid` with
  `a name is original text, written with "layer": "original" by a text maintainer`, and a `short`
  with `short is original text, written with "layer": "original" by a text maintainer`. A readable's
  spoken title keeps the original name.
- **No `$G` in a quest override.** It is `invalid`:
  `an override cannot split a line by the reader's gender; that changes the original text`.
- **A quest line spoken in another voice** is listed on the site as a voice line of its own, which
  this API does not address. Overriding the plain line is `invalid`:
  `this line is spoken in another voice; override it on the site`.
- `note` is not kept with an override.

## Things that behave unexpectedly

- **`$G` splits a quest line.** Text containing `$G` writes the moment's `:m` and `:f` lines, and
  `lines` in the result lists them. The plain id stops being an item afterwards.
- **A split with no text yet needs `$G`.** A line English splits by player gender lists as `:m` and
  `:f` even with no translation. Plain text to either side is refused, because the two would land
  on one line. Send one text with a `$G` branch.
- **Names are shared.** A readable page's name is its owner's, so renaming one page renames every
  page and item with that owner, and `entity` in the result says what was renamed. A quest's name
  is shared by all its lines.
- **Some items have no name to write.** Gossip lines and readable pages with no owner return
  `invalid` for `name`.
- **English.** Quest text and all names cannot be changed in English, as on the site. English
  place, boss and readable text can.
- **Places: `short`.** Sending `text` without `short` regenerates `short`. Sending `short` alone
  keeps the text, and needs the place to have text already.

## Pronunciation lexicon

Each language has one lexicon: how names are said when lines are voiced. Reading it needs any
token. Changing it also needs the **configure** grant in the token's language, as on the site.

```sh
curl -H "Authorization: Bearer $SPOKEN_TOKEN" "https://spoken.quest/api/v1/lexicon"
curl -H "Authorization: Bearer $SPOKEN_TOKEN" "https://spoken.quest/api/v1/lexicon/Gnomeregan"
```

The list returns every entry at once, with no cursor, and a `version`:

```json
{
  "lang": "deDE",
  "version": "4f1c…",
  "sync": "synced",
  "updatedAt": "…",
  "entries": [{ "grapheme": "Gnomeregan", "ipa": "ˈnoʊmɹəɡæn", "confidence": "high" }]
}
```

An entry has exactly one of `ipa` (exact, without `/` or `[ ]`) and `alias` (a respelling), a
`confidence` of `high` or `check`, and an optional `note`. A grapheme is one word with no spaces.
Matching ignores case.

Replace or add one entry, or up to 1,000:

```sh
curl -X PATCH -H "Authorization: Bearer $SPOKEN_TOKEN" -H "Content-Type: application/json" \
  -d '{"alias": "NO-mer-ah-gun", "confidence": "check"}' \
  "https://spoken.quest/api/v1/lexicon/Gnomeregan"
curl -X PATCH -H "Authorization: Bearer $SPOKEN_TOKEN" -H "Content-Type: application/json" \
  -d '{"items": [{"grapheme": "Gnomeregan", "ipa": "ˈnoʊmɹəɡæn", "confidence": "high"}]}' \
  "https://spoken.quest/api/v1/lexicon"
```

Unlike text, a lexicon write is all or nothing: one invalid item refuses the whole request with a
400 naming it. Each result is `created`, `updated` or `unchanged`. An entry is replaced whole, so a
`note` you leave out is dropped. Entries you do not send stay as they are; this API cannot remove
one. Send the `version` you read as `expectedVersion` to get a 409 instead of overwriting a newer
save. A `null` version, from a language with no lexicon yet, guards too.

A write uploads the lexicon to ElevenLabs with your own ElevenLabs key, as the site does. Without
one, or if the upload fails, the entries are saved, `sync` reads `pending` (`never` for a
language never uploaded) and `syncError` says why. Generation goes on with the previous upload
until someone uploads from the lexicon page. Every write that changes something uploads the whole
dictionary, so send several fixes as one bulk `PATCH` rather than one request per word.
Changing an entry marks takes that say the word as outdated; nothing here regenerates them.

## Accents and NPC directions

A direction is a short instruction such as `Scottish accent` that tells the voice how to perform a
line. It is stored in square brackets, which are added for you. Reading or changing directions
needs the **configure** grant in the token's language, except reading race tags, which needs any
token. Changing one marks the takes it voices as outdated; nothing here regenerates them.

```sh
curl -H "Authorization: Bearer $SPOKEN_TOKEN" "https://spoken.quest/api/v1/race-tags"
curl -X PATCH -H "Authorization: Bearer $SPOKEN_TOKEN" -H "Content-Type: application/json" \
  -d '{"raceTags": {"dwarf": "Scottish accent", "troll": "[Caribbean accent]"}}' \
  "https://spoken.quest/api/v1/race-tags"
```

Race tags are one map per language, keyed by race or by one voice slot of a race. A `PATCH` replaces
the whole map, as the Voices page does: a race you leave out loses its tag, so read, change and
send it back.

```sh
curl -H "Authorization: Bearer $SPOKEN_TOKEN" "https://spoken.quest/api/v1/npcs?directed=true"
curl -H "Authorization: Bearer $SPOKEN_TOKEN" "https://spoken.quest/api/v1/npcs/creature:1747"
curl -X PATCH -H "Authorization: Bearer $SPOKEN_TOKEN" -H "Content-Type: application/json" \
  -d '{"direction": "weary, gravelly"}' \
  "https://spoken.quest/api/v1/npcs/creature:1747"
```

An NPC's id is its kind and number: `creature:1747`, `gameobject:…` or `item:…`. The list pages
like text, with `cursor` and `limit`; `directed=true` keeps only NPCs with a direction. Each NPC
gives its `name`, `race`, `gender` and `flavor`, its global `direction`, and the
`languageDirection` your language speaks it with in place of the global one. A `PATCH` sets
`languageDirection`; an empty or `null` direction clears it back to the global one. English has
no language direction: the global direction, and who the NPC is, are set by the site's admin on
the NPCs page.

## Undoing a run

```sh
curl -H "Authorization: Bearer $SPOKEN_TOKEN" "https://spoken.quest/api/v1/batches"
curl -X POST -H "Authorization: Bearer $SPOKEN_TOKEN" \
  "https://spoken.quest/api/v1/batches/$BATCH_ID/restore"
```

`/batches` lists your recent runs in the token's language, including one whose response you never
received. A restore needs a write token in the same language as the run. A global admin may undo
anyone's run. Each edit is undone only in a layer your token may write now, and an override only in
the team that wrote it: by someone who still works in that team, or by a global admin, whose undo
writes into that team and not their own.

For each thing the run wrote, it reports one of:

| Result | Meaning |
|---|---|
| `restored` | the version before the run is live again; for an override, the override before the run, or the one it removed |
| `retired` | it was a first translation, and the line reads as untranslated again; for an override, the run made it, and the line speaks its original again |
| `skipped`, `edited_since` | someone changed it since, and their edit stays |
| `skipped`, `gender_split` | the run split a quest line by `$G`, which cannot be undone here; fix it by hand |
| `skipped`, `not_allowed` | your token may not write that layer now, or the override's team is not the one you work in |
| `skipped`, `retired_original` | the line's original text has since been retired, so the override the run replaced or removed has nothing to stand on and is not put back; whatever the run left stays |
| `skipped`, `error` | it failed; the message says why, and the rest still ran |

Each result names its `field`: `text`, `name` or `override`. A name's result gives its `entity`
instead of a line, since it may belong to several lines. Undo
restores what was live before; it does not delete history, so every version stays on the site.
