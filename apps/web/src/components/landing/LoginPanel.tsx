"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { useLang } from "@/components/LangProvider";
import Link from "@/components/LocaleLink";
import { signIn, signOut } from "@/lib/auth-client";
import { localeHref } from "@/lib/lang";
import { fill } from "@/lib/site-text/format";

import { BACKSTAGE_HREF } from "./backstage";
import { useSiteText } from "./SiteTextProvider";
import { useLandingSession } from "./useLandingSession";

/**
 * The sign-in card on the front page. It reads the session in the browser, so the page itself
 * stays free of a database read. Signed in, it offers the way through.
 */
export default function LoginPanel() {
  const t = useSiteText().login;
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
        setError(error.message || t.failed);
        setPending(false);
        return;
      }
      router.push(localeHref(lang, BACKSTAGE_HREF));
      router.refresh();
    } catch {
      // A dropped connection throws instead of returning an error.
      setError(t.failed);
      setPending(false);
    }
  }

  if (session) {
    return (
      <div className="bn-login">
        <h3 className="bn-display">{t.welcome}</h3>
        <p>{fill(t.signedInAs, { email: session.user.email })}</p>
        <Link className="bn-btn bn-btn-primary bn-btn-lg" href={BACKSTAGE_HREF}>
          {t.open}
        </Link>
        <p className="bn-login-foot">
          {t.notYou}{" "}
          <button
            type="button"
            className="bn-textbtn"
            onClick={() => {
              signOut()
                .then(() => router.refresh())
                .catch(() => setError(t.signOutFailed));
            }}
          >
            {t.signOut}
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
      <h3 className="bn-display">{t.signInTitle}</h3>
      <p>{t.account}</p>
      <label className="bn-field">
        <span>{t.email}</span>
        <input
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </label>
      <label className="bn-field">
        <span>{t.password}</span>
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
        {pending ? t.signingIn : t.signInTitle}
      </button>
      <p className="bn-login-foot">
        {t.noAccount} <Link href="/register">{t.register}</Link>
        {" · "}
        <Link href="/forgot-password">{t.forgot}</Link>
      </p>
    </form>
  );
}
