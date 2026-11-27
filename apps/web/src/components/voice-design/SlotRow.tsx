"use client";

import { ChevronRight, Plus } from "lucide-react";
import { useState } from "react";

import { useUiText } from "@/components/UiTextProvider";
import { fill } from "@/lib/site-text/format";
import { onPage, type Doneness } from "@/lib/voice-design/groups";

import DesignForm from "./DesignForm";
import { ReferenceClip } from "./PlayButton";
import StatusBadge from "./StatusBadge";
import VersionCard from "./VersionCard";
import { useWorkbench } from "./context";
import type { SlotView } from "./Workbench";

/** `open` is the workbench's, so Collapse all reaches every slot. */
export default function SlotRow({ slot, doneness, open, onToggle }: { slot: SlotView; doneness: Doneness; open: boolean; onToggle: () => void }) {
  const t = useUiText().voiceDesign;
  const { viewer, drafts, setDraft } = useWorkbench();
  const draft = drafts[slot.name];
  const [newest, heard] = onPage(slot.designs);
  const [designing, setDesigning] = useState(false);
  const formOpen = designing || draft !== undefined;
  // An open form stays in view: a draft from Revise or Generate all lands in it.
  const shown = open || formOpen;
  const close = () => {
    setDesigning(false);
    setDraft(slot.name, null);
  };

  return (
    <article className="vd-slot" id={`slot-${slot.name}`} aria-labelledby={`slot-${slot.name}-title`}>
      <header
        className="vd-slot-head vd-slot-head-fold"
        // The header's own buttons, the reference clip and First version, do their own thing.
        onClick={(event) => {
          if (!(event.target as HTMLElement).closest("button, a, input")) onToggle();
        }}
      >
        <div className="vd-slot-name">
          <button type="button" className="vd-fold-toggle" aria-expanded={shown} aria-label={slot.name} onClick={onToggle}>
            <ChevronRight className="vd-chevron" size={16} aria-hidden="true" />
          </button>
          <h3 id={`slot-${slot.name}-title`} className="vd-slot-title">
            {slot.name}
          </h3>
          <StatusBadge doneness={doneness} />
        </div>
        <div className="vd-slot-actions">
          {/* A version's card plays the clip beside its previews. */}
          {newest ? null : <ReferenceClip slot={slot} />}
          {viewer.designs && !newest && !formOpen ? (
            <button type="button" className="bs-btn" onClick={() => setDesigning(true)}>
              <Plus size={14} aria-hidden="true" />
              {t.firstVersion}
            </button>
          ) : null}
        </div>
        {/* Folded, a slot is just its name: the header is for finding it. */}
        {shown ? (
          <p className="vd-npcs">
            {slot.npcs.length > 0 ? fill(t.usedBy, { npcs: slot.npcs.join(", "), lines: slot.lineCount }) : t.usedByNobody}
          </p>
        ) : null}
      </header>

      {shown && newest ? <VersionCard key={newest.id} design={newest} slot={slot} newest /> : null}
      {/* Folded so the version being worked on is the one in view; the older one is a click away. */}
      {shown && heard ? <VersionCard key={heard.id} design={heard} slot={slot} newest={false} folded /> : null}

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
    </article>
  );
}
