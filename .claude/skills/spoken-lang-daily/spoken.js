// Helpers for /spoken-lang-daily. Set window.__spokenCfg = { lang, doneModels } first, then run
// this whole file with javascript_tool in the spoken.quest tab; it creates window.__spoken.
// Every call afterwards stays under the 45 s the tool gives one call.
window.__spoken = (({ lang, doneModels } = {}) => {
  if (!/^[a-z]{2}[A-Z]{2}$/.test(lang ?? "") || lang === "enUS") throw new Error("set window.__spokenCfg = { lang: 'frFR', doneModels: [...] } first");
  const LANG = lang;
  // Takes of these models count as done; takes of any other model get re-voiced. v4 and v4 Turbo
  // sound the same, so both count by default.
  const V4 = doneModels?.length ? doneModels : ["eleven:v4", "eleven:v4_turbo"];
  // /contributions/gossip redirects to quests: gossip lives in the quest rows (quest === "gossip").
  const SECTIONS = ["quests", "readables", "places"];

  // A page's RSC payload: the strings of self.__next_f.push([1,"…"]), joined.
  async function flight(path) {
    const html = await fetch(path, { credentials: "include" }).then((r) => r.text());
    let out = "";
    for (const m of html.matchAll(/self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g)) {
      out += JSON.parse(m[1]);
    }
    return out;
  }

  // The JSON array after "key":[ — brackets counted, strings skipped.
  function arrayAfter(text, key) {
    const start = text.indexOf(`"${key}":[`);
    if (start < 0) return null;
    const from = start + key.length + 3;
    let depth = 0;
    for (let i = from; i < text.length; i++) {
      const c = text[i];
      if (c === '"') {
        for (i++; i < text.length && text[i] !== '"'; i++) if (text[i] === "\\") i++;
      } else if (c === "[" || c === "{") depth++;
      else if (c === "]" || c === "}") {
        depth--;
        if (depth === 0) return JSON.parse(text.slice(from, i + 1));
      }
    }
    return null;
  }

  function allArraysAfter(text, key) {
    const out = [];
    for (let i = text.indexOf(`"${key}":[`); i >= 0; i = text.indexOf(`"${key}":[`, i + 1)) {
      out.push(arrayAfter(text.slice(i), key));
    }
    return out;
  }

  async function post(url, body) {
    const r = await fetch(url, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).catch((e) => ({ ok: false, status: 0, json: async () => ({ error: String(e) }) }));
    const json = await r.json().catch(() => null);
    return { ok: r.ok, status: r.status, body: json };
  }

  /** New contributions per section: acceptable ids and those waiting for a speaker.
   *  `matching` only has id/status; which ones are gossip shows in contributionRows(). */
  async function contributions() {
    const out = {};
    for (const s of SECTIONS) {
      const ready = (arrayAfter(await flight(`/${LANG}/contributions/${s}?client=all`), "matching") ?? []).filter((r) => r.status === "new");
      const row = { ready: ready.map((r) => r.id) };
      if (s === "quests") {
        const blocked = (await blockedRows()).filter((r) => r.status === "new");
        const other = [];
        for (const r of blocked) if (await isOtherClient(r)) other.push(r.id);
        row.blocked = blocked.length - other.length;
        row.blockedOther = other.length;
      }
      out[s] = row;
    }
    return out;
  }

  /** Every row waiting for a speaker, across all pages (100 per page). */
  async function blockedRows() {
    const seen = new Map();
    for (let page = 1; page <= 20; page++) {
      const rows = arrayAfter(await flight(`/${LANG}/contributions/quests?client=all&bucket=blocked&page=${page}`), "initial") ?? [];
      const before = seen.size;
      for (const r of rows) seen.set(r.id, r);
      if (!rows.length || seen.size === before) break;
    }
    return [...seen.values()];
  }

  // Like lib/quests/line-client.ts (PR #909): the site shows and voices only Era + Forever. A row
  // from another client (TBC Anniversary, 1.12, 3.3.5a, Retail), or a quest below 13000 the Classic
  // corpus lacks (Wowhead TBC imports carry a Forever build), is not an open item.
  const FOCUS = ["era", "forever"];
  const enQuest = new Map();
  async function isOtherClient(r) {
    if (r.client?.family && !FOCUS.includes(r.client.family)) return true;
    const q = r.quest && r.quest !== "gossip" ? r.quest.questId : null;
    if (q == null || q >= 13000) return false;
    if (!enQuest.has(q)) {
      const hit = await json(`/api/quests/search?lang=enUS&client=all&line=q:${q}:${r.quest.stage}`);
      enQuest.set(q, (hit.lines ?? []).some((l) => !l.clientFamily || FOCUS.includes(l.clientFamily)));
    }
    return !enQuest.get(q);
  }

  /** A contributions tab's rows with text, to check before accepting. Pages until every id is
   *  found (the table shows one page per request), at most `maxPages`. */
  async function contributionRows(section, ids, maxPages = 10) {
    const want = new Set(ids);
    const found = new Map();
    for (let page = 1; page <= maxPages && found.size < want.size; page++) {
      const rows = arrayAfter(await flight(`/${LANG}/contributions/${section}?client=all&page=${page}`), "initial") ?? [];
      if (!rows.length) break;
      for (const r of rows) if (want.has(r.id)) found.set(r.id, r);
    }
    return [...found.values()];
  }

  /** Open corrections of every section, with corpus text (before) and player text (after). */
  async function corrections() {
    const out = [];
    for (const s of SECTIONS) {
      // /corrections redirects to ?show=corrections, and the page carries two "initial" arrays:
      // the first (empty) for rows, the second, with `wordings`, for the corrections.
      const text = await flight(`/${LANG}/contributions/${s}?client=all&show=corrections`);
      const rows = allArraysAfter(text, "initial").find((a) => a?.length && a[0].wordings !== undefined) ?? [];
      for (const r of rows) {
        if (r.status !== "new") continue;
        // A row carries `wordings` (every wording of the corpus line) and `closest` (the most
        // similar) instead of `lineId`/`before` (PR #577). The old shape stays as a fallback.
        const w = r.wordings?.[r.closest ?? 0];
        out.push({ section: s, id: r.id, lineId: w?.lineId ?? r.lineId, wordings: r.wordings?.length ?? null, quest: r.quest?.title, npc: r.npc?.npcName, count: r.count, before: w?.before ?? r.before, after: r.after });
      }
    }
    return out;
  }

  /** resolve-many in chunks of 200. Returns accepted ids and refused ids with the reason. */
  async function accept(ids) {
    const accepted = [];
    const refused = {};
    for (let i = 0; i < ids.length; i += 200) {
      const chunk = ids.slice(i, i + 200);
      const r = await post("/api/contributions/resolve-many", { ids: chunk, status: "accepted" });
      for (const id of chunk) {
        const res = r.body?.results?.[id];
        if (r.ok && res?.ok) accepted.push(id);
        else refused[id] = res?.error ?? r.body?.error ?? `HTTP ${r.status}`;
      }
    }
    return { accepted, refused };
  }

  async function acceptCorrection(id) {
    const r = await post("/api/contributions/correction", { id, status: "accepted" });
    return r.ok ? { ok: true } : { ok: false, error: r.body?.error ?? `HTTP ${r.status}` };
  }

  /** Accept a correction as another wording of the moment: the corpus line stays, the player's
   *  is added (acceptAsWording). For variants, not for fixes. */
  async function acceptWording(id) {
    const r = await post("/api/contributions/correction", { id, status: "accepted", as: "wording" });
    return r.ok ? { ok: true } : { ok: false, error: r.body?.error ?? `HTTP ${r.status}` };
  }

  /** Reject new contributions or corrections, in chunks of 200. Only rows with status "new":
   *  rejecting an already written quest row would ignore its line. */
  async function reject(ids) {
    const rejected = [];
    const refused = {};
    for (let i = 0; i < ids.length; i += 200) {
      const chunk = ids.slice(i, i + 200);
      const r = await post("/api/contributions/resolve-many", { ids: chunk, status: "rejected" });
      for (const id of chunk) {
        const res = r.body?.results?.[id];
        if (r.ok && res?.ok) rejected.push(id);
        else refused[id] = res?.error ?? r.body?.error ?? `HTTP ${r.status}`;
      }
    }
    return { rejected, refused };
  }

  async function json(url) {
    return fetch(url, { credentials: "include" }).then((r) => r.json());
  }

  // Audio reports (/<lang>/reports/<section>). The page groups by line, 50 lines per page.
  const REPORT_SECTIONS = ["quests", "readables", "places", "bosses"];

  /** Every open report of the language, grouped by line, with the text the client showed. */
  async function reports() {
    const out = [];
    for (const s of REPORT_SECTIONS) {
      for (let page = 1; page <= 10; page++) {
        const groups = arrayAfter(await flight(`/${LANG}/reports/${s}?page=${page}`), "groups") ?? [];
        for (const g of groups) {
          const open = g.reports.filter((r) => r.status === "open");
          if (!open.length) continue;
          out.push({
            section: s,
            lineId: open[0].lineId,
            target: open[0].target,
            ids: open.map((r) => r.id),
            reports: open.map((r) => ({ id: r.id, category: r.category, body: r.body, at: r.createdAt.slice(0, 10), pack: r.context?.fields?.packVersion ?? null, npc: r.context?.fields?.npc ?? null, gameText: r.context?.text ?? null })),
          });
        }
        if (groups.length < 50) break;
      }
    }
    return out;
  }

  /** How the site sees a quest line today: text, audio, stale, override, voice. */
  async function questLine(lineId) {
    const r = await json(`/api/quests/search?lang=${LANG}&client=all&line=${encodeURIComponent(lineId)}`);
    const l = (r.lines ?? []).find((x) => x.lineId === lineId) ?? (r.lines ?? [])[0];
    if (!l) return null;
    // The search's `english` is only NPC name and quest title; the enUS search gives the English text.
    const en = await json(`/api/quests/search?lang=enUS&client=all&line=${encodeURIComponent(l.lineId)}`);
    const enText = (en.lines ?? []).find((x) => x.lineId === l.lineId)?.text ?? null;
    return { lineId: l.lineId, variant: l.variant, text: l.text, originalText: l.originalText, enText, isEnglish: enText !== null && l.text === enText, skipReason: l.skipReason, voice: l.voice, npc: `${l.npcId} ${l.npcName}`, hasAudio: l.hasAudio, stale: l.stale, take: l.take, override: l.override, file: l.fileName, ignored: l.ignored, clientFamily: l.clientFamily ?? null };
  }

  /** What a report's client text is to the corpus: missing (new), known, changed (a correction). */
  async function reportText(id) {
    const r = await fetch(`/api/reports/contribute?id=${id}`, { credentials: "include" });
    return r.ok ? r.json() : { error: (await r.json().catch(() => null))?.error ?? `HTTP ${r.status}` };
  }

  /** Accept a report's text: as a new line, as a fix (pick) or as a wording.
   *  Sets the report itself to fixed. */
  async function acceptReportText(id, opts = {}) {
    const r = await post("/api/reports/contribute", { id, ...opts });
    return r.ok ? { ok: true } : { ok: false, error: r.body?.error ?? `HTTP ${r.status}` };
  }

  /** Close reports: fixed, not_an_issue or minor. */
  async function resolveReports(ids, status) {
    const done = [];
    const refused = {};
    for (const id of ids) {
      const r = await post("/api/reports/resolve", { id, status });
      if (r.ok) done.push(id);
      else refused[id] = r.body?.error ?? `HTTP ${r.status}`;
    }
    return { done, refused };
  }

  /** What a quest line speaks instead of its text (the team's override, spoken only). */
  async function overrideLine(file, lineId, text) {
    // The route wants the path, not questLine()'s file name: quests/<name>.mp3, or for gossip
    // lines (g:…) gossip/<name>.mp3; otherwise it answers "unknown file".
    if (!file.includes("/")) file = `${lineId.startsWith("g:") ? "gossip" : "quests"}/${file}.mp3`;
    const r = await fetch(`/api/quests/lines/override?lang=${LANG}`, {
      method: "PUT",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ file, lineId, text }),
    });
    const body = await r.json().catch(() => null);
    return r.ok ? { ok: true, body } : { ok: false, error: body?.error ?? `HTTP ${r.status}` };
  }

  // Every source but progress (apps/web/src/lib/line-fields.ts SOURCES).
  const DAILY_SOURCES = "accept,complete,gossip,followup,chatter";
  // "Not done": no audio, stale audio, or a take of a model outside doneModels.
  async function filterSets(section) {
    const base = `/api/${section}/search?lang=${LANG}`;
    const first = await json(base);
    const models = (first.madeBy?.models ?? []).filter((m) => !V4.includes(m));
    // Progress text is voiceable since migration 0108. It is a filter of its own, so its backlog
    // does not push the daily round over the voicing cap.
    const missing = section === "quests" ? [`state=missing&source=${DAILY_SOURCES}`, "state=missing&source=progress"] : ["state=missing"];
    return { base, sets: [...missing, "state=stale", ...models.map((m) => `model=${encodeURIComponent(m)}`)] };
  }

  /** What to voice, per section and filter, with character counts. Quests include gossip. */
  async function plan() {
    const out = {};
    for (const section of ["quests", "places", "readables", "bosses"]) {
      const { base, sets } = await filterSets(section);
      out[section] = [];
      for (const f of sets) {
        // Bosses: only those with a story in the language; the queue has nothing to speak for the rest.
        const r = await json(`${base}&${f}${section === "bosses" ? "&ids=1" : ""}`);
        out[section].push({ filter: f, total: r.total, chars: r.totalChars ?? null });
      }
    }
    return out;
  }

  /** Every id of a places, readables or bosses filter, page by page (100 per page). */
  async function ids(section, filter) {
    // Bosses without a story are listed too; ids=1 returns only the written ones.
    if (section === "bosses") return (await json(`/api/bosses/search?lang=${LANG}&${filter}&ids=1`)).ids ?? [];
    const base = `/api/${section}/search?lang=${LANG}&${filter}`;
    const found = [];
    for (let page = 1; ; page++) {
      const r = await json(`${base}&page=${page}`);
      for (const l of r.lines ?? []) found.push(l.id);
      if (!r.lines?.length || found.length >= r.total) break;
    }
    return found;
  }

  // Queue sources are named like the sections: quests, places, readables, bosses.
  /** A quests batch by filter, or a places/readables/bosses batch by ids. */
  async function queue(section, arg, label) {
    const body =
      section === "quests"
        ? { source: "quests", filters: arg, label }
        : { source: section, lineIds: arg, label };
    return post(`/api/regenerate/queue?lang=${LANG}`, body);
  }

  /** The queue's state, narrowed to the language. */
  async function status() {
    const r = await json("/api/regenerate/queue");
    const mine = (list) => (list ?? []).filter((j) => !j.lang || j.lang === LANG);
    return {
      active: r.active,
      cursor: r.cursor,
      counts: r.counts,
      credits: r.credits,
      paused: (r.paused ?? []).filter((p) => p.lang === LANG),
      running: mine(r.running).length,
      queues: mine(r.queues),
      failures: mine(r.failures).map((f) => ({ lineId: f.lineId, error: f.error ?? f.message })),
    };
  }

  /** What finished voicing since a status().cursor, by gossip/quests and new/re-voiced. */
  async function voiced(since) {
    const seen = new Set();
    // other = places and readables.
    const counts = { gossipNew: 0, questsNew: 0, progressNew: 0, bossesNew: 0, revoiced: 0, other: 0 };
    for (let cursor = since, i = 0; i < 20; i++) {
      const r = await json(`/api/regenerate/queue?since=${cursor}`);
      const done = r.finished ?? [];
      for (const j of done) {
        if (j.lang !== LANG || seen.has(j.id)) continue;
        seen.add(j.id);
        if (j.version > 1) counts.revoiced++;
        else if (j.lineId.startsWith("g:")) counts.gossipNew++;
        else if (/^q:\d+:progress/.test(j.lineId)) counts.progressNew++;
        else if (j.lineId.startsWith("q:")) counts.questsNew++;
        else if (j.lineId.startsWith("boss:")) counts.bossesNew++;
        else counts.other++;
      }
      if (done.length < 500 || r.cursor === cursor) break;
      cursor = r.cursor;
    }
    return { total: seen.size, ...counts };
  }

  return { voiced, flight, arrayAfter, contributions, contributionRows, corrections, accept, acceptCorrection, acceptWording, reject, reports, questLine, reportText, acceptReportText, resolveReports, overrideLine, plan, ids, queue, status };
})(window.__spokenCfg);
`__spoken loaded for ${window.__spokenCfg.lang}`;
