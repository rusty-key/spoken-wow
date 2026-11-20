"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { Lang } from "@/lib/lang";
import { plural } from "@/lib/plural";
import { SECTION_LABELS } from "@/lib/releases/sections";
import { send } from "@/lib/send";
import type { DeletionPreview } from "@/lib/teams/delete";

/** What goes with the team, one line each, in plain words; nothing for what it has none of. */
export function deletionLines(preview: DeletionPreview, nameOf: (lang: Lang) => string): string[] {
  const { counts } = preview;
  const lines: string[] = [];
  if (preview.packs.length) {
    const packs = preview.packs.map((pack) => `${SECTION_LABELS[pack.section]} in ${nameOf(pack.lang)}`).join(", ");
    lines.push(`${plural(preview.packs.length, "pack")} players can install now will be delisted first: ${packs}.`);
  }
  if (counts.take) lines.push(`${plural(counts.take, "take")} and their history; the audio files stay in the bucket.`);
  if (counts.recording) lines.push(`${plural(counts.recording, "recording")}; the audio files stay in the bucket.`);
  const voices = [counts.voice && plural(counts.voice, "voice"), counts.voice_clone && plural(counts.voice_clone, "voice clone")];
  if (voices.some(Boolean)) lines.push(`${voices.filter(Boolean).join(" and ")}, with its generation settings and lexicon.`);
  if (preview.pending) lines.push(`${plural(preview.pending, "line")} waiting to generate will be cancelled.`);
  const overrides = counts.line_override + counts.text_override;
  if (overrides) lines.push(`${plural(overrides, "text override")}.`);
  if (counts.release_run) lines.push(`${plural(counts.release_run, "release")} in its history.`);
  const { moving, closing } = preview.reports;
  if (moving) lines.push(`${plural(moving, "text report")} will move to another team of the language, or to its text queue.`);
  if (closing) lines.push(`${plural(closing, "open voice report")} will be closed: their takes go with the team.`);
  if (counts.storage_backend) lines.push("Its storage bucket is forgotten; everything in it stays.");
  const people = new Set(preview.members.map((member) => member.email)).size;
  if (people) lines.push(`${plural(people, "person", "people")} will lose what they do in it; text maintainers keep theirs.`);
  for (const { lang, alone } of preview.langs) {
    if (alone) lines.push(`${nameOf(lang)} will be hidden: it has no other team.`);
  }
  return lines;
}

type Props = {
  team: { id: string; slug: string; name: string } | null;
  nameOf: (lang: Lang) => string;
  onClose: () => void;
  /** After the delete was sent, ok or not, with the refusal if there was one. */
  onSent: (error: string | null) => void;
};

/** Lists what goes with the team, and deletes it once its slug is typed. */
export default function DeleteTeamDialog({ team, nameOf, onClose, onSent }: Props) {
  const [preview, setPreview] = useState<DeletionPreview | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setPreview(null);
    setFailed(null);
    setTyped("");
    if (!team) return;
    let live = true;
    fetch(`/api/teams/${team.id}/deletion`)
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!live) return;
        if (response.ok) setPreview(body as DeletionPreview);
        else setFailed((body as { error?: string }).error ?? "Could not read what the team has.");
      })
      .catch(() => live && setFailed("Could not reach the server."));
    return () => {
      live = false;
    };
  }, [team]);

  async function remove() {
    if (!team) return;
    setBusy(true);
    const result = await send(`/api/teams/${team.id}`, "DELETE", { slug: typed.trim() });
    setBusy(false);
    onSent(result.ok ? null : result.error);
  }

  const lines = preview ? deletionLines(preview, nameOf) : [];
  return (
    <Dialog open={team !== null} onOpenChange={(open) => !open && onClose()}>
      {team && (
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {team.name}?</DialogTitle>
            <DialogDescription>
              {preview?.refusal ??
                failed ??
                (preview ? "This cannot be undone. Deleted with it:" : "Reading what the team has…")}
            </DialogDescription>
          </DialogHeader>
          {preview && !preview.refusal && (
            <>
              <ul className="list-disc pl-5 text-sm">
                {lines.length ? lines.map((line) => <li key={line}>{line}</li>) : <li>Nothing but its name.</li>}
              </ul>
              <label className="flex flex-col gap-1 text-sm">
                <span>
                  Type <span className="font-mono">{team.slug}</span> to confirm
                </span>
                <Input aria-label="Team slug" value={typed} onChange={(event) => setTyped(event.target.value)} />
              </label>
            </>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={busy || !preview || preview.refusal !== null || typed.trim() !== team.slug}
              onClick={remove}
            >
              Delete team
            </Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  );
}
