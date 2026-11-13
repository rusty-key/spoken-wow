"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import Link from "@/components/LocaleLink";
import { Button } from "@/components/ui/button";
import { send } from "@/lib/send";
import { branchText, requestLangName as label } from "@/lib/teams/branch-text";
import type { TeamRequest } from "@/lib/teams/requests";

export default function TeamRequestList({ initial }: { initial: TeamRequest[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  async function withdraw(id: string) {
    setError(null);
    const result = await send(`/api/team-requests/${id}`, "DELETE");
    if (!result.ok) setError(result.error);
    router.refresh();
  }

  if (!initial.length) return null;
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">Your requests</h2>
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
              <span className="rounded border px-1.5 text-xs uppercase">{request.state}</span>
              <span className="text-muted-foreground text-xs">{request.createdAt.slice(0, 10)}</span>
            </div>
            {request.reason && <p className="text-muted-foreground">Reason: {request.reason}</p>}
            {request.branch && (
              <p className="text-muted-foreground">{branchText(request.branch, label(request))}</p>
            )}
            {request.state === "pending" && (
              <Button variant="outline" size="sm" className="self-start" onClick={() => withdraw(request.id)}>
                Withdraw
              </Button>
            )}
            {request.state === "approved" && (
              <Link href={`/admin?lang=${request.lang}`} className="text-foreground underline underline-offset-2">
                Open {label(request)} in the admin
              </Link>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
