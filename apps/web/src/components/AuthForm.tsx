"use client";

import { useLang } from "@/components/LangProvider";
import { localeHref } from "@/lib/lang";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "@/components/LocaleLink";

import { useUiText } from "@/components/UiTextProvider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signIn, signUp } from "@/lib/auth-client";
import { fill } from "@/lib/site-text/format";

type Mode = "login" | "register";

const COPY = {
  login: { switchHref: "/register" },
  register: { switchHref: "/login" },
} as const;

/** `invite`: a pending invite the form answers (its token is in a cookie); it sends back to /invite, never a free path. */
export default function AuthForm({ mode, invite }: { mode: Mode; invite?: { email: string } }) {
  const router = useRouter();
  const lang = useLang();
  const t = useUiText();
  const copy = {
    ...COPY[mode],
    title: mode === "register" ? t.menu.register : t.menu.signIn,
    submit: mode === "register" ? t.auth.createAccount : t.menu.signIn,
    switchText: mode === "register" ? t.auth.alreadyRegistered : t.auth.noAccount,
    switchLabel: mode === "register" ? t.menu.signIn : t.menu.register,
  };

  const [name, setName] = useState("");
  const [email, setEmail] = useState(invite?.email ?? "");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);

    const { error } =
      mode === "register"
        ? await signUp.email({ name, email, password })
        : await signIn.email({ email, password });

    if (error) {
      setError(error.message ?? t.auth.failed);
      setPending(false);
      return;
    }

    // refresh() re-runs the server components, so a page guarded on the server (/admin)
    // sees the new session immediately rather than on the next full load.
    router.push(localeHref(lang, invite ? "/invite" : "/"));
    router.refresh();
  }

  return (
    <>
      <h1 className="text-xl font-semibold">{copy.title}</h1>

      {invite && <p className="text-muted-foreground mt-2 text-sm">{fill(t.auth.answeringInvite, { email: invite.email })}</p>}

      <form onSubmit={onSubmit} className="mt-6 flex max-w-sm flex-col gap-4">
        {mode === "register" && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="name">{t.auth.name}</Label>
            <Input
              id="name"
              required
              autoComplete="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="email">{t.auth.email}</Label>
          <Input
            id="email"
            type="email"
            required
            // Registering from an invite is for its address; signing in may be another login's.
            readOnly={mode === "register" && !!invite}
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="password">{t.auth.password}</Label>
          <Input
            id="password"
            type="password"
            required
            // Better Auth rejects anything shorter server-side; saying so up front beats a
            // round trip to find out.
            minLength={8}
            autoComplete={mode === "register" ? "new-password" : "current-password"}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          {mode === "register" && (
            <p className="text-muted-foreground text-xs">{t.auth.minChars}</p>
          )}
          {mode === "login" && (
            <Link
              href="/forgot-password"
              className="text-muted-foreground self-start text-xs underline underline-offset-4"
            >
              {t.auth.forgot}
            </Link>
          )}
        </div>

        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}

        <Button type="submit" disabled={pending} className="self-start">
          {pending ? t.auth.working : copy.submit}
        </Button>

        <p className="text-muted-foreground text-sm">
          {copy.switchText}{" "}
          <Link
            href={copy.switchHref}
            className="text-foreground underline underline-offset-4"
          >
            {copy.switchLabel}
          </Link>
        </p>
      </form>
    </>
  );
}
