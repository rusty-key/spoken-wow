/**
 * Sends the follow-up emails on the droplet without anyone opening a page: every quarter hour,
 * in pm2's first worker only, so two workers never mail the same address twice in a round.
 */
import "server-only";

import { sendVoicesChangedEmail } from "@/lib/email";
import { every } from "@/lib/every";
import { langName, type Lang } from "@/lib/lang";
import { runsOnDroplet } from "@/lib/releases/droplet";
import { onShutdown } from "@/lib/shutdown";

import { listenUrl, sendDue, unsubscribeUrl, type ChangedVoice } from "./follow";
import { slotLabel } from "./label";

const TICK_MS = 15 * 60 * 1000;

function deliver(to: string, voices: ChangedVoice[]): Promise<boolean> {
  return sendVoicesChangedEmail(
    to,
    voices.map((voice) => ({ name: slotLabel(voice.slot), langName: langName(voice.lang as Lang), listen: listenUrl(voice.lang as Lang) })),
    unsubscribeUrl(to),
  );
}

const key = Symbol.for("spoken.voiceFollow.tick");
type Holder = { [key]?: { stop: (waitMs?: number) => Promise<void> } };

export function ensureFollowTick(): void {
  if (!runsOnDroplet() || (process.env.NODE_APP_INSTANCE ?? "0") !== "0") return;
  const holder = globalThis as Holder;
  if (holder[key]) return;
  const tick = every(TICK_MS, "voice follow: could not send the follow-up emails:", () => sendDue(new Date(), deliver));
  holder[key] = tick;
  onShutdown(() => tick.stop());
}
