"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";

import { useUiText } from "@/components/UiTextProvider";
import { withLang, type Lang } from "@/lib/lang";
import { fill } from "@/lib/site-text/format";
import type { FollowState } from "@/lib/voice-feedback/follow";

/** Whether this visitor hears by email when a voice they voted on is shown again. */
export default function FollowBox({ lang, initial }: { lang: Lang; initial: FollowState }) {
  const t = useUiText().listen;
  const [state, setState] = useState(initial);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(false);

  async function send(method: "POST" | "DELETE", body?: unknown) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(withLang(lang, "/api/listen/follow"), {
        method,
        headers: body === undefined ? undefined : { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const next = (await response.json().catch(() => ({}))) as FollowState & { error?: string; outcome?: string };
      if (!response.ok) throw new Error(next.error ?? `${response.status}`);
      setWaiting(next.outcome === "wait");
      setState(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  let body;
  if (state.kind === "account") {
    body = (
      <label className="ls-follow-check">
        <input type="checkbox" checked={state.on} disabled={busy} onChange={(event) => void send("POST", { on: event.target.checked })} />
        {fill(t.followAccount, { email: state.email })}
      </label>
    );
  } else if (state.email && state.confirmed) {
    body = (
      <>
        <span>{fill(t.followOn, { email: state.email })}</span>
        <button type="button" className="bs-btn bs-btn-text" disabled={busy} onClick={() => void send("DELETE")}>
          {t.followStop}
        </button>
      </>
    );
  } else {
    body = (
      <form
        className="ls-follow-form"
        onSubmit={(event) => {
          event.preventDefault();
          void send("POST", { email });
        }}
      >
        <span>
          {state.email ? fill(waiting ? t.followWait : t.followPending, { email: state.email }) : t.followPrompt}
        </span>
        <input
          type="email"
          className="ls-note ls-follow-email"
          required
          value={email}
          placeholder={t.followEmailLabel}
          aria-label={t.followEmailLabel}
          onChange={(event) => setEmail(event.target.value)}
        />
        <button type="submit" className="bs-btn" disabled={busy}>
          {busy ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : null}
          {t.followButton}
        </button>
      </form>
    );
  }

  return (
    <div className="ls-follow">
      {body}
      {error ? (
        <p className="ls-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
