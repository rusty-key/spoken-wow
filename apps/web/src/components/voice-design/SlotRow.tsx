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

export default function SlotRow({ slot, doneness }: { slot: SlotView; doneness: Doneness }) {
  const t = useUiText().voiceDesign;
  const { viewer, drafts, setDraft } = useWorkbench();
  const draft = drafts[slot.name];
  const [newest, heard] = onPage(slot.designs);
  const [designing, setDesigning] = useState(false);
  // Folded so the version being worked on is the one in view; the older one is still a click away.
  const [heardOpen, setHeardOpen] = useState(false);
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
          {/* A version's card plays the clip beside its previews. */}
          {newest ? null : <ReferenceClip slot={slot} />}
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
      {heard ? (
        <>
          <button type="button" className="vd-version-fold" aria-expanded={heardOpen} onClick={() => setHeardOpen(!heardOpen)}>
            <ChevronRight className="vd-chevron" size={16} aria-hidden="true" />
            <span className="vd-version-tag">v{heard.version}</span>
            <StatusBadge doneness={heard.reviews.at(-1)?.status ?? "pending"} />
            <span className="vd-tag vd-tag-gold">{t.publicTag}</span>
          </button>
          {heardOpen ? <VersionCard key={heard.id} design={heard} slot={slot} newest={false} /> : null}
        </>
      ) : null}

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
