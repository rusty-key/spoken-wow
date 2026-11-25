"use client";

import { useState } from "react";

import { useLang } from "@/components/LangProvider";
import Link from "@/components/LocaleLink";
import { useUiText } from "@/components/UiTextProvider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requestPasswordReset } from "@/lib/auth-client";
import { localeHref } from "@/lib/lang";
import { fill } from "@/lib/site-text/format";

export default function ForgotPasswordForm() {
  const lang = useLang();
  const t = useUiText().auth;
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      const { error } = await requestPasswordReset({
        email,
        redirectTo: localeHref(lang, "/reset-password"),
      });
      if (error) setError(error.message || t.failed);
      else setSent(true);
    } catch {
      // A dropped connection throws instead of returning an error.
      setError(t.failed);
    }
    setPending(false);
  }

  return (
    <>
      <h1 className="text-xl font-semibold">{t.resetTitle}</h1>

      {sent ? (
        <p role="status" className="mt-6 max-w-sm text-sm">
          {fill(t.resetSent, { email })}
        </p>
      ) : (
        <form onSubmit={onSubmit} className="mt-6 flex max-w-sm flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email">{t.email}</Label>
            <Input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>

          {error && (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          )}

          <Button type="submit" disabled={pending} className="self-start">
            {pending ? t.working : t.sendReset}
          </Button>
        </form>
      )}

      <p className="text-muted-foreground mt-4 text-sm">
        <Link href="/login" className="text-foreground underline underline-offset-4">
          {t.backToSignIn}
        </Link>
      </p>
    </>
  );
}
