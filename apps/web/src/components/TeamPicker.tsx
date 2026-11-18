"use client";

import { useId } from "react";

import type { TeamChoice, ViewedTeam } from "@/lib/teams/viewing";

/**
 * Which team's takes the explorer plays, where the language has a second team, and a note
 * while it is another team's: that view is read-only.
 */
export default function TeamPicker({
  teams,
  viewed,
  onPick,
}: {
  teams: TeamChoice[];
  viewed: ViewedTeam | null;
  onPick: (slug: string) => void;
}) {
  const id = useId();
  if (teams.length < 2 || viewed === null) return null;
  const ordered = [...teams].sort((a, b) => Number(b.privileged) - Number(a.privileged));
  return (
    <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      <span className="flex items-center gap-2">
        <label htmlFor={id} className="text-muted-foreground">
          Team
        </label>
        <select
          id={id}
          className="border-input bg-background h-8 rounded-md border px-2 text-sm"
          value={viewed.slug}
          onChange={(event) => onPick(event.target.value)}
        >
          {ordered.map((team) => (
            <option key={team.id} value={team.slug}>
              {team.privileged ? `${team.name} (main)` : team.name}
            </option>
          ))}
        </select>
      </span>
      {!viewed.own && (
        <p className="text-muted-foreground">
          {`You are listening to ${viewed.name}. Their takes play; their work is theirs.`}
        </p>
      )}
    </div>
  );
}
