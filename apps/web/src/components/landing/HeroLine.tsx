"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

type Line = { icon: string; name: string; subtitle: string; words: string[] };

const LINES: Line[] = [
  {
    icon: "quests",
    name: "Eagan Peltskinner",
    subtitle: "Wolves Across the Border",
    words: "I hate those nasty timber wolves! But I sure like eating.".split(" "),
  },
  {
    icon: "spoken",
    name: "Innkeeper Farley",
    subtitle: "Gossip",
    words: "Welcome to the Lion's Pride Inn. Rest here as long as you like.".split(" "),
  },
  {
    icon: "zones",
    name: "Elwynn Forest",
    subtitle: "Zone lore",
    words: "Green hills roll away from the walls of Stormwind, quiet farms and open road.".split(" "),
  },
];
const WORD_MS = 240;
const PAUSE_STEPS = 10;

/**
 * The in-game subtitle, drawn from the sample in docs/spoken/captions.png: portrait, speaker,
 * subtitle and the line. The words light up as they are "spoken" (the last two in gold), the
 * bar fills with them, and the next line starts after a pause. Under prefers-reduced-motion the
 * first line stays fully lit.
 */
export default function HeroLine() {
  const [line, setLine] = useState(0);
  const [fading, setFading] = useState(false);
  const [spoken, setSpoken] = useState(0);
  const figure = useRef<HTMLElement>(null);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setSpoken(LINES[0].words.length);
      return;
    }
    let current = 0;
    let count = 0;
    let visible = true;
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
    });
    if (figure.current) observer.observe(figure.current);
    const timer = window.setInterval(() => {
      if (!visible || document.hidden) return;
      count += 1;
      const total = LINES[current].words.length;
      if (count === total + PAUSE_STEPS - 2) setFading(true);
      if (count > total + PAUSE_STEPS) {
        current = (current + 1) % LINES.length;
        count = 0;
        setLine(current);
        setFading(false);
      }
      setSpoken(Math.min(count, LINES[current].words.length));
    }, WORD_MS);
    return () => {
      window.clearInterval(timer);
      observer.disconnect();
    };
  }, []);

  const { icon, name, subtitle, words } = LINES[line];

  return (
    <figure ref={figure} className={fading ? "bn-line bn-line-out" : "bn-line"} aria-label="An example of Spoken's subtitles: a character speaking a line">
      <div className="bn-line-portrait">
        <Image src={`/landing/icons/${icon}-192.png`} alt="" width={96} height={96} unoptimized />
      </div>
      <div className="bn-line-box">
        <p className="bn-line-name">{name}</p>
        <p className="bn-line-quest">{subtitle}</p>
        <div className="bn-line-bar" aria-hidden="true">
          <i key={line} style={{ width: `${(spoken / words.length) * 100}%` }} />
        </div>
        <p className="bn-line-text">
          {words.map((word, i) => {
            const on = i < spoken;
            const lit = on && i >= spoken - 2 && spoken < words.length + 1;
            return (
              <span key={`${line}-${i}`} className={on ? (lit ? "on lit" : "on") : undefined}>
                {word}{" "}
              </span>
            );
          })}
        </p>
      </div>
    </figure>
  );
}
