"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { langName } from "@/lib/lang";
import { send } from "@/lib/send";
import { branchText } from "@/lib/teams/branch-text";
import type { TeamRequest } from "@/lib/teams/requests";

function age(createdAt: string): string {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(createdAt).getTime()) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return hours < 48 ? `${hours} h` : `${Math.floor(hours / 24)} d`;
}

const nameOf = (request: TeamRequest) => request.langName ?? langName(request.lang);

export default function TeamRequests({ initial }: { initial: TeamRequest[] }) {
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  async function decide(request: TeamRequest, decision: "approve" | "reject") {
    setBusy(request.id);
    setErrors(({ [request.id]: _cleared, ...rest }) => rest);
    const reason = reasons[request.id]?.trim();
    const result = await send(
      `/api/team-requests/${request.id}`,
      "PATCH",
      decision === "reject" ? { decision, ...(reason ? { reason } : {}) } : { decision },
    );
    setBusy(null);
    if (!result.ok) return setErrors((all) => ({ ...all, [request.id]: result.error }));
    setRows((all) => all.filter((row) => row.id !== request.id));
    router.refresh();
  }

  if (!rows.length) return null;
  return (
    <section className="mb-10 flex flex-col gap-3">
      <h2 className="text-lg font-semibold">Team requests</h2>
      <ul className="flex flex-col gap-3">
        {rows.map((request) => (
          <li key={request.id} className="flex flex-col gap-2 rounded border p-3 text-sm">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="font-medium">{request.teamName}</span>
              <span>{request.email}</span>
              <span className="font-mono text-xs">
                {request.langName
                  ? `new: ${request.langName} / ${request.langNative ?? ""} (${request.lang})`
                  : `${request.lang} ${nameOf(request)}`}
              </span>
              <span className="text-muted-foreground text-xs" suppressHydrationWarning>
                {age(request.createdAt)}
              </span>
            </div>
            {request.note && <p className="text-muted-foreground">{request.note}</p>}
            {request.branch && <p>{branchText(request.branch, nameOf(request))}</p>}
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" disabled={busy === request.id} onClick={() => decide(request, "approve")}>
                Approve
              </Button>
              <Input
                aria-label="Reason"
                placeholder="Reason (optional)"
                className="w-64"
                value={reasons[request.id] ?? ""}
                onChange={(event) => setReasons({ ...reasons, [request.id]: event.target.value })}
              />
              <Button
                size="sm"
                variant="outline"
                disabled={busy === request.id}
                onClick={() => decide(request, "reject")}
              >
                Reject
              </Button>
            </div>
            {errors[request.id] && (
              <p role="alert" className="text-destructive">
                {errors[request.id]}
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
