"use client";

import { useLang } from "@/components/LangProvider";
import { langName, withLang, type Lang } from "@/lib/lang";
import { Check, Pencil, RefreshCw, Search, Trash2, Undo2 } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { EffectiveLexicon } from "@/lib/generation/dictionary";
import { fishReadsPhonemes, fishUse, type FishUse } from "@/lib/generation/fish-lexicon";
import type { Provider } from "@/lib/generation/providers";
import { PREVIEW_MODES, type PreviewMode } from "@/lib/generation/preview-modes";
import type { CacheState } from "@/lib/generation/preview";
import { Toaster, useToast } from "@/components/ui/toast";
import { booksHref, questsHref, zonesHref } from "@/lib/links";
import {
  honoursPhonemes,
  kindOf,
  LexiconError,
  validateLexicon,
  type LexiconEntry,
} from "@/lib/generation/lexicon";

type Saved = EffectiveLexicon & { syncError?: string | null };

const MODE_LABELS: Record<PreviewMode, string> = {
  word: "Word",
  sentence: "In a line",
};

const EMPTY_CACHE: CacheState = { word: false, sentence: false };

/**
 * What every field in an open row shares.
 *
 * Focus is the border alone rather than the ring Input draws by default: a ring is painted
 * outside the border, and these fields sit edge to edge inside a bordered list, so the first
 * and last one's ring was drawn under its neighbour and read as a half-missing outline.
 *
 * The placeholder is fainter than the default because this page is skimmed for what is still
 * missing: at full muted-foreground weight, "silent G" in an empty note is hard to tell from
 * a note that says silent G.
 */
const FIELD =
  "h-7 text-sm placeholder:text-muted-foreground/45 focus-visible:ring-0 focus-visible:border-ring";

type OkFilter = "all" | "yes" | "no";

const OK_FILTERS: { value: OkFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "yes", label: "OK" },
  { value: "no", label: "Not OK" },
];

/**
 * Where this name is spoken, in each explorer.
 *
 * A name is said in all three corpora, and a respelling that suits a quest line suits the
 * zone intro and the book page too - so all three are one click away rather than only the
 * one this page happened to link to first.
 *
 * The text-only scope is the question being asked here: not which NPC is called Gnomeregan,
 * but which lines say it. It is `filter` in quests and `field` in the other two - three
 * filter vocabularies, three modules - which is why each link goes through its own helper.
 * The URL is each explorer's own source of truth for a search, so these are working deep
 * links rather than pages that arrive blank and have to be retyped into.
 */
const SECTIONS = [
  { letter: "Q", what: "quest lines", href: (q: string) => questsHref({ q, filter: "text" }) },
  { letter: "Z", what: "zone lore", href: (q: string) => zonesHref({ q, field: "text" }) },
  { letter: "B", what: "book pages", href: (q: string) => booksHref({ q, field: "text" }) },
] as const;

// Both fields open, because either or both may be filled: the IPA for whoever can write it,
// the respelling for whoever cannot, and for fish.audio outside English, which reads no IPA.
// A field left empty is dropped by validation rather than stored.
const BLANK: LexiconEntry = {
  grapheme: "",
  ipa: "",
  alias: "",
  confidence: "check",
};

/** The widths the header and every row share, so the columns line up. */
const IPA_WIDTH = "w-44";
const RESPELLING_WIDTH = "w-36";

function key(entry: LexiconEntry): string {
  return entry.grapheme.toLowerCase();
}

// `base` so Aku'mai and Aku'Mai sort together rather than by code point, and `numeric` for
// the day a name ends in a digit. A new entry's grapheme is empty, which collates first -
// which is where it should be, since it is the one being typed.
const COLLATOR = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

function same(a: LexiconEntry[], b: LexiconEntry[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

type PreviewMeta = {
  mode: PreviewMode;
  spoken: string;
  sentence: string;
  source: { npcName: string; lineId: string } | null;
  cached: boolean;
  characters: number;
  credits: number | null;
};

/**
 * Rendering one entry and playing it.
 *
 * Owned here rather than by each row so that only one preview is ever audible: starting a
 * second stops the first, because two pronunciations played over each other is worse than
 * useless for the one thing this is for. Only the pressed button is disabled, though -
 * waiting on a render is no reason the rest of the table should go dead.
 *
 * What it costs is reported by toast rather than in the row. A line of text under the row
 * would push everything below it down, moving the next button just as someone reaches for
 * it, and a preview served from cache has nothing to say at all - it just plays.
 */
function usePreview(onCached: (grapheme: string, mode: PreviewMode) => void) {
  const [busy, setBusy] = useState<{ index: number; mode: PreviewMode } | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const url = useRef<string | null>(null);
  const toast = useToast();

  function release() {
    audio.current?.pause();
    // Object URLs are not garbage collected while the document lives, so a page left open
    // through fifty previews would hold fifty mp3s in memory.
    if (url.current) URL.revokeObjectURL(url.current);
    url.current = null;
  }

  useEffect(() => release, []);

  async function play(entry: LexiconEntry, mode: PreviewMode, index: number, force = false) {
    release();
    setBusy({ index, mode });
    try {
      const response = await fetch("/api/generation/lexicon/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entry, mode, force }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        toast({
          tone: "error",
          title: `Could not preview ${entry.grapheme}`,
          detail: body.error ?? `request failed (${response.status})`,
        });
        return;
      }

      const header = response.headers.get("X-Preview");
      const meta = header ? (JSON.parse(decodeURIComponent(header)) as PreviewMeta) : null;

      // Silence on a cache hit is the point: nothing was spent, so there is nothing to say.
      if (meta && !meta.cached) {
        toast({
          tone: "info",
          title: `${meta.characters} characters${
            meta.credits === null ? "" : `, ${meta.credits} credits`
          }`,
          detail:
            meta.mode === "word"
              ? `${entry.grapheme}, on its own`
              : meta.source
                ? `${meta.source.npcName}: “${meta.sentence}”`
                : `No corpus line is short enough, so this is an invented sentence.`,
        });
      }
      if (meta) onCached(entry.grapheme, meta.mode);

      url.current = URL.createObjectURL(await response.blob());
      audio.current = new Audio(url.current);
      await audio.current.play();
    } catch (caught) {
      toast({
        tone: "error",
        title: `Could not preview ${entry.grapheme}`,
        detail: caught instanceof Error ? caught.message : String(caught),
      });
    } finally {
      setBusy(null);
    }
  }

  return { play, busy };
}

/**
 * The pronunciation lexicon, and the one place it can be corrected without a deploy.
 *
 * Admin-only, on its own page rather than beside the generation settings: 134 entries is a
 * list you search, and a name is fixed in response to hearing it rather than while setting
 * up a batch.
 *
 * Rows are read-only until one is opened. A page of 134 simultaneously editable rows is
 * both slower and harder to review - an accidental keystroke in a field nobody meant to
 * touch would ship as a mispronunciation, and the diff against the committed file is what
 * makes that visible.
 */
export default function LexiconEditor(props: {
  initial: EffectiveLexicon;
  modelId: string;
  provider: Provider;
  initialCache: Record<string, CacheState>;
}) {
  // A shell, because useToast has to find a provider above the component that calls it and
  // the editor itself is what raises the toasts.
  return (
    <Toaster>
      <Editor {...props} />
    </Toaster>
  );
}

function Editor({
  initial,
  modelId,
  provider,
  initialCache,
}: {
  initial: EffectiveLexicon;
  /** The model generation actually uses, which decides whether any of this takes effect. */
  modelId: string;
  /** The generator this viewer speaks this language with, which decides which column counts. */
  provider: Provider;
  /** Which previews already exist, resolved on the server. See previewCache. */
  initialCache: Record<string, CacheState>;
}) {
  const lang = useLang();
  const [saved, setSaved] = useState<Saved>(initial);
  const [draft, setDraft] = useState<LexiconEntry[]>(initial.entries);
  // Identified by position, not by grapheme. A grapheme is editable, so keying the open row
  // on its value would close the form the moment the first character of a name was changed.
  const [editing, setEditing] = useState<number | null>(null);
  // The name the open row sorted under when it was opened. Rows are ordered by grapheme, so
  // without this an open form would move on every keystroke of the name being typed - out
  // from under the cursor, and past whichever rows the new spelling had overtaken.
  const [pinned, setPinned] = useState("");
  const [query, setQuery] = useState("");
  // Which side of the OK column to show. "no" is the working view - the entries nobody has
  // confirmed yet are the ones still to be listened to.
  const [ok, setOk] = useState<OkFilter>("all");
  // The last removal, held so it can be put back. A removed entry is otherwise unrecoverable
  // until a save - the draft is the only copy of an edit, and a mis-clicked remove would take
  // the pronunciation with it.
  const [removed, setRemoved] = useState<{ entry: LexiconEntry; index: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Seeded from the server and kept up to date as previews are rendered, so a re-roll button
  // lights up the moment the take it would replace exists.
  const [cache, setCache] = useState(initialCache);
  const preview = usePreview((grapheme, mode) =>
    setCache((current) => ({
      ...current,
      [grapheme]: { ...(current[grapheme] ?? EMPTY_CACHE), [mode]: true },
    })),
  );

  const dirty = !same(draft, saved.entries);

  // fish.audio in a language it reads no phonemes in: only the respelling reaches the audio,
  // and the page has to say so, or an IPA column full of careful work reads as if it counted.
  const respellingOnly = provider === "fish" && !fishReadsPhonemes(lang);
  const unrespelled = draft.filter((entry) => !entry.alias?.trim()).length;

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return draft
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry }) => {
        const confirmed = entry.confidence === "high";
        if (ok === "yes" && !confirmed) return false;
        if (ok === "no" && confirmed) return false;
        if (!needle) return true;
        return [entry.grapheme, entry.ipa ?? "", entry.alias ?? "", entry.note ?? ""]
          .join(" ")
          .toLowerCase()
          .includes(needle);
      })
      // Alphabetical, and note this sorts the VIEW rather than the draft: `index` is the
      // position in the draft array and stays with its entry, so editing and removal keep
      // pointing at the right one. Sorting the draft itself would also rewrite the stored
      // order on every save, turning a one-word fix into a 134-entry diff.
      .sort((a, b) => COLLATOR.compare(sortName(a), sortName(b)));

    function sortName({ entry, index }: { entry: LexiconEntry; index: number }): string {
      return index === editing ? pinned : entry.grapheme;
    }
  }, [draft, query, ok, editing, pinned]);

  /**
   * The rows to draw: what the filter shows, with the last removal still standing in place.
   *
   * The gap an entry left is where someone looks for it, so the undo is a row of the same
   * height where the row was, rather than a message under the table that moves everything
   * between here and there. It ignores the filter and the search box - a tombstone that
   * matched neither would vanish along with the offer to bring the entry back.
   */
  const rows = useMemo(() => {
    const entries = shown.map((row) => ({ kind: "entry" as const, ...row }));
    if (!removed) return entries;

    const at = entries.findIndex(
      (row) => COLLATOR.compare(row.entry.grapheme, removed.entry.grapheme) > 0,
    );
    const tombstone = { kind: "tombstone" as const, entry: removed.entry, index: -1 };
    return at === -1
      ? [...entries, tombstone]
      : [...entries.slice(0, at), tombstone, ...entries.slice(at)];
  }, [shown, removed]);

  const checks = draft.filter((entry) => entry.confidence === "check").length;

  function patch(target: number, change: Partial<LexiconEntry>) {
    setDraft((current) =>
      current.map((entry, index) => (index === target ? { ...entry, ...change } : entry)),
    );
  }

  function openRow(index: number, entry: LexiconEntry) {
    setEditing(index);
    setPinned(entry.grapheme);
  }

  function remove(target: number) {
    setRemoved({ entry: draft[target], index: target });
    setDraft((current) => current.filter((_, index) => index !== target));
    setEditing(null);
  }

  // Back where it was, not appended: the stored order is what the saved document keeps, so
  // restoring to the end would turn an undone mistake into a diff across the whole file.
  function undo() {
    if (!removed) return;
    setDraft((current) => [
      ...current.slice(0, removed.index),
      removed.entry,
      ...current.slice(removed.index),
    ]);
    setRemoved(null);
  }

  function add(grapheme = "") {
    const entry = { ...BLANK, grapheme };
    // Prepended and opened, so a new entry is never added below the fold of a filtered list
    // where it would look as though nothing happened.
    setDraft((current) => [entry, ...current]);
    // Pinned to the name it was opened with, so a new entry stays where it started while it
    // is being typed instead of sliding away as the name takes shape.
    openRow(0, entry);
    setQuery("");
    setOk("all");
    // Prepending shifts every index by one, and `removed.index` is a position in the draft:
    // an undo taken afterwards would put the entry back one place from where it left.
    setRemoved(null);
  }

  /**
   * Arrive with a name already in the box.
   *
   * /issues links here with ?grapheme=Kel'Theril, so "this name is mispronounced" and "here
   * is how to say it" are one click apart rather than a name to retype. Only ever on the
   * first render for a given name: re-running it would reopen a row someone had closed, and
   * re-adding one they had deliberately removed.
   */
  const requested = useSearchParams().get("grapheme");
  const seeded = useRef<string | null>(null);
  useEffect(() => {
    if (!requested || seeded.current === requested) return;
    seeded.current = requested;

    // An entry may already exist for it - the finding was loaded before the lexicon grew, or
    // someone followed the link twice. Open that rather than adding a duplicate the validator
    // would reject on save.
    const existing = draft.findIndex(
      (entry) => entry.grapheme.toLowerCase() === requested.toLowerCase(),
    );
    if (existing >= 0) openRow(existing, draft[existing]);
    else add(requested);
    // draft is deliberately not a dependency: this runs once per requested name, and reacting
    // to every edit of the draft is exactly what the guard above exists to prevent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requested]);

  async function send(method: "PUT" | "POST" | "DELETE") {
    // Checked here as well as on the server so a malformed draft is a message next to the
    // field rather than a round trip: the server's copy is the one that counts, but it is
    // not the one that can point at the entry.
    if (method === "PUT") {
      try {
        validateLexicon(draft);
      } catch (caught) {
        setError(caught instanceof LexiconError ? caught.message : String(caught));
        return;
      }
    }

    setBusy(true);
    setError(null);
    try {
      const response = await fetch(withLang(lang, "/api/generation/lexicon"), {
        method,
        headers: method === "PUT" ? { "Content-Type": "application/json" } : undefined,
        body: method === "PUT" ? JSON.stringify(draft) : undefined,
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error ?? `request failed (${response.status})`);
        return;
      }
      const next = body as Saved;
      setSaved(next);
      setDraft(next.entries);
      setEditing(null);
      // The removal is in force now, and an undo against a draft it no longer indexes would
      // put the entry back in the wrong place.
      setRemoved(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <SyncBanner
        saved={saved}
        modelId={modelId}
        phonemes={draft.filter((entry) => kindOf(entry) === "ipa").length}
        busy={busy}
        onRetry={() => void send("POST")}
      />

      {respellingOnly && (
        <Banner tone="info">
          <span>
            You generate {langName(lang)} with fish.audio, which reads no IPA outside English: it
            speaks the <strong>Respelling</strong> column, and the IPA is never sent.{" "}
            {unrespelled > 0
              ? `${unrespelled} ${unrespelled === 1 ? "entry has" : "entries have"} no respelling, so fish.audio says ${unrespelled === 1 ? "it" : "them"} unaided.`
              : "Every entry has one."}
          </span>
        </Banner>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter by name, sound, or note"
          className="max-w-xs"
          aria-label="Filter entries"
        />
        <div className="flex items-center gap-1" role="group" aria-label="Filter by OK">
          {OK_FILTERS.map(({ value, label }) => (
            <Button
              key={value}
              size="sm"
              variant={ok === value ? "secondary" : "ghost"}
              aria-pressed={ok === value}
              onClick={() => setOk(value)}
            >
              {label}
              {value === "no" && ` · ${checks}`}
            </Button>
          ))}
        </div>
        <Button size="sm" variant="ghost" onClick={() => add()}>
          Add name
        </Button>
        <span className="text-muted-foreground ml-auto text-xs tabular-nums">
          {shown.length === draft.length
            ? `${draft.length} entries`
            : `${shown.length} of ${draft.length}`}
        </span>
      </div>

      <div className="divide-y rounded-md border">
        {/* Column names, aligned to the widths the rows below use. Not a <table>, because the
            fields a row edits in place are inputs, and an input inside a table cell inherits
            the column width it needs to escape. */}
        <div
          aria-hidden
          className="text-muted-foreground bg-muted/40 flex items-center gap-3 px-3 py-1.5 text-[10.5px] font-semibold tracking-wider uppercase"
        >
          {/* Matches the checkbox's own width, so the columns below line up under their names. */}
          <span className="w-4 shrink-0" title="Confirmed">
            OK
          </span>
          <span className="flex flex-1 gap-3 overflow-hidden">
            <span className="w-40 shrink-0">Written</span>
            <span
              className={cn(IPA_WIDTH, "shrink-0", respellingOnly && "text-muted-foreground/50")}
              title={respellingOnly ? "ElevenLabs only: fish.audio reads no IPA in this language." : undefined}
            >
              IPA{respellingOnly && " · ElevenLabs"}
            </span>
            <span
              className={cn(RESPELLING_WIDTH, "shrink-0", respellingOnly && "text-primary")}
              title={respellingOnly ? "What fish.audio speaks in this language." : undefined}
            >
              Respelling{respellingOnly && " · fish"}
            </span>
            {/* Over each row's FishBadge, which is the same width. */}
            <span className="w-24 shrink-0">fish.audio</span>
            <span className="truncate">Note</span>
          </span>
          <span className="shrink-0">Edit · find · hear · re-roll</span>
        </div>

        {rows.length === 0 && (
          <p className="text-muted-foreground px-4 py-8 text-center text-sm">
            Nothing matches that filter.
          </p>
        )}

        {rows.map(({ kind, entry, index }) =>
          kind === "tombstone" ? (
            <Tombstone
              key="tombstone"
              entry={entry}
              onUndo={undo}
              onDismiss={() => setRemoved(null)}
            />
          ) : (
            <Row
              key={index}
              entry={entry}
              index={index}
              lang={lang}
              respellingOnly={respellingOnly}
              editing={editing === index}
              cached={cache[entry.grapheme] ?? EMPTY_CACHE}
              preview={preview}
              onChange={(change) => patch(index, change)}
              onOpen={() => openRow(index, entry)}
              onClose={() => setEditing(null)}
              onRemove={() => remove(index)}
              onConfirm={(confirmed) => patch(index, { confidence: confirmed ? "high" : "check" })}
            />
          ),
        )}
      </div>

      {error && (
        <div
          role="alert"
          className="border-destructive/40 bg-destructive/10 text-destructive rounded-md border px-3 py-2 text-sm"
        >
          {error}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={!dirty || busy} onClick={() => void send("PUT")}>
          {busy ? "Saving…" : "Save and upload"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={!dirty || busy}
          onClick={() => {
            setDraft(saved.entries);
            setEditing(null);
            setRemoved(null);
          }}
        >
          Discard
        </Button>
      </div>

      <p className="text-muted-foreground text-xs">
        Saving uploads a new dictionary and every line generated afterwards uses it. Audio
        already in the store is untouched: its version row records the dictionary it was made
        with, so a line generated before a fix stays playable and identifiable as stale.
      </p>
    </div>
  );
}

/**
 * Whether the entries on this page are the ones ElevenLabs is actually applying.
 *
 * Its own component because there are three independent ways this page can be showing
 * pronunciations that no generation will use — never uploaded, upload failed, or a model
 * that ignores phoneme rules — and each of them needs a different sentence.
 */
function SyncBanner({
  saved,
  modelId,
  phonemes,
  busy,
  onRetry,
}: {
  saved: Saved;
  modelId: string;
  /** How many entries reach ElevenLabs as IPA, and so depend on the model honouring phoneme rules. */
  phonemes: number;
  busy: boolean;
  onRetry: () => void;
}) {
  // Counted rather than stated as a blanket warning: on a model without phoneme support the
  // respelled entries still work, so "nothing on this page reaches the audio" would be false
  // and would send someone hunting for a problem in the wrong place.
  if (!honoursPhonemes(modelId) && phonemes > 0) {
    return (
      <Banner tone="warn">
        <span>
          Generation uses <code>{modelId}</code>, which ignores phoneme rules — only{" "}
          <code>eleven_v3</code> and <code>eleven_flash_v2</code> honour them. {phonemes} entries
          with IPA are skipped, even those that also have a respelling, since ElevenLabs is sent
          the IPA; entries with only a respelling still apply. Switch the model on Voices.
        </span>
      </Banner>
    );
  }

  if (!saved.seeded) {
    return (
      <Banner tone="error">
        <span>
          The lexicon table is empty. Migration <code>0008</code> seeds it — if you are seeing
          this, migrations have not run against this database. Do not retype the entries;
          run them.
        </span>
      </Banner>
    );
  }

  if (saved.sync === "never") {
    return (
      <Banner tone="warn">
        <span>
          No dictionary has been uploaded yet, so lines are generated without one. Save to put
          these {saved.entries.length} pronunciations in force.
        </span>
        {/* A seeded lexicon arrives saved but never uploaded, and Save stays disabled until
            something is edited - so without this the only way to put a seed in force would
            be a throwaway edit. */}
        {saved.entries.length > 0 && (
          <Button size="sm" variant="outline" disabled={busy} onClick={onRetry}>
            {busy ? "Uploading…" : "Upload"}
          </Button>
        )}
      </Banner>
    );
  }

  // Louder than a footnote, because this is the shape of the bug that made the whole page a
  // no-op for weeks: a dictionary in force, reporting success, holding a fraction of its rules.
  if (
    saved.sync === "synced" &&
    saved.rulesKept !== null &&
    saved.rulesSent !== null &&
    saved.rulesKept < saved.rulesSent
  ) {
    return (
      <Banner tone="error">
        <span>
          ElevenLabs kept only {saved.rulesKept} of the {saved.rulesSent} rules uploaded. The
          dictionary is in force but incomplete, so some names below are not being applied.
        </span>
        <Button size="sm" variant="outline" disabled={busy} onClick={onRetry}>
          {busy ? "Uploading…" : "Upload again"}
        </Button>
      </Banner>
    );
  }

  if (saved.sync === "pending") {
    return (
      <Banner tone="error">
        <span>
          Saved, but not uploaded{saved.syncError ? `: ${saved.syncError}` : ""}. Generation is
          still applying the previous dictionary, so the entries below are not what lines
          currently sound like.
        </span>
        <Button size="sm" variant="outline" disabled={busy} onClick={onRetry}>
          {busy ? "Uploading…" : "Retry upload"}
        </Button>
      </Banner>
    );
  }

  return (
    <p className="text-muted-foreground text-xs">
      In force since {saved.syncedAt ? new Date(saved.syncedAt).toLocaleString() : "—"} · version{" "}
      <code>{saved.locator?.versionId}</code>
      {saved.rulesKept !== null && <> · {saved.rulesKept} rules</>}
    </p>
  );
}

function Banner({
  tone,
  children,
}: {
  tone: "info" | "warn" | "error";
  children: React.ReactNode;
}) {
  return (
    <div
      // "info" is a standing fact about the page rather than something that went wrong, so it
      // is not announced as an alert.
      role={tone === "info" ? "status" : "alert"}
      className={cn(
        "flex flex-wrap items-center gap-3 rounded-md border px-3 py-2 text-sm",
        tone === "info" && "border-primary/30 bg-primary/5",
        tone === "warn" && "border-amber-500/40 bg-amber-500/10 text-amber-300",
        tone === "error" && "border-destructive/40 bg-destructive/10 text-destructive",
      )}
    >
      {children}
    </div>
  );
}

/**
 * Where an entry was, until it is put back or the save makes the removal real.
 *
 * Built to the height of a row rather than to its own: the list is scanned by position, and a
 * shorter placeholder would slide every row below it up the moment something was removed and
 * back down the moment it was restored.
 */
function Tombstone({
  entry,
  onUndo,
  onDismiss,
}: {
  entry: LexiconEntry;
  onUndo: () => void;
  onDismiss: () => void;
}) {
  return (
    <div
      role="status"
      className="bg-destructive/5 text-muted-foreground flex h-10 items-center gap-3 px-3 text-sm"
    >
      <span className="truncate">
        Removed <span className="text-foreground font-medium line-through">{entry.grapheme || "a new entry"}</span>
        {" — gone once you save."}
      </span>
      <div className="ml-auto flex shrink-0 items-center gap-1">
        <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={onUndo}>
          <Undo2 className="size-3" aria-hidden /> Undo
        </Button>
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={onDismiss}>
          Dismiss
        </Button>
      </div>
    </div>
  );
}

/**
 * One entry: confirm it, hear it, re-roll it, or edit it in place.
 *
 * Editing swaps the three text cells for inputs of the same widths rather than expanding the
 * row into a form. The row keeps its height and its buttons, so the loop this page exists for
 * - hear it, change it, hear it again - never has a form opening and closing across it.
 *
 * It is entered from the pencil, not from clicking the row. The cells hold text a reviewer
 * selects and copies, and a whole row that turns into inputs when brushed is a row that
 * cannot be read.
 */
function Row({
  entry,
  index,
  lang,
  respellingOnly,
  editing,
  cached,
  preview,
  onChange,
  onOpen,
  onClose,
  onRemove,
  onConfirm,
}: {
  entry: LexiconEntry;
  index: number;
  lang: Lang;
  /** Whether the viewer's generator here reads the respelling alone. See Editor. */
  respellingOnly: boolean;
  editing: boolean;
  cached: CacheState;
  preview: ReturnType<typeof usePreview>;
  onChange: (change: Partial<LexiconEntry>) => void;
  onOpen: () => void;
  onClose: () => void;
  onRemove: () => void;
  onConfirm: (confirmed: boolean) => void;
}) {
  const playable = Boolean(entry.grapheme.trim() && (entry.ipa?.trim() || entry.alias?.trim()));

  return (
    <div
      className={cn(
        "flex items-center gap-3 px-3 py-1.5",
        editing ? "bg-muted/30" : "hover:bg-muted/50",
      )}
    >
      <Checkbox
        checked={entry.confidence === "high"}
        onCheckedChange={(value) => onConfirm(value === true)}
        aria-label={`Confirmed pronunciation for ${entry.grapheme || "this entry"}`}
        className="shrink-0"
      />

      {editing ? (
        // No overflow-hidden, unlike the row at rest: the fields are fixed widths and a
        // flex-1, so nothing here overflows, and a clip would cut the focus outline off at
        // the first and last field.
        <div className="flex flex-1 items-center gap-3">
          <Input
            value={entry.grapheme}
            onChange={(event) => onChange({ grapheme: event.target.value })}
            placeholder="Gnomeregan"
            aria-label="Written"
            title="Exactly as the corpus spells it. Matching ignores case."
            className={cn("w-40 shrink-0", FIELD)}
            autoFocus
          />
          {/* The slashes are decoration inside the field, not content: IPA is written between
              them everywhere else, and the validator rejects a rule that actually contains
              one. */}
          <div
            className={cn(
              "border-input focus-within:border-ring dark:bg-input/30 flex h-7 shrink-0 items-center gap-0.5 rounded-lg border px-2 text-sm",
              IPA_WIDTH,
            )}
            title={
              respellingOnly
                ? "ElevenLabs only: fish.audio reads no IPA in this language."
                : "Exact. ElevenLabs uses it over the respelling; only eleven_v3 and eleven_flash_v2 honour it."
            }
          >
            <span aria-hidden className="text-muted-foreground/60 select-none">
              /
            </span>
            <input
              value={entry.ipa ?? ""}
              onChange={(event) => onChange({ ipa: event.target.value })}
              placeholder="ˈnoʊmɹəɡæn"
              aria-label="IPA"
              className="placeholder:text-muted-foreground/45 w-full min-w-0 flex-1 bg-transparent outline-none"
            />
            <span aria-hidden className="text-muted-foreground/60 select-none">
              /
            </span>
          </div>
          <Input
            value={entry.alias ?? ""}
            onChange={(event) => onChange({ alias: event.target.value })}
            placeholder="nomeregan"
            aria-label="Respelling"
            title={
              respellingOnly
                ? "What fish.audio speaks in this language. Respell it as it should be said — “nomeregan”, not “NOME-reh-gan”."
                : "Respell it as it should be said — “nomeregan”, not “NOME-reh-gan”. Used where the IPA cannot be."
            }
            className={cn(RESPELLING_WIDTH, "shrink-0", FIELD)}
          />
          <Input
            value={entry.note ?? ""}
            onChange={(event) => onChange({ note: event.target.value })}
            placeholder="silent G"
            aria-label="Note"
            title="Why this entry exists, or what is disputed about it."
            className={cn("flex-1", FIELD)}
          />
        </div>
      ) : (
        <div className="flex flex-1 items-baseline gap-3 overflow-hidden">
          <span className="w-40 shrink-0 truncate text-sm font-medium">
            {entry.grapheme || <span className="text-muted-foreground">(new entry)</span>}
          </span>
          <span
            className={cn(
              IPA_WIDTH,
              "shrink-0 truncate text-sm",
              respellingOnly ? "text-muted-foreground/50" : "text-primary",
            )}
          >
            {entry.ipa ? `/${entry.ipa}/` : <span className="text-muted-foreground/40">—</span>}
          </span>
          <span className={cn(RESPELLING_WIDTH, "text-primary shrink-0 truncate text-sm")}>
            {entry.alias ? `“${entry.alias}”` : <span className="text-muted-foreground/40">—</span>}
          </span>
          <FishBadge use={fishUse(entry, lang)} />
          <span className="truncate text-xs">{entry.note}</span>
        </div>
      )}

      <div className="flex shrink-0 items-center gap-0.5">
        {/* Only while open, so the one irreversible control on the page is never a
            mis-click away from a row somebody is only reading. */}
        {editing && (
          <Button
            size="icon"
            variant="ghost"
            className="text-destructive size-6"
            title={`Remove ${entry.grapheme || "this entry"}`}
            aria-label={`Remove ${entry.grapheme || "this entry"}`}
            onClick={onRemove}
          >
            <Trash2 className="size-3" aria-hidden />
          </Button>
        )}

        <Button
          size="icon"
          variant="ghost"
          className={cn("size-6", editing ? "text-primary" : "text-muted-foreground")}
          title={editing ? "Done editing" : `Edit ${entry.grapheme || "this entry"}`}
          aria-label={editing ? "Done editing" : `Edit ${entry.grapheme || "this entry"}`}
          onClick={editing ? onClose : onOpen}
        >
          {editing ? (
            <Check className="size-3" aria-hidden />
          ) : (
            <Pencil className="size-3" aria-hidden />
          )}
        </Button>

        {/* A new tab, deliberately. The editor holds an unsaved draft - navigating away in
            this one would discard every edit made since the last save, which is a steep
            price for looking something up.

            Split rather than one Button with `disabled`, because `disabled` on a Button
            rendering `asChild` styles an anchor without disabling it: the link would still
            be clickable, and would open the explorer searching for nothing. */}
        {SECTIONS.map(({ letter, what, href }) => {
          // The letter, not three identical glasses: the three sit side by side, and which
          // corpus each one searches is the only thing that tells them apart.
          const glyph = (
            <>
              <Search className="size-3" aria-hidden />
              <span className="text-[10px] leading-none font-semibold">{letter}</span>
            </>
          );
          const label = `Find ${what} that say ${entry.grapheme}`;

          return entry.grapheme.trim() ? (
            <Button
              key={letter}
              asChild
              size="icon"
              variant="ghost"
              className="text-muted-foreground h-6 w-auto gap-0.5 px-1"
              title={label}
            >
              <a href={href(entry.grapheme)} target="_blank" rel="noreferrer" aria-label={label}>
                {glyph}
              </a>
            </Button>
          ) : (
            <Button
              key={letter}
              size="icon"
              variant="ghost"
              className="text-muted-foreground/30 h-6 w-auto gap-0.5 px-1"
              disabled
              title="Name this entry first"
            >
              {glyph}
            </Button>
          );
        })}

        {PREVIEW_MODES.map((mode) => {
          // Only the pressed button waits. Disabling the whole table while one render is in
          // flight punishes everyone for a request that concerns one row.
          const rendering = preview.busy?.index === index && preview.busy.mode === mode;
          const onDisk = cached[mode];

          return (
            <span key={mode} className="flex items-center">
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs"
                disabled={!playable || rendering}
                title={
                  onDisk
                    ? "Already rendered — plays for free"
                    : mode === "word"
                      ? "Hear the name on its own. Costs credits."
                      : "Hear it in a line from the corpus. Costs credits."
                }
                onClick={() => void preview.play(entry, mode, index)}
              >
                {/* The label stays put while a render is in flight. Swapping it for an
                    ellipsis resized the button, moving the one beside it under a cursor
                    already on the way to it. The spinner to the right says it is working. */}
                {MODE_LABELS[mode]}
              </Button>

              {/* Greyed until there is something to replace: re-rolling a take that does not
                  exist is just rendering it, which the button to the left already does. */}
              <Button
                size="icon"
                variant="ghost"
                aria-label={`Re-roll the ${mode} preview for ${entry.grapheme}`}
                title={
                  onDisk
                    ? "Discard the cached take and pay for a fresh one"
                    : "Nothing cached to re-roll yet"
                }
                className={cn(
                  "size-6",
                  onDisk || rendering ? "text-muted-foreground" : "text-muted-foreground/30",
                )}
                disabled={!playable || !onDisk || rendering}
                onClick={() => void preview.play(entry, mode, index, true)}
              >
                <RefreshCw className={cn("size-3", rendering && "animate-spin")} aria-hidden />
              </Button>
            </span>
          );
        })}
      </div>
    </div>
  );
}

/**
 * What fish.audio makes of an entry, which is not always what ElevenLabs does: it reads no
 * IPA outside English, so another language's IPA entries do nothing there until they are
 * given a respelling. Said per row, because the page is otherwise entirely about ElevenLabs.
 */
function FishBadge({ use }: { use: FishUse }) {
  const text = { phoneme: "fish: phoneme", respelling: "fish: respelling", unused: "fish: not used" }[use];
  const title = {
    phoneme: "fish.audio speaks this from the IPA, converted to ARPAbet.",
    respelling: "fish.audio speaks this respelling as written.",
    unused:
      "fish.audio cannot use this entry: it reads no IPA outside English, and this IPA does not convert. Give it a respelling for fish.audio to use.",
  }[use];
  return (
    <span
      title={title}
      className={cn(
        "w-24 shrink-0 text-[11px]",
        use === "unused" ? "text-amber-500" : "text-muted-foreground",
      )}
    >
      {text}
    </span>
  );
}
