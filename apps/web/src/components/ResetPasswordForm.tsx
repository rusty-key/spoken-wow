"use client";

import { useState } from "react";

import Link from "@/components/LocaleLink";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { resetPassword } from "@/lib/auth-client";

const FAILED = "Something went wrong. Try again.";

const LINK_CLASS = "text-foreground underline underline-offset-4";

/** `token` is null when the link was expired, already used, or opened without one. */
export default function ResetPasswordForm({ token }: { token: string | null }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(token === null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (token === null) return;
    setError(null);
    setPending(true);
    try {
      const { error } = await resetPassword({ newPassword: password, token });
      if (!error) setDone(true);
      // The form checks the link when it opens, but it can run out while the page sits open.
      else if (error.code === "INVALID_TOKEN") setExpired(true);
      else setError(error.message || FAILED);
    } catch {
      // A dropped connection throws instead of returning an error.
      setError(FAILED);
    }
    setPending(false);
  }

  return (
    <>
      <h1 className="text-xl font-semibold">Choose a new password</h1>

      {done ? (
        <p role="status" className="mt-6 max-w-sm text-sm">
          Password changed, and every device signed out.{" "}
          <Link href="/login" className={LINK_CLASS}>
            Sign in
          </Link>
        </p>
      ) : expired ? (
        <p role="alert" className="mt-6 max-w-sm text-sm">
          This link has expired or was already used.{" "}
          <Link href="/forgot-password" className={LINK_CLASS}>
            Ask for a new one
          </Link>
        </p>
      ) : (
        <form onSubmit={onSubmit} className="mt-6 flex max-w-sm flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="password">New password</Label>
            <Input
              id="password"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <p className="text-muted-foreground text-xs">At least 8 characters.</p>
          </div>

          {error && (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          )}

          <Button type="submit" disabled={pending} className="self-start">
            {pending ? "Working…" : "Change password"}
          </Button>
        </form>
      )}
    </>
  );
}
