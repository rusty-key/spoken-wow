"use client";

import { useLang } from "@/components/LangProvider";
import { localeHref } from "@/lib/lang";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "@/components/LocaleLink";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signIn, signUp } from "@/lib/auth-client";

type Mode = "login" | "register";

const COPY = {
  login: {
    title: "Sign in",
    submit: "Sign in",
    switchText: "No account yet?",
    switchLabel: "Register",
    switchHref: "/register",
  },
  register: {
    title: "Register",
    submit: "Create account",
    switchText: "Already registered?",
    switchLabel: "Sign in",
    switchHref: "/login",
  },
} as const;

/** `invite`: a pending invite the form answers; only its token is carried on, never a free path. */
export default function AuthForm({ mode, invite }: { mode: Mode; invite?: { token: string; email: string } }) {
  const router = useRouter();
  const lang = useLang();
  const copy = COPY[mode];

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
      setError(error.message ?? "Something went wrong. Try again.");
      setPending(false);
      return;
    }

    // refresh() re-runs the server components, so a page guarded on the server (/admin)
    // sees the new session immediately rather than on the next full load.
    router.push(localeHref(lang, invite ? `/invite?token=${encodeURIComponent(invite.token)}` : "/"));
    router.refresh();
  }

  return (
    <>
      <h1 className="text-xl font-semibold">{copy.title}</h1>

      {invite && <p className="text-muted-foreground mt-2 text-sm">You&apos;re answering an invite to {invite.email}.</p>}

      <form onSubmit={onSubmit} className="mt-6 flex max-w-sm flex-col gap-4">
        {mode === "register" && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="name">Name</Label>
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
          <Label htmlFor="email">Email</Label>
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
          <Label htmlFor="password">Password</Label>
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
            <p className="text-muted-foreground text-xs">At least 8 characters.</p>
          )}
          {mode === "login" && (
            <Link
              href="/forgot-password"
              className="text-muted-foreground self-start text-xs underline underline-offset-4"
            >
              Forgot your password?
            </Link>
          )}
        </div>

        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}

        <Button type="submit" disabled={pending} className="self-start">
          {pending ? "Working…" : copy.submit}
        </Button>

        <p className="text-muted-foreground text-sm">
          {copy.switchText}{" "}
          <Link
            href={invite ? `${copy.switchHref}?invite=${encodeURIComponent(invite.token)}` : copy.switchHref}
            className="text-foreground underline underline-offset-4"
          >
            {copy.switchLabel}
          </Link>
        </p>
      </form>
    </>
  );
}
