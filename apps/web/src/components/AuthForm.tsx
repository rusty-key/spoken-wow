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

/**
 * `next` if it is a path on this site, else "/". Browsers read a backslash as a slash and drop
 * tabs and newlines from a URL, so "/\evil.com" and "/\t/evil.com" both mean //evil.com.
 */
export function safeNext(next: string | null | undefined): string {
  // eslint-disable-next-line no-control-regex
  return next && /^\/(?![/\\])[^\s\x00-\x1f\x7f]*$/.test(next) ? next : "/";
}

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

/**
 * `next` must be a path on this site, so a link cannot send someone who just signed in to
 * another origin.
 */
export default function AuthForm({ mode, next }: { mode: Mode; next?: string | null }) {
  const router = useRouter();
  const lang = useLang();
  const copy = COPY[mode];

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
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
    router.push(localeHref(lang, safeNext(next)));
    router.refresh();
  }

  return (
    <>
      <h1 className="text-xl font-semibold">{copy.title}</h1>

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
