"use client";

import Image from "next/image";
import { useState } from "react";

import Link from "@/components/LocaleLink";

import { useSiteText } from "./SiteTextProvider";
import VoicePlayer, { VoicePlaceholder } from "./VoicePlayer";
import { VOICES } from "./voices";

const PARTS = [
  { id: "quests", href: "/quests", icon: "/landing/icons/game-quests.png" },
  { id: "gossip", href: "/gossip", icon: "/landing/icons/game-gossip.png" },
  { id: "places", href: "/places", icon: "/landing/icons/game-places.png" },
  { id: "readables", href: "/readables", icon: "/landing/icons/game-readables.png" },
  { id: "bosses", href: "/bosses", icon: "/landing/icons/game-bosses.png" },
] as const;

/**
 * The parts of Spoken as a list on the left and a stage on the right. The stage is a polite live
 * region, so a screen reader hears the part that was picked. Only the picked part's player
 * is mounted, and its audio downloads when played.
 */
export default function Showcase() {
  const t = useSiteText().showcase;
  const [index, setIndex] = useState(0);
  const part = PARTS[index];
  const text = t[part.id];
  const voices = VOICES[part.id];

  return (
    <div className="bn-showcase">
      <ul className="bn-parts" aria-label={t.partsLabel}>
        {PARTS.map((entry, i) => (
          <li key={entry.id}>
            <button type="button" className="bn-part" aria-pressed={i === index} onClick={() => setIndex(i)}>
              <Image src={entry.icon} alt="" width={64} height={64} unoptimized />
              <span>
                <b>{t[entry.id].title}</b>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <div className="bn-stage-part">
        <div className="bn-stage-art">
          {voices ? (
            <VoicePlayer key={part.id} voices={voices} position={text.position} />
          ) : (
            <VoicePlaceholder icon={part.icon} name={text.title} text={t.noVoice} position={text.position} />
          )}
        </div>
        <div className="bn-stage-body" aria-live="polite">
          <p>{text.summary}</p>
          <ul>
            {text.facts.map((fact) => (
              <li key={fact}>{fact}</li>
            ))}
          </ul>
          <Link href={part.href} className="bn-textlink">
            {text.browse}
          </Link>
        </div>
      </div>
    </div>
  );
}
