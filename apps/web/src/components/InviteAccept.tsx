"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import LocaleLink from "@/components/LocaleLink";
import { Button } from "@/components/ui/button";
import { signOut } from "@/lib/auth-client";
import { langName, localeHref, type Lang } from "@/lib/lang";

type Props = {
  email: string;
  lang: Lang;
  /** The signed-in account's address, or null when signed out. */
  signedInAs: string | null;
};

/** What the person who accepted sees, on the page and after pressing Accept. */
export function InviteJoined({ lang, className }: { lang: Lang; className?: string }) {
  return (
    <p className={className}>
      You&apos;re in. You can now work on {langName(lang)}.{" "}
      <Link href={localeHref(lang, "/")} className="underline underline-offset-4">
        Go to {langName(lang)}
      </Link>
    </p>
  );
}

/**
 * What to do with a pending invite: register or sign in with its address, sign out of the wrong
 * account, or press Accept. Accepting is a button, so a link preview cannot use the invite up.
 */
export default function InviteAccept({ email, lang, signedInAs }: Props) {
  const router = useRouter();
  const [done, setDone] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function accept() {
    setPending(true);
    setError(null);
    const response = await fetch("/api/invites/accept", { method: "POST" }).catch(() => null);
    const data = (await response?.json().catch(() => ({}))) as { error?: string; reason?: string } | undefined;
    setPending(false);
    // Pressed twice, or in two tabs: the grants were given once, so this is success too.
    if (response?.ok || data?.reason === "accepted") {
      setDone(true);
      router.refresh();
      return;
    }
    setError(data?.error ?? "Could not reach the server.");
  }

  async function leave() {
    await signOut();
    router.refresh();
  }

  if (done) return <InviteJoined lang={lang} className="mt-6" />;

  if (signedInAs === null) {
    return (
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Button asChild>
          <LocaleLink href="/register">Register with {email}</LocaleLink>
        </Button>
        <LocaleLink href="/login" className="text-sm underline underline-offset-4">
          I already have an account
        </LocaleLink>
      </div>
    );
  }

  if (signedInAs.trim().toLowerCase() !== email) {
    return (
      <div className="mt-6">
        <p>
          This invite is for {email}. You are signed in as {signedInAs}.
        </p>
        <Button className="mt-3" variant="outline" onClick={() => void leave()}>
          Sign out
        </Button>
      </div>
    );
  }

  return (
    <div className="mt-6">
      <Button onClick={() => void accept()} disabled={pending}>
        {pending ? "Working…" : "Accept"}
      </Button>
      {error && (
        <p role="alert" className="text-destructive mt-3 text-sm">
          {error}
        </p>
      )}
    </div>
  );
}
