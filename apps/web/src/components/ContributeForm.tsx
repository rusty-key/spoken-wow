"use client";

/**
 * The form a player lands on from the link an addon's Contribute button gives them.
 *
 * The envelope arrives in the link's `#e1=` fragment and never in a box: every addon hands out
 * a link, so there is nothing to paste, and a raw key=value wall on the page would only be
 * something to read past. What the player does see is the preview -- the parse, field by field,
 * above the Send button -- because nobody should be asked to send something they cannot read.
 */
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  checkEnvelope,
  COMPLAINT_MAX,
  DESCRIPTION_MAX,
  DESCRIPTION_MIN,
} from "@/lib/contributions/contributions";
import {
  decodeFragment,
  type DecodeError,
  parseEnvelope,
  type ParseError,
  takeFragment,
} from "@/lib/contributions/envelope";
import { sendFailureMessage } from "@/lib/contributions/send-failure";

const FIELD_LABELS: Record<string, string> = {
  quest: "Quest",
  event: "Moment",
  npc: "Character",
  title: "Title",
  book: "Book",
  number: "Page",
  page: "Page id",
  map: "Map",
  zone: "Zone",
  subzone: "Place",
  locale: "Language",
  build: "Client",
  addon: "Addon",
  x: "x",
  y: "y",
};

const MESSAGES: Record<ParseError, string> = {
  truncated: "That link was cut short. Copy the whole link from the game again.",
  checksum: "That link was changed after it was copied. Copy it again without editing it.",
  version: "That came from a newer addon than this page knows. Update the site's addons, or tell me.",
  source: "That is not something this page can take.",
  oversize: "That is far larger than anything the addon produces.",
  malformed: "That link does not carry an addon's contribution. Copy it from the game again.",
};

const LINK_MESSAGES: Record<DecodeError, string> = {
  malformed: "That link is missing its payload. Copy the whole link from the game again.",
  corrupt: "That link looks broken -- copy it from the game again.",
  // DecompressionStream is missing on pre-16.4 Safari: said plainly, rather than leaving the
  // player looking at a form that silently never fills in.
  unsupported: "This browser can't open this kind of link. Try it in a current browser.",
};

export type Preview =
  | { ok: true; source: string; rows: { label: string; value: string }[]; text: string | null }
  | { ok: false; message: string };

/** Exported for its test: what the page will show for a given paste. */
export function previewOf(raw: string): Preview {
  if (!raw.trim()) return { ok: false, message: "" };

  const parsed = parseEnvelope(raw);
  if (!parsed.ok) return { ok: false, message: MESSAGES[parsed.error] };

  // A clean parse is not a sendable envelope: submissionFrom (via checkEnvelope) still applies
  // the key/text rules, and previously nothing here did -- a parse-only preview approved
  // things the server would 400 on and told the player nothing about why.
  const check = checkEnvelope(parsed.value);
  if (!check.ok) return { ok: false, message: check.message };

  const rows = Object.entries(parsed.value.fields).map(([key, value]) => ({
    label: FIELD_LABELS[key] ?? key,
    value,
  }));
  return { ok: true, source: parsed.value.source, rows, text: parsed.value.text };
}

export default function ContributeForm({ signedInAs }: { signedInAs: string | null }) {
  const [raw, setRaw] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  // Whether the fragment has been read yet: before that, an empty form is "loading", not "no
  // link". False on the server render, where window.location does not exist.
  const [read, setRead] = useState(false);
  const [description, setDescription] = useState("");

  // The one-copy flow: a #e1= link fills the box itself, so pressing Send is the only thing
  // left for the player to do. Runs once, client-side only -- window.location.hash never
  // exists during the server render, and the hash is stripped from the address bar immediately
  // rather than merely read, so it cannot linger in history or get shared onward carrying the
  // decoded game text a second time.
  useEffect(() => {
    const fragment = takeFragment();
    if (fragment === null) {
      setRead(true);
      return;
    }

    let cancelled = false;
    decodeFragment(fragment).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setRaw(result.text);
      } else {
        setLinkError(LINK_MESSAGES[result.error]);
      }
      setRead(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const preview = previewOf(raw);
  // A place with no lore: the addon can only name it, so what is sent is the player's own
  // description of it -- required, and in place of the optional note every other source gets.
  const isPlace = preview.ok && preview.source === "places";
  const described = description.trim().length >= DESCRIPTION_MIN;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const data = new FormData(event.currentTarget);
    const response = await fetch("/api/contributions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        envelope: raw,
        body: isPlace ? null : data.get("body"),
        description: isPlace ? description : null,
        name: signedInAs ? null : data.get("name"),
        email: signedInAs ? null : data.get("email"),
        website: data.get("website"),
      }),
    }).catch(() => null);

    setBusy(false);
    if (response?.ok) {
      setSent(true);
      return;
    }
    const failure = (await response?.json().catch(() => null)) as { error?: string } | null;
    setError(
      failure?.error === "describe"
        ? `Describe the place in a sentence or two -- at least ${DESCRIPTION_MIN} characters.`
        : sendFailureMessage(response?.status ?? null, failure?.error),
    );
  }

  // Nothing until the fragment is read: a form with no envelope in it is neither the empty
  // state nor the real one, and flashing it for a frame reads as a page that changed its mind.
  if (!read) return null;

  if (linkError) {
    return (
      <p role="alert" className="text-sm text-red-400">
        {linkError}
      </p>
    );
  }

  if (read && !raw) {
    return (
      <p className="text-muted-foreground text-sm">
        For a single line: in the game, press <strong>Contribute</strong> where Spoken has no voice
        or no lore, copy the link it shows you, and open it in your browser.
      </p>
    );
  }

  if (sent) {
    // The same reasoning as ReportForm's success screen: the sender cannot read their
    // submission back, so a form that merely cleared itself would leave them with no evidence.
    return (
      <p role="status" className="rounded border p-4 text-sm">
        Got it — thank you. It is in the queue with everything else players have sent.
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="flex max-w-xl flex-col gap-4">
      {!preview.ok && preview.message ? (
        <p role="alert" className="text-sm text-red-400">
          {preview.message}
        </p>
      ) : null}

      {preview.ok ? (
        <section aria-label="What will be sent" className="bg-muted rounded border p-3 text-sm">
          <ul className="flex flex-col gap-0.5">
            {preview.rows.map((row) => (
              <li key={row.label}>
                <strong>{row.label}:</strong> {row.value}
              </li>
            ))}
          </ul>
          {preview.text ? <pre className="mt-2 whitespace-pre-wrap">{preview.text}</pre> : null}
        </section>
      ) : null}

      {isPlace ? (
        <label className="flex flex-col gap-1 text-sm">
          Describe this place
          <span className="text-muted-foreground text-xs">
            Nobody has written its lore yet. What is it, who lives there, what happened there?
            A few sentences in your own words is plenty.
          </span>
          <textarea
            name="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            required
            minLength={DESCRIPTION_MIN}
            maxLength={DESCRIPTION_MAX}
            rows={6}
            className="bg-background rounded border px-2 py-1.5"
          />
        </label>
      ) : (
        <label className="flex flex-col gap-1 text-sm">
          Anything to add? (optional)
          <textarea
            name="body"
            maxLength={COMPLAINT_MAX}
            rows={3}
            className="bg-background rounded border px-2 py-1.5"
          />
        </label>
      )}

      {/*
        Asking a signed-in person for their name is asking them to answer a question the server
        has already decided: the route takes identity from the session and drops whatever was
        typed here, deliberately, because signing in and then typing someone else's name is a way
        to put words in their mouth. Two fields that cannot affect the outcome are two fields
        that make the form look longer and the answer look uncertain, so they are not shown.
      */}
      {signedInAs ? (
        <p className="text-muted-foreground text-sm">
          Filed as <span className="text-foreground">{signedInAs}</span>.
        </p>
      ) : (
        <>
          <label className="flex flex-col gap-1 text-sm">
            Your name (optional)
            <input name="name" className="bg-background rounded border px-2 py-1.5" />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            Your email (optional)
            <input name="email" type="email" className="bg-background rounded border px-2 py-1.5" />
          </label>
        </>
      )}

      {/* A honeypot. sr-only rather than display:none, which bots know to skip. */}
      <label className="sr-only" aria-hidden="true">
        Website
        <input name="website" tabIndex={-1} autoComplete="off" />
      </label>

      {error ? (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      ) : null}

      <div>
        <Button type="submit" disabled={busy || !preview.ok || (isPlace && !described)}>
          {busy ? "Sending…" : "Send it"}
        </Button>
      </div>
    </form>
  );
}
