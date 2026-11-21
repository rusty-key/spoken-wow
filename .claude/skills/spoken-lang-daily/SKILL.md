---
name: spoken-lang-daily
description: Use when a language maintainer wants the daily round for their language on spoken.quest done, invoked as /spoken-lang-daily <lang> [plan] (deDE, frFR, esMX, ...). Resolves every new contribution and correction of that language (quests incl. gossip, readables, places): accepts, repairs tokens via the Text API, accepts variants as wordings, or rejects, so the review list ends empty; closes every open audio report it can; then queues voicing for every quest, gossip, place, readable and boss line that is not on the maintainer's done models yet. Language rules come from langs/<lang>.md.
argument-hint: "<lang> [plan]"
---

# spoken-lang-daily

The daily round of one language on https://spoken.quest: check and resolve contributions and
corrections, close audio reports, then voice everything not yet voiced on the maintainer's models.

Arguments: the language (`deDE`, `frFR`, `esMX`, ...; ask if missing) and optionally `plan`. With
`plan`, read only: run steps 1–5c, but assign, accept, reject, rewrite, close and queue nothing.
Same report at the end, with "would" instead of "did".

## Before the round

1. **Settings:** `~/.claude/spoken/<lang>/config.json`. If missing, copy `config.example.json` from
   this folder there and ask the maintainer for the values. Everything this skill writes (batch log,
   Discord files) also goes into `~/.claude/spoken/<lang>/`.

   | Key | Meaning |
   | --- | --- |
   | `textApiTokenHeader` | File with one line `Authorization: Bearer <token>`, a read+write Text API token for this language (`docs/contributors/TEXT-API.md`, "Getting a token") |
   | `doneModels` | Takes of these models count as finished. Default `eleven:v4`, `eleven:v4_turbo` |
   | `voicingCap` | Ask before queueing more lines than this in one round. Default 1,500 |
   | `scraperBooksMatch` | Optional glob to a Wowhead scraper's `books_match.json` (step 3) |
   | `release` | Only for `/spoken-lang-release` |

2. **Language rules:** read `langs/<lang>.md` in this folder. It holds what this skill cannot know
   in general: how a gender form looks in the language, which client's place names win, where to
   check spelling, examples. If there is no such file, or it still has `TODO`s, run in `plan` mode
   only, say which decisions are missing, and offer to fill the file in with the maintainer
   (`langs/_template.md`). Never guess grammar rules for a language.

3. Load the maintainer's own memory notes for this language, if they keep any. New gotchas found
   during the round go there, or, if they hold for every language, into this skill by PR.

## Clearance

**Goal: the review list ends empty.** Every new contribution and correction gets an end in this
round: accept, accept and repair, accept as wording, or reject. "Hold back and mention it" does not
exist: nobody looks at leftover rows by hand. Only what an admin alone can solve may stay open:
"Needs a speaker", missing voice clones (`model-*`), book pages without an English book that a
developer would have to add. Those go to the dev log.

By invoking the skill the maintainer has cleared, without asking again:
- assigning book contributions to an English page (`/api/contributions/page`) when the match is
  unambiguous (step 3),
- accepting contributions (`/api/contributions/resolve-many`) that pass step 4,
- accepting corrections (`/api/contributions/correction`) that pass step 5, also **as another
  wording** (`as: "wording"`, `__spoken.acceptWording`),
- **rejecting** (`__spoken.reject`) by the rules of steps 3–5, only rows with `status: "new"`,
- **text fixes through the Text API** (step 5b) for rows this round accepted, always with
  `expectedVersion` and `note`, the batchId in `batches.log`, never touching lines with version > 1
  someone edited by hand,
- queueing voicing (`/api/regenerate/queue`, POST) with the maintainer's own voice key,
- closing **audio reports** (step 5c): set `fixed`/`not_an_issue`, accept a report's player text,
  fix typos through the Text API, set a quests override with a respelling, re-voice reported lines.

Not cleared: reject or ignore already accepted rows, rewrite text by PUT on the site, rewrite rows
this round did not accept, pause, resume, stop or discard queue jobs, create or delete voices or
clones at the voice provider, set NPC speakers, trigger a release.

Ask with `AskUserQuestion` only if voicing would exceed `voicingCap` lines at once.

## 0. Prepare the browser

Everything runs in a browser tab logged in to spoken.quest as the maintainer (the built-in
browser pane of the Claude desktop app, or Claude in Chrome). The site authenticates by session
cookie. Never ask for a password or token, never read cookies.

1. Open `https://spoken.quest/<lang>/contributions/quests` (or use the open tab). If it
   redirects to the login, stop and ask the maintainer to log in in that tab. A 404 while logged
   in means the account has no maintainer rights for this language: stop and say so.
2. Read `TBC_QUEST_CEILING` from `apps/web/src/lib/quests/line-client.ts` in this repository. Run
   `window.__spokenCfg = { lang: "<lang>", doneModels: <from config>, tbcQuestCeiling: <that value> }`
   with `javascript_tool`, then read `spoken.js` from this folder and run its **whole content**. Answer:
   `"__spoken loaded for <lang>"`. Any navigation of the tab drops `window.__spoken`; then load both
   again. The helpers only use `fetch`, so the tab never has to navigate.
3. Each `javascript_tool` call has 45 s. Split big steps into several calls, e.g. one section per
   call.

If the browser tool refuses a writing `fetch` (classifier), do not work around it and do not
switch to clicking. Stop, tell the maintainer the exact step ("Accept all matching (N)" on
`/<lang>/contributions/<section>`) and continue the rest of the round after they answer.

## 1. Take stock

```js
await __spoken.contributions()   // { quests:{ready:[ids],blocked:n,blockedOther:n}, readables:{ready:[…]}, places:{ready:[…]} }
(await __spoken.corrections()).length
const q = await __spoken.status(); window.__since = q.cursor; q   // queue running, paused? cursor for step 8
```

Gossip lives in the quest rows: `/contributions/gossip` redirects to `quests`. For the report, count
the rows with `quest === "gossip"` from `contributionRows("quests", …)`. Never query gossip on its
own, or every row counts twice. Corrections are all on one page; `corrections()` does not page.

The Text API (`/api/v1`) only knows texts (read, PATCH, undo). Contributions, corrections, audio
state and the queue are not in it, so this round runs through the browser with the session cookie.

`client=all` is deliberate: all clients, not only the page's default filter. `blocked` means "Needs
a speaker": the site refuses to accept until someone sets the NPC speaker. Only count these and name
them in the report.

**Other clients are not an open item** (PR #909). The site shows and voices only Era + Forever.
Rows from TBC Anniversary, the legacy clients (1.12, 2.4.3, 3.3.5a) or Retail are accepted but not
shown. `blockedOther` counts waiting rows of such clients, plus quests below 13000 the Classic
corpus lacks (Wowhead TBC imports with a Forever build). In the report only as a number in
brackets, never under "For you" and not in the dev log.

If the language is in `status().paused`: still do steps 2–5, skip step 6 and say in the report who
paused it and when.

## 2. Read contribution rows

For every section with `ready` ids, fetch the rows with their text:

```js
await __spoken.contributionRows("readables", ids)   // pages until all ids are found (max 10 pages)
```

If ids are still missing (more than 10 pages), reload with `contributionRows(section, ids, 20)`.
One call per section, because of the 45 s.

## 3. Readables: assign the English page

A readables contribution from a localized client names no English page (`book.match: null`), and
`accept` refuses it with `needs-page`. If it came from a Wowhead scrape (`from=wowhead`) and
`scraperBooksMatch` is set, the English page is already known: find the entry with the same
`locale`, title and page number there and take its `englishPageId` and `bookId`. Otherwise, for
every row without `book.match`:

1. Read the title (`book.title`, localized) and text, derive the English title and search:
   `await (await fetch("/api/readables/search?lang=enUS&q=<English keywords>")).json()`.
   Hits have `bookId`, `title`, `pageNumber`, `pageCount` and `text`.
2. Assign only if **everything** fits: the text is a translation of exactly this English page, page
   `book.number` exists in this book, and no second book fits as well. If two books fit, compare
   the text page by page; if one is then clearly closer, assign it.
3. `POST /api/contributions/page` with `{ id, bookId, pageNumber }`. `409` means already assigned
   and written; move on.
4. What cannot be assigned:
   - **No English book** in the enUS corpus: **reject** and add to the dev log under "Books the
     enUS corpus lacks" (title, pages, ids). The client sends the page again once the book exists.
   - **Duplicate** of a page that already has this text (`known`): reject.
   - Still **ambiguous** after comparing: reject and add to the dev log (title, candidates).

## 4. Check and accept contributions

Before accepting, read every quests/gossip row next to its English line
(`/api/quests/search?lang=enUS&client=all&line=<lineId without :m/:f>`). Each row lands in exactly
one pot. `langs/<lang>.md` gives the language's examples for each row of this table:

| Finding | Pot |
|---|---|
| clean | **accept** |
| player name baked in where the enUS line has `$N` | **accept + fix**: name → `$N` |
| player gender baked in where the enUS line addresses either player | **accept + fix**: → `$gmale:female;` in the language's forms. On a `:m`/`:f` lineId the bound form is right: just accept |
| class or race baked in where the enUS line has `$C`/`$R` | **accept + fix**: → `$C`/`$R` |
| a name not in the form the language's rules prefer | **accept + fix**: → that form (evidence as in step 5) |
| unknown but unambiguous token (`$` + word without `g`, missing `;`) | **accept + fix**: → known form |
| a gap the enUS line fills unambiguously (Wowhead hole ", ." where enUS has `$N`) | **accept + fix** |
| a gap without an unambiguous fill, holes in made-up languages, cut-off text | **reject** |
| not in the language (English text in this language's contribution) | **reject** |
| "Needs a speaker" | stays, admin only (dev log) |

Unsure which fix is right: reject. A client sends a good line again; a wrongly repaired one stays
wrong.

The tokens the generator knows are in `pipelines/lib/player-words.mjs` (the authority, with the
language-specific quirks). **Known and allowed** in every language:
  - `$gmale:female;` in any case (`$g`, `$G`, `$u`, `$U`), also with a third field;
  - Forever's swapped `$uX;Y:` (`;` between the two forms);
  - `$N`, `$C`, `$R` (also lower case) when no letter follows;
  - the genitive `$Ns`/`$Cs`;
  - TBC/Forever's doubled `$$N`, `$$C`, `$$R`, `$$Ns`, `$$Cs`.

  **Unknown, so fix or reject:** `$Rs`, `$`+word without `g`, a branch without `:` or `;`, a branch
  across a sentence end, `$2oa` (crafting orders; reject unless the language's rules say
  otherwise), any other `$` + letter.

```js
await __spoken.accept([...accept, ...fix])   // { accepted:[…], refused:{ id: "reason" } }
await __spoken.reject([...reject])           // { rejected:[…], refused:{ id: "reason" } }
```

For every id in "fix", **before** accepting, find the lineId the fix hits and note the target text.
Gossip ids hang on the text, and the same text can be on several lines: the fix then hits every line
of the NPC with exactly that text (search `q=<text>`, same `npcName`), all in the same PATCH. If no
line can be found, do not accept: **reject**. An accepted but unrepaired row is worse than a
rejected one.

No fix is needed for words that do not mean the player (a speaker talking about themself) or that
fit both. Step 5b writes the fix once `accept` took the row. Ids the site refused go into the report
with the reason (`needs-speaker`, …). Do not retry, except "That didn't go through -- try again.":
exactly once.

## 5. Check and accept corrections

A correction **overwrites** the corpus text (`before`) with what the player's client showed
(`after`). Judge each one. A `lineId` ending in `:m` or `:f` is a gender variant; otherwise the line
is for both genders.

Each correction lands in one pot: **accept** (fix, overwrites), **accept as wording** (variant,
`acceptWording`, the corpus line stays) or **reject**.

**Reject:**
- `before` has `[tag]` stage directions (`[curious]`, `[surprised]` …) that `after` lacks.
  Accepting would delete the v4 tags, even if the text changes otherwise.
- `after` loses a token `before` has (`$N`, `$C`, `$R`, `$g…;`/`$G…;`, `$u…;`): the client resolved
  it for one player, baking in name, class or gender.
- A line without `:m`/`:f` where `after` puts in a gender-bound form where `before` is neutral or
  male (examples in `langs/<lang>.md`). On a `:f` line the female form is right, on `:m` the male.
- `after` is empty or cut off: a whole sentence or paragraph is missing at the end for no visible
  reason. That happens with truncated progress text.
- `after` has tokens the generator does not know (step 4), or a player name.
- `after` only moves a name away from the form the language's rules prefer, or only changes
  spelling `before` already has right (hyphen, case).
- `after` is not in the language.

**Accept as wording** (`acceptWording`, quests and gossip only; the site refuses it for readables
and places, where a variant is **rejected**): `after` is **another wording** or another text, and
`before` is not wrong in itself: other words, a reordered sentence, a new or different paragraph,
another greeting. That is a second valid version (another client, another gossip variant), and
overwriting would delete the existing one. Only if `after` has no reject reason above.

**Names** follow the policy in `langs/<lang>.md` (for example, deDE follows the Forever client,
which keeps many names English). A correction that moves a name away from the preferred form is
rejected; a contribution with a non-preferred name is accepted and fixed in step 5b. A correction
that **only** moves a name to the preferred form is a fix. When unsure, find evidence: a count in the
corpus (`/api/quests/search?lang=<lang>&q=<form>`, only rows with text in the language) or Wowhead
in the language (`https://nether.wowhead.com/forever/<wowhead-locale>/tooltip/npc/<id>`, also
`zone/`, `item/`; the locale code is in `langs/<lang>.md`).

**Accept** (overwrites), only if `before` is demonstrably wrong and `after` otherwise stays the
same: typos, grammar fixes, a name into the preferred form, whitespace only (`" \n \n "`→`"\n\n"`),
a broken token in `before` that `after` resolves correctly, the right form on a `:m`/`:f` line, a
text cut off in `before` that `after` completes, if the enUS line has that rest too. When in doubt,
it is a variant, not a fix.

```js
await __spoken.acceptCorrection(id)   // fix: { ok:true } or { ok:false, error }
await __spoken.acceptWording(id)      // variant
await __spoken.reject([ids])          // in one go
```

Accept one at a time. An accepted correction makes existing audio `stale`, and step 6 picks it up.
If the site refuses `acceptWording` (409), reject the correction and put the reason in the report.

## 5b. Text fixes through the Text API

For the rows step 4 accepted under "accept + fix". The Text API runs with the maintainer's token via
`curl`, not in the browser tab (`docs/contributors/TEXT-API.md`):

1. Fetch the state from the row's own section (`quests`, `places` or `readables`):
   `curl -s -H @<textApiTokenHeader> "https://spoken.quest/api/v1/<section>/<id url-encoded>"`
   (quests with `variant > 0`: `?variant=<n>`). Never print, `cat` or log the header file.
2. Write only if `text` is still exactly the accepted contribution text. If someone changed it since,
   or `version` > 1 from an earlier hand: leave it, put it in the report.
3. One PATCH per section, split into batches of at most 1,000 items (the API's limit):
   `PATCH /api/v1/<section>` with `{ note: "<lang>-daily <date> token fixes",
   items: [{ id, variant?, text, expectedVersion }] }`. Send `variant` only for `quests` items. A
   text with `$g…;` splits a quest line into `:m`/`:f`, which `restore` cannot undo
   (`gender_split`). So only when the enUS line really addresses the player.
4. Append each `batchId` with date, section, count and purpose to
   `~/.claude/spoken/<lang>/batches.log`. Each item succeeds or fails on its own: read every
   item's result. Retry `internal` items once (the API marks them retryable). Every item that still
   failed (`conflict`, `invalid`, `unknown_id`, `internal`, …) goes into the report with its id
   and result.

The changed lines are then `stale` or `missing`, and step 6 voices them.

## 5c. Audio reports

Players report lines from the game (`/<lang>/reports/<section>`, dashboard tile "Open audio
reports"). Every open report gets an end in this round. Only reports an admin alone can solve may
stay open (wrong voice, lexicon); those go into the dev log.

```js
const reps = await __spoken.reports()   // [{ section, lineId, ids, reports:[{id, category, body, pack, npc, gameText}] }]
await __spoken.questLine(lineId)        // text, enText, isEnglish, skipReason, hasAudio, stale, take, override, file, voice
await __spoken.reportText(id)           // { text, state:{kind:"missing"|"known"|"changed", wordings, closest} }
```

A line with several reports is judged once; all its reports get the same end. The category is what
the player clicked, not what is wrong: "pronunciation" often means "was English". Go by the
report's text (`body`) and the line's state:

| Finding | End |
|---|---|
| English/no sound/wrong text reported, and the line **now** has text in the language (`isEnglish` false, `skipReason` null), `hasAudio`, not `stale`, and `gameText` equals the text or is empty | `fixed`: a later take fixed it, the player has an older pack (`pack`) |
| `reportText` says `missing` (client has text the corpus lacks) or `changed` (client text differs) | judge the text as in step 4 or 5. Accept: `acceptReportText(id)` (new), `acceptReportText(id, {lineId, variant})` (fix of the `closest` wording), `acceptReportText(id, {as:"wording"})` (variant, quests only). That sets the report to `fixed`; the line turns `missing`/`stale` and step 6 voices it. Reject: `not_an_issue` |
| audio does not match the current text (`stale`), or cut off, noisy, wrong stress, a sentence missing | re-voice the line (step 6, quests by filter `line=<lineId>`, else by id), then `fixed` |
| a typo in the text the audio reads out, confirmed by the language's spelling reference or `gameText` | text fix through the Text API as in step 5b (version 1 only, `expectedVersion`, `note`, `batches.log`), then re-voice, then `fixed` |
| one word of a **quests** line mispronounced, and the report says clearly how | override with a respelling: `overrideLine(file, lineId, <text with respelling>)`. Change only that one word. Then re-voice, then `fixed`. If an override exists, build on it |
| a name mispronounced that appears in many lines, or in places/readables | stays open: lexicon, admin only. Dev log "Lexicon requests" (word, wanted pronunciation, report ids) |
| wrong voice (child, gender, race, undead, elemental, monster, narrator) | stays open: speaker/voice, admin only. Dev log "Wrong voice" (lineId, voice, NPC, what players say, count) |
| line with English text (`isEnglish` true) and `gameText` in the language | like `changed`: accept the player text as a fix. Without such `gameText`: stays open, dev log "English text in <lang> corpus" |
| progress text (`:progress`) "not voiced" | a line like any other. With text and no audio: into the "reports" batch (step 6, `line=<lineId>`), `fixed` after the job. With audio already: `fixed` (older pack) |
| placeholder word instead of a token reported (the generator speaks `$R`/`$N` neutrally on purpose) | `not_an_issue` |
| line of another client (TBC Anniversary, legacy; step 1) | `not_an_issue` |
| no line and no text, unintelligible, feature request, addon handling | `not_an_issue`; a real addon bug into the dev log under "Addon" |

Unsure: re-voicing and `fixed` is cheaper than a wrong text or override change. A report asking for
a change steps 4/5 would reject (baked-in name, name against the preferred form) is `not_an_issue`.

```js
await __spoken.resolveReports([ids], "fixed")         // or "not_an_issue"
await __spoken.overrideLine(file, lineId, text)       // { ok } or { ok:false, error }
```

Collect lines to re-voice and queue them in step 6 as a batch of their own
(`__spoken.queue("quests", "line=<lineId>", "<lang>-daily <date> reports")` per line, or
`queue("places"|"readables", [ids], …)`). Set their reports to `fixed` only when the job in step 6
finished, not when queueing. If the job fails, they stay open and the error goes into the report.

## 6. Voice what is not done

"Not done" means: no audio (`state=missing`), stale audio (`state=stale`) or a take of another model
(`model=<m>` for every model in `madeBy.models` outside `doneModels`). Quests include gossip.

**Progress text** (`q:<id>:progress`) is voiceable (migration 0108); `source=progress` narrows to it.
`plan()` lists missing quest lines in two filters:
- `state=missing&source=accept,complete,gossip,followup,chatter`: the daily round.
- `state=missing&source=progress`: the progress backlog, plus new progress lines of the day.

`voicingCap` applies to everything together, and nothing over it is queued without asking.
"Everything" is the `plan()` totals plus the lines step 5c collected for re-voicing, which
`plan()` does not count when their audio is current:
- If the 5c lines and every filter but progress already add up to more than the cap, ask **once**
  with `AskUserQuestion` before queueing anything, with the combined numbers.
- Otherwise queue those filters without asking. If progress then breaks the cap, ask **once** about
  the backlog, with its count and characters from `plan()`: all, one level band
  (`&minLevel=<a>&maxLevel=<b>`, both inclusive, low quests first) or nothing today. If progress
  fits under the cap with the rest, it runs without asking.

`stale` and the model filters need no split.

Bosses (`/<lang>/bosses`): one story per boss, queue source `bosses`, same filters as places. A boss
without a story in the language (`written: false`) has nothing to speak; `plan()` and
`ids("bosses", …)` use `ids=1` and count only written ones. Bosses have no contributions or
corrections.

```js
await __spoken.plan()   // per section and filter: total (+ chars for places/readables)
```

Ask as described above when the cap is broken; otherwise queue without asking:

```js
// Quests (incl. gossip): one batch per filter from plan() with total > 0, the filter verbatim
await __spoken.queue("quests", "state=missing&source=accept,complete,gossip,followup,chatter", "<lang>-daily <date> missing")
await __spoken.queue("quests", "state=missing&source=progress", "<lang>-daily <date> progress")   // see the cap above
// Places, readables and bosses: collect ids, then one batch per section and filter
const ids = await __spoken.ids("places", "state=missing"); await __spoken.queue("places", ids, "<lang>-daily <date> places")
const pages = await __spoken.ids("readables", "state=missing"); await __spoken.queue("readables", pages, "<lang>-daily <date> readables")
const bosses = await __spoken.ids("bosses", "state=missing"); await __spoken.queue("bosses", bosses, "<lang>-daily <date> bosses")
```

- Answer `{ batchId, queued, skipped }`. `400 nothing to regenerate` is not an error: places,
  readables and bosses without text in the language have nothing to speak.
- `403`/`no key` means the maintainer's account lacks a key or speakers for this language. Stop and
  put the error into the report.
- Then poll `__spoken.status()` every ~30 s in short calls until `counts.pending` and `running` are
  0 or 20 minutes passed. If stopped after 20 minutes, say in the report that the queue keeps running.
- Do not requeue failures. Group them by cause in the report (missing clones, "English line not in
  corpus", …). A failure that comes back every day is not a new finding: mark it "known".

## 7. Report

Short, to the maintainer, in their language if they wrote in it:

```
Contributions: <n> accepted (quests a, gossip b of them, readables c, places d), <f> repaired
  · <r> rejected · <n> refused by the site · <n> waiting for a speaker (+<blockedOther> other clients, no to-do)
  repaired: #<id> <lineId>: "<before excerpt>" → "<after excerpt>" (batchId)
  rejected: <reason>: <count> (#<ids>)
Readables assigned: <n> · rejected: <title – reason>
Corrections: <n> accepted · <w> as wording · <r> rejected
  rejected: #<id> <lineId>: <reason> — "<before excerpt>" → "<after excerpt>"
Voicing: <n> lines in <k> batches · done <x> · failed <y> · credits <c>
  failures: <cause>: <count> (<example lineIds>)
Reports: <n> fixed (<a> already fixed, <t> text accepted, <v> re-voiced, <o> override, <x> typo)
  · <n> not_an_issue · <n> open for admin (voice <s>, lexicon <l>)
Release due: <sections with "Release …" on the dashboard and line counts, else "no">
For you: <only what the maintainer or an admin alone can do: press release, speakers, clones>
```

Contributions or corrections left with `status: "new"` that do not wait for a speaker are a bug of
the run: name them in the report with id and reason.

## 8. Discord: update and dev log

Two files under `~/.claude/spoken/<lang>/`, both Discord messages the maintainer copies and posts.
Name both paths in the chat and print both texts. Skipped in `plan` mode.

Format rules for **every** file of this step, because Discord renders only part of Markdown:
- English.
- No Markdown tables (`| a | b |`) and no `#` headings. Tabular content goes into a ``` code block
  with fixed column widths, everything else into `-` lists.
- Sections with a **bold** heading line. Ids, lineIds and tokens in backticks.
- At most 2,000 characters per message (check with `wc -m`). If longer, split into several messages
  separated by a line `---`, each under 2,000.

The voicing numbers come from `await __spoken.voiced(__since)` with the cursor from step 1
(`{ total, gossipNew, questsNew, progressNew, bossesNew, revoiced, other }`, `other` = places and
readables, `progressNew` not included in `questsNew`, `revoiced` = stale and other models). If
`__since` is gone after a navigation, take the smallest job id of today's batches minus 1.

**`<date>-discord.md`**: the update for everyone. Leave out rows with 0. The flag is in
`langs/<lang>.md`.

````
**<lang> update · <date>** <flag>
```
What                        New
--------------------------  ----
Gossip voiced                <gossipNew>
Quest lines voiced           <questsNew>
Progress lines voiced        <progressNew>
Quest lines re-voiced        <revoiced>
Boss stories voiced          <bossesNew>
Zone/book lines voiced       <other>
Book pages accepted          <books accepted>
Text corrections accepted    <corrections accepted>
--------------------------  ----
New audio total              <total>
```
<at most one sentence, e.g. "Players hear today's lines after the next release.">
````

**`<date>-dev-log.md`**: for the developer, one list line per cause or book, everything only a
developer can fix, with ids:
- voicing failures by cause (voice, lineIds, error text); known ones marked "known since <date>",
- "Books the enUS corpus lacks": rejected book pages without an English book (title, pages,
  contribution ids),
- "Needs a speaker": waiting contributions with NPC id and name,
- "Wrong voice" and "Lexicon requests" from step 5c, one line per line or word with report ids,
  "known since <date>" if the same report stays open,
- "Addon": real addon bugs from reports,
- contributions the site refused for reasons other than speaker or page,
- data errors the site does not catch: baked-in names, corrections that lose tokens, mapping to
  voices that do not exist (e.g. `model-80`).
- Never report tokens step 4 lists as known (`$G…;`, `$$N` …) as errors.

Rejected and repaired rows in detail belong in the report from step 7, not the log. If there is
nothing for the developer, do not create the file.
