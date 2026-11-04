"use client";

import { useState } from "react";

import { useLang } from "@/components/LangProvider";
import Link from "@/components/LocaleLink";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requestPasswordReset } from "@/lib/auth-client";
import { localeHref } from "@/lib/lang";

const FAILED = "Something went wrong. Try again.";

export default function ForgotPasswordForm() {
  const lang = useLang();
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
      if (error) setError(error.message || FAILED);
      else setSent(true);
    } catch {
      // A dropped connection throws instead of returning an error.
      setError(FAILED);
    }
    setPending(false);
  }

  return (
    <>
      <h1 className="text-xl font-semibold">Reset your password</h1>

      {sent ? (
        <p role="status" className="mt-6 max-w-sm text-sm">
          If {email} has an account, a reset link is on its way. It expires in one hour.
        </p>
      ) : (
        <form onSubmit={onSubmit} className="mt-6 flex max-w-sm flex-col gap-4">
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

          {error && (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          )}

          <Button type="submit" disabled={pending} className="self-start">
            {pending ? "Working…" : "Send reset link"}
          </Button>
        </form>
      )}

      <p className="text-muted-foreground mt-4 text-sm">
        <Link href="/login" className="text-foreground underline underline-offset-4">
          Back to sign in
        </Link>
      </p>
    </>
  );
}
