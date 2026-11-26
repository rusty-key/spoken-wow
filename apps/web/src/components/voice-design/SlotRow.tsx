"use client";

import { ChevronRight, Play, Plus } from "lucide-react";
import { useState } from "react";

import { useUiText } from "@/components/UiTextProvider";
import { fill } from "@/lib/site-text/format";
import type { Doneness } from "@/lib/voice-design/groups";

import DesignForm from "./DesignForm";
import StatusBadge from "./StatusBadge";
import VersionCard from "./VersionCard";
import { useWorkbench } from "./context";
import type { SlotView } from "./Workbench";

export default function SlotRow({ slot, doneness }: { slot: SlotView; doneness: Doneness }) {
  const t = useUiText().voiceDesign;
  const { viewer, drafts, setDraft, play } = useWorkbench();
  const draft = drafts[slot.name];
  const [newest, ...older] = slot.designs;
  const [designing, setDesigning] = useState(false);
  const formOpen = designing || draft !== undefined;
  const close = () => {
    setDesigning(false);
    setDraft(slot.name, null);
  };

  return (
    <article className="vd-slot" id={`slot-${slot.name}`} aria-labelledby={`slot-${slot.name}-title`}>
      <header className="vd-slot-head">
        <div className="vd-slot-name">
          <h3 id={`slot-${slot.name}-title`} className="vd-slot-title">
            {slot.name}
          </h3>
          <StatusBadge doneness={doneness} />
        </div>
        <div className="vd-slot-actions">
          {slot.reference ? (
            <button
              type="button"
              className="bs-btn bs-btn-text"
              title={t.gameClipNote}
              onClick={() => play({ src: slot.reference!, title: slot.name, meta: t.gameReference, subtitle: t.gameClipNote })}
            >
              <Play size={14} aria-hidden="true" />
              {t.gameReference}
            </button>
          ) : (
            <span className="vd-muted" title={t.gameClipNote}>
              {t.noGameReference}
            </span>
          )}
          {viewer.designs && !newest && !formOpen ? (
            <button type="button" className="bs-btn" onClick={() => setDesigning(true)}>
              <Plus size={14} aria-hidden="true" />
              {t.firstVersion}
            </button>
          ) : null}
        </div>
        <p className="vd-npcs">
          {slot.npcs.length > 0 ? fill(t.usedBy, { npcs: slot.npcs.join(", "), lines: slot.lineCount }) : t.usedByNobody}
        </p>
      </header>

      {newest ? <VersionCard key={newest.id} design={newest} slot={slot} newest /> : null}

      {formOpen ? (
        <div id={`design-${slot.name}`}>
          <DesignForm
            // A draft arriving while the form is open replaces what it shows; the form reads it once.
            key={draft ? `${draft.from}\n${draft.prompt}` : "manual"}
            slot={slot}
            initial={draft ?? null}
            onDone={close}
          />
        </div>
      ) : null}

      {older.length > 0 ? (
        <details className="vd-older">
          <summary className="vd-older-head">
            <ChevronRight className="vd-chevron" size={14} aria-hidden="true" />
            {fill(t.olderVersions, { n: older.length })}
          </summary>
          {older.map((design) => (
            <VersionCard key={design.id} design={design} slot={slot} newest={false} />
          ))}
        </details>
      ) : null}
    </article>
  );
}
