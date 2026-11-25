"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useUiText } from "@/components/UiTextProvider";
import { send } from "@/lib/send";
import { fill } from "@/lib/site-text/format";
import { requestLangName as nameOf } from "@/lib/teams/branch-text";
import type { TeamRequest } from "@/lib/teams/requests";
import type { UiText } from "@/lib/ui-text/en";

function age(createdAt: string, words: UiText["teams"]): string {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(createdAt).getTime()) / 60_000));
  if (minutes < 60) return fill(words.ageMinutes, { n: minutes });
  const hours = Math.floor(minutes / 60);
  return hours < 48 ? fill(words.ageHours, { n: hours }) : fill(words.ageDays, { n: Math.floor(hours / 24) });
}

type Props = {
  initial: TeamRequest[];
  /** By request id: the team a request's new team could start from, where its language has one. */
  besides?: Partial<Record<string, { id: string; name: string }>>;
};

export default function TeamRequests({ initial, besides = {} }: Props) {
  const t = useUiText().teams;
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  // router.refresh() brings a new `initial` but keeps this state, so a request sent meanwhile
  // would stay hidden.
  const [shown, setShown] = useState(initial);
  if (initial !== shown) {
    setShown(initial);
    setRows(initial);
  }
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [copies, setCopies] = useState<Record<string, boolean>>({});

  async function decide(request: TeamRequest, decision: "approve" | "reject") {
    setBusy(request.id);
    setErrors(({ [request.id]: _cleared, ...rest }) => rest);
    const reason = reasons[request.id]?.trim();
    const result = await send(
      `/api/team-requests/${request.id}`,
      "PATCH",
      decision === "reject"
        ? { decision, ...(reason ? { reason } : {}) }
        : besides[request.id]
          ? copies[request.id]
            ? // The team named on the page, so a team that joined since cannot take its place.
              { decision, settings: "copy", from: besides[request.id]!.id }
            : { decision, settings: "fresh" }
          : { decision },
    );
    setBusy(null);
    if (!result.ok) return setErrors((all) => ({ ...all, [request.id]: result.error }));
    setRows((all) => all.filter((row) => row.id !== request.id));
    router.refresh();
  }

  if (!rows.length) return null;
  return (
    <section className="mb-10 flex flex-col gap-3">
      <h2 className="text-lg font-semibold">{t.requests}</h2>
      <ul className="flex flex-col gap-3">
        {rows.map((request) => (
          <li key={request.id} className="flex flex-col gap-2 rounded border p-3 text-sm">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="font-medium">{request.teamName}</span>
              <span>{request.email}</span>
              <span className="font-mono text-xs">
                {request.langName
                  ? fill(t.newLanguageLine, {
                      name: request.langName,
                      native: request.langNative ?? "",
                      code: request.lang,
                    })
                  : `${request.lang} ${nameOf(request)}`}
              </span>
              <span className="text-muted-foreground text-xs" suppressHydrationWarning>
                {age(request.createdAt, t)}
              </span>
            </div>
            {request.note && <p className="text-muted-foreground">{request.note}</p>}
            {request.branch && (
              <p>
                {request.branch === "new-language"
                  ? t.branchNewLanguage
                  : fill(t.branchAddTeam, { name: nameOf(request) })}
              </p>
            )}
            {besides[request.id] && (
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={copies[request.id] ?? false}
                  disabled={busy !== null}
                  onChange={(event) => {
                    const checked = event.target.checked;
                    setCopies((was) => ({ ...was, [request.id]: checked }));
                  }}
                />
                {fill(t.startFrom, { name: besides[request.id]!.name })}
              </label>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                aria-label={fill(t.approveFor, { team: request.teamName })}
                disabled={busy !== null}
                onClick={() => decide(request, "approve")}
              >
                {t.approve}
              </Button>
              <Input
                aria-label={fill(t.reasonFor, { team: request.teamName })}
                placeholder={t.reasonPlaceholder}
                className="w-64"
                value={reasons[request.id] ?? ""}
                onChange={(event) => setReasons({ ...reasons, [request.id]: event.target.value })}
              />
              <Button
                size="sm"
                variant="outline"
                aria-label={fill(t.rejectFor, { team: request.teamName })}
                disabled={busy !== null}
                onClick={() => decide(request, "reject")}
              >
                {t.reject}
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
