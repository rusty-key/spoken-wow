"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import Link from "@/components/LocaleLink";
import { Button } from "@/components/ui/button";
import { useUiText } from "@/components/UiTextProvider";
import { send } from "@/lib/send";
import { fill } from "@/lib/site-text/format";
import { requestLangName as label } from "@/lib/teams/branch-text";
import type { TeamRequest } from "@/lib/teams/requests";

export default function TeamRequestList({ initial }: { initial: TeamRequest[] }) {
  const t = useUiText().teams;
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  // While one withdrawal is in flight every button waits: a second click would reach a request
  // already withdrawn and show its refusal as an error.
  const [busy, setBusy] = useState<string | null>(null);

  async function withdraw(id: string) {
    setBusy(id);
    setError(null);
    try {
      const result = await send(`/api/team-requests/${id}`, "DELETE");
      if (!result.ok) setError(result.error);
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  if (!initial.length) return null;
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">{t.yourRequests}</h2>
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
      <ul className="flex flex-col gap-3">
        {initial.map((request) => (
          <li key={request.id} className="flex flex-col gap-1 rounded border p-3 text-sm">
            <div className="flex items-baseline gap-2">
              <span className="font-medium">{request.teamName}</span>
              <span className="text-muted-foreground font-mono text-xs">{request.lang}</span>
              <span className="rounded border px-1.5 text-xs uppercase">{t.stateWords[request.state] ?? request.state}</span>
              <span className="text-muted-foreground text-xs">{request.createdAt.slice(0, 10)}</span>
            </div>
            {request.reason && <p className="text-muted-foreground">{fill(t.reason, { reason: request.reason })}</p>}
            {request.branch && (
              <p className="text-muted-foreground">
                {request.branch === "new-language"
                  ? t.branchNewLanguage
                  : fill(t.branchAddTeam, { name: label(request) })}
              </p>
            )}
            {request.state === "pending" && (
              <Button
                variant="outline"
                size="sm"
                className="self-start"
                disabled={busy !== null}
                onClick={() => withdraw(request.id)}
              >
                {t.withdraw}
              </Button>
            )}
            {request.state === "approved" && (
              <Link href={`/admin?lang=${request.lang}`} className="text-foreground underline underline-offset-2">
                {fill(t.openInAdmin, { name: label(request) })}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
