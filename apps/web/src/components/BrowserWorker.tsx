"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import Link from "@/components/LocaleLink";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PROVIDER_NAME, PROVIDERS, type Provider } from "@/lib/generation/providers";
import {
  cachedVoices,
  localKeys,
  runRound,
  type Answered,
  type ClaimedJob,
  type GenerationMode,
} from "@/lib/worker/protocol";

type Keys = Partial<Record<Provider, string>>;
type Line = { lineId: string; npcName: string; status: Answered["status"] | "running"; message?: string };

/** localStorage key for the provider keys this browser remembers. They are never sent anywhere. */
const STORED = "spoken.worker.keys";
const IDLE_MS = 15_000;

function storedKeys(): Keys {
  try {
    return JSON.parse(localStorage.getItem(STORED) ?? "{}") as Keys;
  } catch {
    return {};
  }
}

/**
 * The keys typed here go to the provider and nowhere else; the site sees only the audio. A
 * provider that refuses a page (CORS) gets the line given back, and the tab stops and points
 * to the Manager.
 */
export default function BrowserWorker({ initialModes }: { initialModes: Record<Provider, GenerationMode> }) {
  const [keys, setKeys] = useState<Keys>({});
  const [remember, setRemember] = useState(false);
  const [running, setRunning] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [error, setError] = useState<string | null>(null);
  const runningRef = useRef(false);
  const keysRef = useRef<Keys>({});
  const [voices] = useState(() => cachedVoices());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const kept = storedKeys();
    if (Object.keys(kept).length > 0) {
      setKeys(kept);
      setRemember(true);
    }
  }, []);

  useEffect(() => {
    keysRef.current = keys;
    try {
      if (remember) localStorage.setItem(STORED, JSON.stringify(keys));
      else localStorage.removeItem(STORED);
    } catch {
      // A browser that keeps nothing still generates; the keys just have to be typed again.
    }
  }, [keys, remember]);

  const local = PROVIDERS.filter((provider) => initialModes[provider] === "local");

  const round = useCallback(async () => {
    if (!runningRef.current) return;
    const usable = localKeys(keysRef.current, initialModes);
    let wait = IDLE_MS;
    try {
      const result = await runRound({
        siteUrl: "",
        keys: usable,
        width: 1,
        voices: () => voices(usable.elevenlabs),
        onLine: ({ job, answered }: { job: ClaimedJob; answered?: Answered }) =>
          setLines((current) => {
            const line: Line = {
              lineId: job.lineId,
              npcName: job.npcName,
              status: answered?.status ?? "running",
              message: answered && "message" in answered ? answered.message : undefined,
            };
            return [line, ...current.filter((other) => other.lineId !== job.lineId)].slice(0, 30);
          }),
      });
      if (result.unreachable) {
        runningRef.current = false;
        setRunning(false);
        setError(
          `This browser could not reach the provider (${result.unreachable}). Providers may refuse calls from a web page; ` +
            "the line went back to the queue. Use the Spoken Manager instead.",
        );
        return;
      }
      setError(null);
      if (result.claimed > 0) wait = 0;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      wait = 60_000;
    }
    if (runningRef.current) timer.current = setTimeout(() => void round(), wait);
  }, [initialModes, voices]);

  const start = () => {
    runningRef.current = true;
    setRunning(true);
    setError(null);
    void round();
  };
  const stop = () => {
    runningRef.current = false;
    setRunning(false);
    if (timer.current) clearTimeout(timer.current);
  };
  useEffect(() => () => stop(), []);

  return (
    <section className="mt-4 max-w-2xl space-y-5 text-sm">
      <p className="text-muted-foreground">
        Generates the lines you queue, in this tab, with keys that stay in this browser. Keep the tab open while
        it runs; the{" "}
        <a className="text-foreground underline underline-offset-2" href="https://github.com/rusty-key/spoken-wow/releases?q=manager">
          Spoken Manager
        </a>{" "}
        does the same without a tab.
      </p>

      {local.length === 0 ? (
        <p>
          None of your providers is set to generate on your computer. Choose “On my computer” on your{" "}
          <Link href="/profile" className="underline underline-offset-2">
            profile
          </Link>{" "}
          first.
        </p>
      ) : (
        local.map((provider) => (
          <label key={provider} className="flex items-center gap-3">
            <span className="w-28 font-medium">{PROVIDER_NAME[provider]} key</span>
            <Input
              type="password"
              autoComplete="off"
              className="max-w-sm"
              value={keys[provider] ?? ""}
              onChange={(event) => setKeys((current) => ({ ...current, [provider]: event.target.value.trim() }))}
              disabled={running}
            />
          </label>
        ))
      )}

      <label className="flex items-center gap-2">
        <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />
        Remember the keys in this browser
      </label>

      <div className="flex gap-2">
        {running ? (
          <Button onClick={stop}>Stop</Button>
        ) : (
          <Button onClick={start} disabled={local.length === 0 || !local.some((provider) => keys[provider])}>
            Start
          </Button>
        )}
      </div>

      {error ? <p className="text-destructive">{error}</p> : null}

      {lines.length > 0 ? (
        <ul className="space-y-1">
          {lines.map((line) => (
            <li key={line.lineId} className="flex gap-3">
              <span className="w-20 shrink-0 text-xs uppercase">{line.status}</span>
              <span className="truncate">
                {line.npcName} · {line.lineId}
                {line.message ? <span className="text-muted-foreground">: {line.message}</span> : null}
              </span>
            </li>
          ))}
        </ul>
      ) : running ? (
        <p className="text-muted-foreground">Waiting for queued lines.</p>
      ) : null}
    </section>
  );
}
