"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { useLang } from "@/components/LangProvider";
import Link from "@/components/LocaleLink";
import { signIn, signOut } from "@/lib/auth-client";
import { localeHref } from "@/lib/lang";

import { BACKSTAGE_HREF } from "./backstage";
import { useLandingSession } from "./useLandingSession";

const FAILED = "Something went wrong. Try again.";

/**
 * The sign-in card on the front page. It reads the session in the browser, so the page itself
 * stays free of a database read. Signed in, it offers the way through.
 */
export default function LoginPanel() {
  const router = useRouter();
  const lang = useLang();
  const { session, pending: loading } = useLandingSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      const { error } = await signIn.email({ email, password });
      if (error) {
        setError(error.message || FAILED);
        setPending(false);
        return;
      }
      router.push(localeHref(lang, BACKSTAGE_HREF));
      router.refresh();
    } catch {
      // A dropped connection throws instead of returning an error.
      setError(FAILED);
      setPending(false);
    }
  }

  if (session) {
    return (
      <div className="bn-login">
        <h3 className="bn-display">Welcome back</h3>
        <p>Signed in as {session.user.email}</p>
        <Link className="bn-btn bn-btn-primary bn-btn-lg" href={BACKSTAGE_HREF}>
          Open Backstage
        </Link>
        <p className="bn-login-foot">
          Not you?{" "}
          <button
            type="button"
            className="bn-textbtn"
            onClick={() => {
              signOut()
                .then(() => router.refresh())
                .catch(() => setError("Could not sign out. Try again."));
            }}
          >
            Sign out
          </button>
        </p>
        {error && (
          <p role="alert" className="bn-error">
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <form className={loading ? "bn-login bn-login-wait" : "bn-login"} onSubmit={onSubmit} aria-busy={loading} inert={loading}>
      <h3 className="bn-display">Sign in</h3>
      <p>Use your Spoken account.</p>
      <label className="bn-field">
        <span>Email</span>
        <input
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </label>
      <label className="bn-field">
        <span>Password</span>
        <input
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </label>
      {error && (
        <p role="alert" className="bn-error">
          {error}
        </p>
      )}
      <button type="submit" className="bn-btn bn-btn-primary bn-btn-lg" disabled={pending}>
        {pending ? "Signing in..." : "Sign in"}
      </button>
      <p className="bn-login-foot">
        No account yet? <Link href="/register">Register</Link>
      </p>
    </form>
  );
}
