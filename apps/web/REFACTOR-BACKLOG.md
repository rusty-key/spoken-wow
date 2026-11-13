# Refactor backlog

Cleanups found while converging quests, places and readables onto one shape (PR #29), and
deliberately left out of it: each was either outside that PR's scope, would change
behaviour someone should decide on, or was judged not worth the churn at the time.

Each entry says where, what it costs to leave, and the fix that was in mind. Paths are
under `src/` unless they say otherwise. Line numbers are left out on purpose; they drift.

When one of these is done, delete its entry rather than ticking it.

## Duplication

### Book text editing copies the places lore editor

`lib/readables/text.ts`, `app/api/readables/text/route.ts` and `components/readables/PageTextDialog.tsx`
repeat `lib/places/lore.ts`, `app/api/places/lore/route.ts` and `components/places/LoreDialog.tsx`
— about 560 lines. `restoreBookText`/`restoreLore`, `bookHistory`/`loreHistory`,
`BookConflict`/`LoreConflict` and `BookMissing`/`LoreMissing` are the same code under two
names, and the two route error mappers differ only in names.

**Cost:** the copies have already drifted — readables filters on `lang`, lore does not — and the
next fix to the restore transaction has to land twice.

**Fix:** one versioned-text layer parameterised by table: a shared history/restore helper
(select for update, clear the live flag, set it), shared conflict and missing errors, one
route error mapper, one dialog. `saveBookText` can stay its own, because it copies
structural fields the lore save does not have.

### Transactions are written by hand

`begin` / `commit` / `rollback` / `release` is spelled out in `lib/takes/commit.ts`,
`lib/takes/store.ts`, `lib/places/lore.ts` and `lib/readables/text.ts` (twice there).

**Cost:** code that has to be exactly right, written several times.

**Fix:** `withTransaction(fn)` in `lib/db.ts`.

### Two copies of range-request audio serving

The four take routes share `serveTake` in `lib/takes/serve.ts`; the voice-sample route
`app/api/voices/[voice]/samples/[file]` still has its own stat, `parseRange` and
416 / 200 / 206 code.

**Fix:** let `serveTake`'s streaming half take a path, and use it there too.

### The open-report count and its chip

The grouped `report` count is written three times — `lib/quests/context.ts`,
`lib/places/catalogue.ts`, `lib/readables/catalogue.ts` — differing only in readables' `lang`
filter. The chip that shows it is copied between `components/LineRow.tsx`,
`components/places/LineRow.tsx` and the readables page row, each with the same markup in a
`<Link>` branch and a `<span>` branch.

**Fix:** `openReportCounts(source, lang?)` beside `liveTakes` in `lib/takes/store.ts` or in
`lib/reports/store.ts`, and one `<ReportCount count source canTriage />` component.

### Memos keyed on the corpus, seven times

The "rebuild when `holder[key].lines !== lines`" pattern, each with its own `globalThis`
holder type, is in `lib/audio.ts` (`fileIndex`), `lib/facets.ts`, `lib/quests/catalogue.ts`
(`lineIndex`), `lib/voices/slots.ts`, `lib/generation/casings.ts` and
`lib/generation/preview.ts`.

**Fix:** one `derivedFromCorpus(key, build)` next to `corpus()`, or a
`WeakMap<CorpusLine[], T>`.

### Three catalogue stamp memos

`lib/quests/catalogue.ts`, `lib/places/catalogue.ts` and `lib/readables/catalogue.ts` each carry
the same `max(id):count:sum(live ids)` stamp query and `globalThis` stamp-compare holder.

**Fix:** `stampOf(table, lang)` and `memoOnStamp(key, stamp, build)` in `lib/db.ts` or a
`lib/memo.ts`.

### Missing-media handling in each player

`components/AudioPlayer.tsx` and `components/TakeSelector.tsx` both attach an `error`
listener and catch `play()` — both are needed, because browsers differ in which one a 404
arrives by. The explorers drive the shared element with `play().catch(() => {})`
(`components/Explorer.tsx`, `components/places/Explorer.tsx`, `components/readables/Explorer.tsx`,
`components/ReportTable.tsx`), so a rejection there is still dropped; `AudioPlayer`'s
listener covers it only in browsers that also fire `error`.

**Fix:** a `useMediaFailure(ref, onFail)` hook and a `playOrReport(element, onFail)`, or have
`AudioPlayer` expose `play()` so the explorers stop calling the raw element.

## Performance

### The quests corpus stamp is queried several times per request

`lib/quests/catalogue.ts` `stampOf` scans `quest_line` and `quest_line_speaker` (about
17 ms), and a search asks for it two to four times — through `filtersFromParams` → facets,
the route's own `corpus()`, and `fileIndex()` when the outdated or dirty filter is on.
The file-backed corpus this replaced cost nothing per request.

**Fix:** resolve `corpus()` once in the route and pass it down (`facets` and `fileIndex`
could take `lines`), or skip the stamp check for a few hundred milliseconds after one that
passed.

### Per-page staleness and dirtiness re-query what is in memory

`app/api/quests/search/route.ts` calls `staleFiles(files)` and `dirtyQuestFiles(files)` for
the page; each runs its own `take … file = any($1)` for `spokenHash` and `createdAt`, which
the request's `liveTakes("quests")` rows already carry. `lib/quests/staleness.ts` also awaits
four independent reads one after another.

**Cost:** two small queries and about three serial round trips per page.

**Fix:** let both accept the live rows, and `Promise.all` the independent reads in
`staleFiles`.

### The live-take query is uncached

`liveTakes(source)` in `lib/takes/store.ts` is about 17 ms for quests' 11,000 live files and
runs once per search. The per-directory `storeIndex()` it replaced was memoised.

**Fix:** memoise behind a take-table stamp (about 3 ms), the way the catalogues memoise
their corpus. Helps places and readables too.

## Consistency

### Quests takes record no duration

`lib/takes/commit.ts` measures a clip only when the caller passes `measure`; places and readables
do (`durationOf`), quests does not. So `durationSec` is null for every quests take, and the
column means different things per section. Adding it changes what quests records, and costs
an ffprobe per take.

### Places and readables paths are not checked in the adapter

`lib/takes/adapters.ts` checks quests files against a whitelist pattern; places and readables do
`path.join(root, file)` and rely on `isAddressableFile` upstream, which every route calls.
Safe today, but the guarantee lives in the callers rather than in the layer.

### `isAddressableFile` branches on the section

`lib/takes/files.ts` switches on quests / places / readables outside the adapter's total
`Record`, so a fourth section would compile without anyone deciding which files it can
address. Moving it into the adapter makes it part of what defining a section means.

### The quests freshness stamp ignores speakers

`deploy/web/sql/section_stamp.sql` stamps each section's corpus table and its takes. For
quests that is `quest_line` only, so a sync that changes nothing but `quest_line_speaker`
would not be flagged as out of step.

### `canTriage` is always `canRegenerate`

The quests `LineRow` takes both and its one caller passes `showRegenerate` to each. Either
they are meant to diverge — then say where — or one prop is enough.

## Small

- `components/Explorer.tsx` keeps a per-file `versions` override on top of the row's own
  `take.version`, to bust the audio cache before the refetch lands. It can briefly outvote
  the fresh row. Dropping it trades that for a moment of stale audio after a regeneration.
- `components/TakeSelector.tsx`'s "No takes recorded" branch cannot be reached: the popover
  only renders when there is more than one take.

## Noticed, not a refactor

- **`worker.test.ts › claims nothing while it does not lead` is flaky**, about one run in
  five: it seeds pending jobs in the shared test database, and a worker from another test
  file can claim them. Isolate its rows, or run the worker tests serially.
