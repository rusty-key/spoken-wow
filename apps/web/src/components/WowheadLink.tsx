"use client";

import { useLang } from "@/components/LangProvider";
import { useUiText } from "@/components/UiTextProvider";
import type { NpcType } from "@/lib/line-fields";
import { wowheadEntityUrl, wowheadQuestUrl } from "@/lib/wowhead";

type Target = { questId: number } | { npcType: NpcType; npcId: number };

/**
 * The way out to Wowhead, small enough to sit inside a row's id line.
 *
 * stopPropagation because a row's own click handler toggles it open; the handlers already
 * ignore clicks on an anchor, and this keeps that true if the markup around it changes.
 */
export default function WowheadLink(target: Target) {
  const words = useUiText().common;
  const lang = useLang();
  const href = "questId" in target ? wowheadQuestUrl(lang, target.questId) : wowheadEntityUrl(lang, target.npcType, target.npcId);
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      onClick={(event) => event.stopPropagation()}
      title={words.lookUpOnWowhead}
      className="hover:text-foreground underline underline-offset-2"
    >
      wh
    </a>
  );
}
