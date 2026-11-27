"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";

import { Checkbox } from "@/components/ui/checkbox";
import { useUiText } from "@/components/UiTextProvider";
import { send } from "@/components/voice-design/context";
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

  async function ask(method: "POST" | "DELETE", body?: unknown) {
    setBusy(true);
    setError(null);
    try {
      const next = await send<FollowState & { outcome?: string }>(withLang(lang, "/api/listen/follow"), { method, body });
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
        <Checkbox checked={state.on} disabled={busy} onCheckedChange={(on) => void ask("POST", { on: on === true })} />
        <span>{fill(t.followAccount, { email: state.email })}</span>
      </label>
    );
  } else if (state.email && state.confirmed) {
    body = (
      <>
        <span>{fill(t.followOn, { email: state.email })}</span>
        <button type="button" className="bs-btn bs-btn-text" disabled={busy} onClick={() => void ask("DELETE")}>
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
          void ask("POST", { email });
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
