"use client";

/**
 * The form a player fills in after copying an address out of the game.
 *
 * The success screen matters more than it looks: a reporter cannot read their report back, so
 * a form that merely cleared itself would leave them with no evidence anything happened and a
 * fair chance of filing the same thing twice.
 *
 * A signed-in reporter is not asked who they are. The endpoint takes their identity from
 * the session and drops whatever the body claims -- letting somebody sign in and then type
 * another person's name is a way to put words in their mouth -- so the two fields were a
 * lie to anyone signed in: filled in carefully, ignored on arrival. They are shown to a
 * visitor, who has no other way to be reachable, and replaced by a line naming the account
 * for everyone else.
 *
 * One form for all three sections, against one endpoint and one table. The two sites each had
 * their own, with their own category vocabulary, and triage was two lists -- which is two
 * places to forget to look. What differs between them is the address: a quest report carries
 * one the addon built and a zone report may carry none at all, because its report page is
 * reached with the line already identified.
 */
import { useLang } from "@/components/LangProvider";
import Link from "@/components/LocaleLink";
import ReportContextFacts from "@/components/reports/ReportContextFacts";
import { decodeFragment, takeFragment } from "@/lib/contributions/envelope";
import { withLang } from "@/lib/lang";
import { LATEST_VERSION, contextFrom, outdatedVersion } from "@/lib/reports/context";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { useSession } from "@/lib/auth-client";
import { BODY_MAX, CATEGORIES, CATEGORY_LABELS } from "@/lib/reports/reports";
import type { Source } from "@/lib/sections";

export default function ReportForm({
  source,
  target,
  lineId,
  fromGame = false,
}: {
  source: Source;
  /** The raw address the report came in on, or null where the section has none. */
  target: string | null;
  lineId: string | null;
  /** On an /r/ page the game links to, whose address may carry the addon's context. */
  fromGame?: boolean;
}) {
  const lang = useLang();
  // isPending rather than a bare null check: while the session is still loading, showing
  // the fields and then pulling them out from under a half-typed name is worse than a
  // moment without them.
  const { data: session, isPending } = useSession();
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const raw = useFragmentContext(fromGame);
  const context = useMemo(() => contextFrom(raw, source), [raw, source]);
  const outdated = outdatedVersion(context);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const data = new FormData(event.currentTarget);
    const response = await fetch(withLang(lang, "/api/reports"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        source,
        target,
        lineId,
        category: data.get("category"),
        body: data.get("body"),
        name: data.get("name"),
        email: data.get("email"),
        website: data.get("website"),
        context: context ? raw : null,
      }),
    }).catch(() => null);

    setBusy(false);

    if (response?.ok) {
      setSent(true);
      return;
    }
    setError(
      response?.status === 429
        ? "That is a lot of reports in a short time. Try again in a few minutes."
        : "The report was not accepted. Check the category and try again.",
    );
  }

  if (sent) {
    return (
      <p role="status" className="rounded border p-4 text-sm">
        Thank you — the report was filed. There is no way to look it up again, so keep the
        address if you want to check back later.
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="flex max-w-xl flex-col gap-4">
      {outdated ? (
        <p className="rounded border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          You are on Spoken {outdated}, and {LATEST_VERSION} is out. This might already be fixed
          there: <Link href="/" className="underline underline-offset-2">get the latest version</Link>.
          You can still send the report.
        </p>
      ) : null}

      {context ? (
        <details className="rounded border p-3 text-sm">
          <summary className="cursor-pointer">Sent with this report, from your game</summary>
          <div className="mt-2">
            <ReportContextFacts context={context} />
          </div>
        </details>
      ) : null}

      <label className="flex flex-col gap-1 text-sm">
        What went wrong?
        <select
          name="category"
          defaultValue="pronunciation"
          className="bg-background rounded border px-2 py-1.5"
        >
          {CATEGORIES.map((category) => (
            <option key={category} value={category}>
              {CATEGORY_LABELS[category]}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-sm">
        Tell us more
        <textarea
          name="body"
          required
          maxLength={BODY_MAX}
          rows={6}
          className="bg-background rounded border px-2 py-1.5"
        />
      </label>

      {isPending ? null : session ? (
        <p className="text-muted-foreground text-sm">
          Filing as {session.user.name || session.user.email}.
        </p>
      ) : (
        <>
          <label className="flex flex-col gap-1 text-sm">
            Your name (optional)
            <input
              name="name"
              maxLength={200}
              className="bg-background rounded border px-2 py-1.5"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            Email, if you want a reply (optional)
            <input
              name="email"
              type="email"
              maxLength={320}
              className="bg-background rounded border px-2 py-1.5"
            />
          </label>
        </>
      )}

      {/* A honeypot. sr-only rather than display:none, which bots know to skip. */}
      <label className="sr-only" aria-hidden="true">
        Website
        <input name="website" tabIndex={-1} autoComplete="off" />
      </label>

      <div>
        <Button type="submit" disabled={busy}>
          {busy ? "Sending…" : "Send report"}
        </Button>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      ) : null}
    </form>
  );
}

const STORED = "spoken.report.context";

/**
 * The envelope the addon put in the report link's #e1= fragment, decoded in the browser.
 *
 * Kept in sessionStorage under the page's path, because choosing which of an NPC's lines to
 * report is a navigation to ?line=, and a link carries no fragment along. Taken out of the
 * address bar once read, as ContributeForm does, so the game text does not linger in history.
 */
function useFragmentContext(enabled: boolean): string | null {
  const [raw, setRaw] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const key = `${STORED}:${window.location.pathname}`;
    const fragment = takeFragment();
    if (fragment === null) {
      try {
        setRaw(window.sessionStorage.getItem(key));
      } catch {
        // Storage blocked: the report goes without context.
      }
      return;
    }

    // Not cancelled on cleanup: the hash is gone from the address once this runs, so an effect
    // run twice (React's development double-invoke) has only this decode to get it from.
    void decodeFragment(fragment).then((result) => {
      if (!result.ok) return;
      setRaw(result.text);
      try {
        window.sessionStorage.setItem(key, result.text);
      } catch {
        // As above.
      }
    });
  }, [enabled]);

  return raw;
}
