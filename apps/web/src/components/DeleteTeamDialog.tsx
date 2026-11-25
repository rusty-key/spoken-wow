"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useUiText } from "@/components/UiTextProvider";
import type { Lang } from "@/lib/lang";
import { SECTION_LABELS } from "@/lib/releases/sections";
import { send } from "@/lib/send";
import { fill } from "@/lib/site-text/format";
import type { DeletedTable, DeletionPreview } from "@/lib/teams/delete";
import { EN, type UiText } from "@/lib/ui-text/en";

/** A team's setup beside its voices, which the voices' line names. */
const SETUP: readonly DeletedTable[] = [
  "voice_assignment", "voice_sample", "fish_reference", "generation_setting_locale", "generation_setting",
  "lexicon_change", "pronunciation_lexicon_locale", "pronunciation_lexicon",
];

type Words = UiText["teams"];
type Noun = Words["nouns"][keyof Words["nouns"]];

/** Rows no other line names, so a team with only these is not "nothing but its name". */
const OTHER: readonly [DeletedTable, keyof Words["nouns"]][] = [
  ["line_ignore", "ignoredLine"],
  ["line_flag", "lineFlag"],
  ["line_issue", "lineIssue"],
  ["regeneration_batch", "generationBatch"],
  ["regeneration_pause", "generationPause"],
  ["queue_dismissal", "dismissedQueueLine"],
  ["archive_object", "archiveRecord"],
  ["storage_move", "storageMove"],
  ["activity", "activityEntry"],
];

/** "1 line", "2 lines", in the reader's language. */
function count(n: number, noun: Noun, w: Words): string {
  return fill(w.count, { n, noun: n === 1 ? noun.one : noun.many });
}

function listed(items: string[], w: Words): string {
  return items.length > 1 ? fill(w.listJoin, { head: items.slice(0, -1).join(", "), tail: items.at(-1)! }) : items[0];
}

/** What goes with the team, one line each, in plain words; nothing for what it has none of. */
export function deletionLines(
  preview: DeletionPreview,
  nameOf: (lang: Lang) => string,
  w: Words = EN.teams,
): string[] {
  const { counts } = preview;
  const lines: string[] = [];
  const noun = (key: keyof Words["nouns"]) => w.nouns[key];
  if (preview.packs.length) {
    const packs = preview.packs.map((pack) => `${SECTION_LABELS[pack.section]} in ${nameOf(pack.lang)}`).join(", ");
    lines.push(
      fill(w.delistFirst, {
        n: preview.packs.length,
        noun: preview.packs.length === 1 ? noun("pack").one : noun("pack").many,
        list: packs,
      }),
    );
  }
  if (counts.take) {
    lines.push(fill(w.takesHistory, { n: counts.take, noun: counts.take === 1 ? noun("take").one : noun("take").many }));
  }
  if (counts.recording) {
    lines.push(
      fill(w.filesStay, {
        n: counts.recording,
        noun: counts.recording === 1 ? noun("recording").one : noun("recording").many,
      }),
    );
  }
  const voices: string[] = [
    ...(counts.voice ? [count(counts.voice, noun("voice"), w)] : []),
    ...(counts.voice_clone ? [count(counts.voice_clone, noun("voiceClone"), w)] : []),
  ];
  if (voices.length) lines.push(fill(w.withSettings, { voices: listed(voices, w) }));
  else if (SETUP.some((table) => counts[table])) lines.push(w.settingsAndLexicon);
  if (preview.pending) {
    lines.push(
      fill(w.pendingCancelled, {
        n: preview.pending,
        noun: preview.pending === 1 ? noun("line").one : noun("line").many,
      }),
    );
  }
  const overrides = counts.line_override + counts.text_override;
  if (overrides) {
    lines.push(fill(w.overridden, { n: overrides, noun: overrides === 1 ? noun("textOverride").one : noun("textOverride").many }));
  }
  if (counts.release_run) {
    lines.push(
      fill(w.releaseHistory, {
        n: counts.release_run,
        noun: counts.release_run === 1 ? noun("release").one : noun("release").many,
      }),
    );
  }
  const { moving, closing } = preview.reports;
  if (moving) {
    lines.push(
      fill(w.reportsMove, {
        n: moving,
        noun: moving === 1 ? noun("textReport").one : noun("textReport").many,
      }),
    );
  }
  if (closing) {
    lines.push(
      fill(w.reportsClose, {
        n: closing,
        noun: closing === 1 ? noun("voiceReport").one : noun("voiceReport").many,
      }),
    );
  }
  if (counts.storage_backend) lines.push(w.bucketForgotten);
  const also = OTHER.filter(([table]) => counts[table]).map(([table, key]) => count(counts[table], noun(key), w));
  if (also.length) lines.push(fill(w.also, { items: listed(also, w) }));
  const people = new Set(preview.members.map((member) => member.email)).size;
  if (people) {
    lines.push(fill(w.peopleLose, { n: people, noun: people === 1 ? noun("person").one : noun("person").many }));
  }
  for (const { lang, alone } of preview.langs) {
    if (alone) lines.push(fill(w.languageHidden, { name: nameOf(lang) }));
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
  const t = useUiText();
  const words = t.teams;
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
        else setFailed((body as { error?: string }).error ?? words.readFailed);
      })
      .catch(() => live && setFailed(t.packs.unreachable));
    return () => {
      live = false;
    };
  }, [team, words.readFailed, t.packs.unreachable]);

  async function remove() {
    if (!team) return;
    setBusy(true);
    const result = await send(`/api/teams/${team.id}`, "DELETE", { slug: typed.trim() });
    setBusy(false);
    onSent(result.ok ? null : result.error);
  }

  const lines = preview ? deletionLines(preview, nameOf, words) : [];
  return (
    <Dialog open={team !== null} onOpenChange={(open) => !open && onClose()}>
      {team && (
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{fill(words.deleteTitle, { name: team.name })}</DialogTitle>
            <DialogDescription>
              {preview?.refusal ??
                failed ??
                (preview ? words.deleteBody : words.readingTeam)}
            </DialogDescription>
          </DialogHeader>
          {preview && !preview.refusal && (
            <>
              <ul className="list-disc pl-5 text-sm">
                {lines.length ? lines.map((line) => <li key={line}>{line}</li>) : <li>{words.nothingButName}</li>}
              </ul>
              <label className="flex flex-col gap-1 text-sm">
                <span>
                  {words.typeToConfirmBefore}
                  <span className="font-mono">{team.slug}</span>
                  {words.typeToConfirmAfter}
                </span>
                <Input aria-label={words.slugLabel} value={typed} onChange={(event) => setTyped(event.target.value)} />
              </label>
            </>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={onClose}>
              {words.cancel}
            </Button>
            <Button
              variant="destructive"
              disabled={busy || !preview || preview.refusal !== null || typed.trim() !== team.slug}
              onClick={remove}
            >
              {words.deleteTeam}
            </Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  );
}
