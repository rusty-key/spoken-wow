"use client";

import { Loader2, Trash2 } from "lucide-react";
import { useState } from "react";

import { useUiText } from "@/components/UiTextProvider";
import { withLang } from "@/lib/lang";
import { fill } from "@/lib/site-text/format";
import type { Design } from "@/lib/voice-design/types";

import { send, useWorkbench } from "./context";
import type { SlotView } from "./Workbench";

/** Every version below its slot's newest whose voice is still in the viewer's ElevenLabs account. */
export function olderVoices(slots: SlotView[], viewerId: string): Design[] {
  return slots.flatMap((slot) =>
    slot.designs.slice(1).filter((design) => design.voiceId !== null && design.voiceDeletedAt === null && design.holderId === viewerId),
  );
}

/**
 * Frees the account's voice slots that old versions hold. Each goes through the version's own
 * delete, so a voice since adopted into a slot on /voices is refused rather than silenced.
 */
export default function DeleteOlder({ slots }: { slots: SlotView[] }) {
  const t = useUiText().voiceDesign;
  const { lang, viewer, updateDesign } = useWorkbench();
  const [confirm, setConfirm] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const older = olderVoices(slots, viewer.id);

  async function deleteAll() {
    setConfirm(false);
    setLog([]);
    // One at a time: two deletes in the same account would each list it while the other changes it.
    for (const [index, design] of older.entries()) {
      setProgress({ done: index, total: older.length });
      try {
        const { design: updated } = await send<{ design: Design }>(withLang(lang, `/api/voices/design/${design.id}/voice`), { method: "DELETE" });
        updateDesign(updated);
      } catch (err) {
        setLog((lines) => [...lines, `${design.slot} v${design.version}: ${err instanceof Error ? err.message : String(err)}`]);
      }
    }
    setProgress(null);
  }

  if (older.length === 0 && progress === null && log.length === 0) return null;
  return (
    <div className="vd-revise-all">
      {confirm ? (
        <span className="vd-confirm">
          {fill(t.deleteOlderConfirm, { n: older.length })}
          <button type="button" className="bs-btn bs-btn-danger" onClick={() => void deleteAll()}>
            <Trash2 size={14} aria-hidden="true" />
            {t.deleteOlderGo}
          </button>
          <button type="button" className="bs-btn bs-btn-text" onClick={() => setConfirm(false)}>
            {t.cancel}
          </button>
        </span>
      ) : (
        <button
          type="button"
          className="bs-btn bs-btn-danger"
          title={t.deleteOlderTitle}
          disabled={progress !== null || older.length === 0}
          onClick={() => setConfirm(true)}
        >
          {progress ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Trash2 size={14} aria-hidden="true" />}
          {progress ? fill(t.deleteOlderProgress, { n: progress.done + 1, total: progress.total }) : fill(t.deleteOlder, { n: older.length })}
        </button>
      )}
      {log.length > 0 ? (
        <ul className="vd-import-log" role="alert">
          {log.map((line, index) => (
            <li key={index}>{line}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
