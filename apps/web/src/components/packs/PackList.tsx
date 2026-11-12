"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Toaster, useToast } from "@/components/ui/toast";
import type { Pack, Submission } from "@/lib/community/store";

import PackForm, { type VersionOf } from "./PackForm";
import PackStatus from "./PackStatus";

/** The most recent of what the store returns, which is where a new version's fields start. */
function newest(pack: Pack): Submission | null {
  const all = [pack.live, pack.pending, pack.lastRejected].filter((s): s is Submission => s !== null);
  return all.reduce<Submission | null>((best, s) => (!best || BigInt(s.id) > BigInt(best.id) ? s : best), null);
}

const PENDING = "A version is already waiting for review. Withdraw it to submit another.";

// "new" for the new-pack form, a pack for a version of it, null while the form is shut.
type Editing = "new" | VersionOf | null;

// A shell, because useToast needs its provider above the component that raises the toasts.
export default function PackList({ packs }: { packs: Pack[] }) {
  return (
    <Toaster>
      <List packs={packs} />
    </Toaster>
  );
}

function List({ packs }: { packs: Pack[] }) {
  const router = useRouter();
  const toast = useToast();
  const [editing, setEditing] = useState<Editing>(null);
  const [busy, setBusy] = useState<string | null>(null);

  function sent() {
    setEditing(null);
    router.refresh();
    toast({ tone: "info", title: "Sent for review. You'll get an email when it's decided." });
  }

  async function withdraw(pack: Pack) {
    setBusy(pack.id);
    const response = await fetch(`/api/packs/${encodeURIComponent(pack.id)}/submissions/pending`, {
      method: "DELETE",
    }).catch(() => null);
    setBusy(null);
    router.refresh();
    if (response?.ok) return toast({ tone: "info", title: `Withdrew v${pack.pending?.version}.` });
    const { error } = ((await response?.json().catch(() => ({}))) ?? {}) as { error?: string };
    toast({ tone: "error", title: "Could not withdraw it.", detail: error ?? "Could not reach the server." });
  }

  const newPack = (
    <Button onClick={() => setEditing("new")}>
      <Plus aria-hidden />
      New pack
    </Button>
  );

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">My packs</h1>
        {packs.length > 0 && newPack}
      </div>

      {packs.length === 0 ? (
        <div className="mt-6 max-w-xl rounded-lg border border-dashed p-6 text-sm">
          <p className="font-medium">No packs yet</p>
          <p className="text-muted-foreground mt-1 mb-4">
            Send your first pack for review. Once an admin approves it, players can install it from the
            Spoken Manager, and you get an email either way.
          </p>
          {newPack}
        </div>
      ) : (
        <ul className="mt-4 divide-y border-y">
          {packs.map((pack) => {
            const latest = newest(pack);
            return (
              <li key={pack.id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-start">
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    {/* A pack whose only version was withdrawn has no title left to show; its id stands in. */}
                    {latest && <span className="font-medium">{latest.title}</span>}
                    <span className="text-muted-foreground font-mono text-xs">{pack.id}</span>
                    <Badge variant="outline">{pack.lang}</Badge>
                    <span className="text-muted-foreground text-xs">{pack.section}</span>
                  </div>
                  <PackStatus pack={pack} />
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  {pack.pending && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy === pack.id}
                      onClick={() => withdraw(pack)}
                    >
                      Withdraw
                    </Button>
                  )}
                  {/* The span carries the reason: a disabled button gets no hover of its own. */}
                  <span title={pack.pending ? PENDING : undefined}>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={Boolean(pack.pending) || busy === pack.id}
                      onClick={() =>
                        setEditing({
                          id: pack.id,
                          lang: pack.lang,
                          section: pack.section,
                          from: latest,
                          liveVersion: pack.live?.version ?? null,
                        })
                      }
                    >
                      Submit new version
                    </Button>
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {editing && (
        <PackForm pack={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSent={sent} />
      )}
    </>
  );
}
