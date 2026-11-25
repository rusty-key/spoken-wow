"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import LocaleLink from "@/components/LocaleLink";
import { useUiText } from "@/components/UiTextProvider";
import { Button } from "@/components/ui/button";
import { signOut } from "@/lib/auth-client";
import { langName, localeHref, type Lang } from "@/lib/lang";
import { fill } from "@/lib/site-text/format";

type Props = {
  /** The invite this page shows; the accept route refuses when the link's invite is another. */
  id: string;
  email: string;
  lang: Lang;
  /** The signed-in account's address, or null when signed out. */
  signedInAs: string | null;
  /** Whether the signed-in account's address is the invited one. */
  isInvitee: boolean;
};

/** What the person who accepted sees, on the page and after pressing Accept. */
export function InviteJoined({ lang, className }: { lang: Lang; className?: string }) {
  const words = useUiText().invite;
  return (
    <p className={className}>
      {fill(words.joined, { lang: langName(lang) })}{" "}
      <Link href={localeHref(lang, "/")} className="underline underline-offset-4">
        {fill(words.goTo, { lang: langName(lang) })}
      </Link>
    </p>
  );
}

/**
 * What to do with a pending invite: register or sign in with its address, sign out of the wrong
 * account, or press Accept. Accepting is a button, so a link preview cannot use the invite up.
 */
export default function InviteAccept({ id, email, lang, signedInAs, isInvitee }: Props) {
  const router = useRouter();
  const text = useUiText();
  const words = text.invite;
  const [done, setDone] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function accept() {
    setPending(true);
    setError(null);
    const response = await fetch("/api/invites/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    }).catch(() => null);
    const data = (await response?.json().catch(() => ({}))) as { error?: string; reason?: string } | undefined;
    setPending(false);
    // Pressed twice, or in two tabs: the grants were given once, so this is success too.
    if (response?.ok || data?.reason === "accepted") {
      setDone(true);
      router.refresh();
      return;
    }
    setError(data?.error ?? text.packs.unreachable);
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
          <LocaleLink href="/register">{fill(words.registerWith, { email })}</LocaleLink>
        </Button>
        <LocaleLink href="/login" className="text-sm underline underline-offset-4">
          {words.alreadyHave}
        </LocaleLink>
      </div>
    );
  }

  if (!isInvitee) {
    return (
      <div className="mt-6">
        <p>
          {fill(words.forSomeone, { email, signedInAs })}
        </p>
        <Button className="mt-3" variant="outline" onClick={() => void leave()}>
          {words.signOut}
        </Button>
      </div>
    );
  }

  return (
    <div className="mt-6">
      <Button onClick={() => void accept()} disabled={pending}>
        {pending ? text.auth.working : words.accept}
      </Button>
      {error && (
        <p role="alert" className="text-destructive mt-3 text-sm">
          {error}
        </p>
      )}
    </div>
  );
}
