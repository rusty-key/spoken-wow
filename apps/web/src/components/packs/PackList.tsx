"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Toaster, useToast } from "@/components/ui/toast";
import type { Pack } from "@/lib/community/store";
import { send } from "@/lib/send";

import { newest } from "./common";
import PackForm from "./PackForm";
import PackStatus from "./PackStatus";

const PENDING = "A version is already waiting for review. Withdraw it to submit another.";
const UNLISTED = "An admin unlisted this pack, so it takes no new versions.";
const GUIDE = "https://github.com/rusty-key/spoken-wow/blob/master/community/README.md";

// A null pack for the new-pack form; the whole state is null while the form is shut.
type Editing = { pack: Pack | null } | null;

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
    const result = await send(`/api/packs/${encodeURIComponent(pack.id)}/submissions/pending`, "DELETE");
    setBusy(null);
    router.refresh();
    if (result.ok) return toast({ tone: "info", title: `Withdrew v${pack.pending?.version}.` });
    toast({ tone: "error", title: "Could not withdraw it.", detail: result.body?.error ?? "Could not reach the server." });
  }

  const newPack = (
    <Button onClick={() => setEditing({ pack: null })}>
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
            A community pack is a voice pack you record or generate yourself and host on your own GitHub
            releases. Send it for review: once an admin approves it, players can install it from the
            Spoken Manager, and you get an email either way. What a pack must contain is in the{" "}
            <a href={GUIDE} className="text-foreground underline underline-offset-2">
              community pack guide
            </a>
            .
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
                  <span title={!pack.listed ? UNLISTED : pack.pending ? PENDING : undefined}>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!pack.listed || Boolean(pack.pending) || busy === pack.id}
                      onClick={() => setEditing({ pack })}
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
        <PackForm pack={editing.pack} onClose={() => setEditing(null)} onSent={sent} />
      )}
    </>
  );
}
