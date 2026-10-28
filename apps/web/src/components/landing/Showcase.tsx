"use client";

import Image from "next/image";
import { useState } from "react";

import Link from "@/components/LocaleLink";

import VoicePlayer, { VoicePlaceholder } from "./VoicePlayer";
import { VOICES } from "./voices";

type Part = {
  id: string;
  title: string;
  /** Where "Browse" goes; none for a part with no page on the site yet. */
  href?: string;
  /** The game's own icon for the part, as the settings page shows it. */
  icon: string;
  summary: string;
  facts: string[];
};

const PARTS: Part[] = [
  {
    id: "quests",
    title: "Quests",
    href: "/quests",
    icon: "/landing/icons/game-quests.png",
    summary: "Quest givers speak the accept and completion text when you open a quest.",
    facts: [
      "A voice that fits the speaker's race and sex",
      "Several NPCs can share one quest, such as the class trainers",
      "Names, and most classes and races, are read as “adventurer”",
    ],
  },
  {
    id: "gossip",
    title: "Gossip",
    href: "/gossip",
    icon: "/landing/icons/game-gossip.png",
    summary: "Innkeepers, guards and vendors greet you and answer when you talk to them.",
    facts: [
      "Greetings and replies, voiced per NPC",
      "A guard line is shared by every guard that says it",
      "Silence NPC Voices mutes the game's own voice for the same NPC",
    ],
  },
  {
    id: "places",
    title: "Places",
    href: "/places",
    icon: "/landing/icons/game-places.png",
    summary: "A narrator tells the lore of each zone and area as you enter it.",
    facts: [
      "Zone and subzone lore, one recording per place",
      "Starts when you cross into the area",
      "Available in ten languages",
    ],
  },
  {
    id: "readables",
    title: "Readables",
    href: "/readables",
    icon: "/landing/icons/game-readables.png",
    summary: "Books, letters, notes and plaques you open in the world are read aloud.",
    facts: ["Has its own on/off switch in Spoken's settings", "Stop and Replay work on every line", "Book pages with no voice yet can be contributed"],
  },
  {
    id: "bosses",
    title: "Bosses",
    href: "/bosses",
    icon: "/landing/icons/game-bosses.png",
    summary: "A boss's story shows in the narrator when you target it or when it dies.",
    facts: [
      "Words only: a boss's story has no voice yet",
      "Shown once for each boss on each character",
      "Pick target or kill under Show a Boss's Story",
    ],
  },
];

/**
 * The parts of Spoken as a list on the left and a stage on the right. The stage is a polite live
 * region, so a screen reader hears the part that was picked. Only the picked part's player
 * is mounted, and its audio downloads when played.
 */
export default function Showcase() {
  const [index, setIndex] = useState(0);
  const part = PARTS[index];
  const voices = VOICES[part.id];

  return (
    <div className="bn-showcase">
      <ul className="bn-parts" aria-label="Parts of Spoken">
        {PARTS.map((entry, i) => (
          <li key={entry.id}>
            <button type="button" className="bn-part" aria-pressed={i === index} onClick={() => setIndex(i)}>
              <Image src={entry.icon} alt="" width={64} height={64} unoptimized />
              <span>
                <b>{entry.title}</b>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <div className="bn-stage-part">
        <div className="bn-stage-art">
          {voices ? (
            <VoicePlayer key={part.id} voices={voices} label={part.title.toLowerCase()} />
          ) : (
            <VoicePlaceholder icon={part.icon} name={part.title} text="Boss stories show as words in the narrator for now. Their voices come later." />
          )}
        </div>
        <div className="bn-stage-body" aria-live="polite">
          <p>{part.summary}</p>
          <ul>
            {part.facts.map((fact) => (
              <li key={fact}>{fact}</li>
            ))}
          </ul>
          {part.href && (
            <Link href={part.href} className="bn-textlink">
              Browse the {part.title.toLowerCase()}
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
