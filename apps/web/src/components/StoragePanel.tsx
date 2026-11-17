"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DAY_TIME, useLocalDates } from "@/components/useLocalDates";
import { langName, type Lang } from "@/lib/lang";
import type { BackendView, Provider } from "@/lib/storage/backends";
import type { ProbeResult } from "@/lib/storage/probe";
import type { StorageView } from "@/lib/storage/view";
import { cn } from "@/lib/utils";

const HEALTH: Record<BackendView["health"], { text: string; tone: string }> = {
  unchecked: { text: "Not tested", tone: "border-border text-muted-foreground" },
  ok: { text: "Working", tone: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300" },
  failing: { text: "Failing", tone: "border-destructive/40 bg-destructive/10 text-destructive" },
};

type Answer = { backend?: BackendView; test?: ProbeResult | null; error?: string };

async function call(url: string, init: RequestInit): Promise<Answer> {
  const res = await fetch(url, { ...init, headers: { "content-type": "application/json" } });
  if (res.status === 204) return {};
  const answer = (await res.json().catch(() => ({ error: `HTTP ${res.status}` }))) as Answer;
  return res.ok ? answer : { error: answer.error ?? `HTTP ${res.status}` };
}

/** A team's own buckets: connect one, test it, send new objects to it, retire it. */
export default function StoragePanel({ lang, initial }: { lang: Lang; initial: StorageView }) {
  const [view, setView] = useState(initial);
  const [tests, setTests] = useState<Record<string, ProbeResult>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<{ id: string; action: string } | null>(null);
  const writing = view.backends.find((backend) => backend.writing) ?? null;

  const replace = (backend: BackendView) =>
    setView((current) => {
      const known = current.backends.some((b) => b.id === backend.id);
      const backends = known ? current.backends.map((b) => (b.id === backend.id ? backend : b)) : [...current.backends, backend];
      // Switching one on switches the others off.
      return { ...current, backends: backend.writing ? backends.map((b) => (b.id === backend.id ? b : { ...b, writing: false })) : backends };
    });

  const act = async (id: string, init: RequestInit, label: string) => {
    setBusy({ id, action: label });
    setError(null);
    const answer = await call(`/api/storage/${id}?lang=${lang}`, init);
    setBusy(null);
    if (answer.error) return setError(answer.error);
    if (init.method === "DELETE") {
      setView((current) => ({ ...current, backends: current.backends.filter((b) => b.id !== id) }));
      return;
    }
    if (answer.backend) replace(answer.backend);
    if (answer.test) setTests((current) => ({ ...current, [id]: answer.test! }));
  };

  const post = (id: string, action: string) => act(id, { method: "POST", body: JSON.stringify({ action }) }, action);

  return (
    <div className="flex flex-col gap-6">
      <section className="bg-card rounded-lg border p-4 text-sm">
        <p>
          New takes, recordings and clone clips of {view.team.name} ({view.team.langs.map(langName).join(", ")}) go to{" "}
          <span className="font-medium">{writing ? `${writing.label} (${writing.bucket})` : "Spoken's archive"}</span>.
        </p>
        <p className="text-muted-foreground mt-2">
          Your bucket is yours: Spoken never deletes from it, and what you delete there is gone, so that line reads as
          unvoiced. We recommend versioning or an object lock, and a key that can read and write but not delete. What
          is already in Spoken&apos;s archive stays there.
        </p>
        {!view.archiveIsBucket && (
          <p className="text-destructive mt-2">This site still keeps its archive on disk, so a team bucket cannot be switched on yet.</p>
        )}
        {!view.canSeal && <p className="text-destructive mt-2">SPOKEN_STORAGE_KEY is not set on this site, so no bucket can be saved.</p>}
      </section>

      {error && <p className="text-destructive text-sm">{error}</p>}

      {view.backends.map((backend) => (
        <BackendCard
          key={backend.id}
          backend={backend}
          test={tests[backend.id]}
          busy={busy?.id === backend.id ? busy.action : null}
          canWrite={view.archiveIsBucket}
          onAction={(action) => void post(backend.id, action)}
          onRemove={() => void act(backend.id, { method: "DELETE" }, "remove")}
          onRekey={(fields) => void act(backend.id, { method: "PATCH", body: JSON.stringify(fields) }, "rekey")}
        />
      ))}

      {view.canSeal && (
        <NewBackend
          providers={view.providers}
          onSaved={async (backend) => {
            replace(backend);
            await post(backend.id, "test");
          }}
          lang={lang}
        />
      )}
    </div>
  );
}

function BackendCard({
  backend,
  test,
  busy,
  canWrite,
  onAction,
  onRemove,
  onRekey,
}: {
  backend: BackendView;
  test: ProbeResult | undefined;
  busy: string | null;
  canWrite: boolean;
  onAction: (action: "test" | "write" | "stop" | "retire") => void;
  onRemove: () => void;
  onRekey: (fields: { accessKeyId: string; secretAccessKey: string }) => void;
}) {
  const date = useLocalDates();
  const [rekeying, setRekeying] = useState(false);
  const [key, setKey] = useState({ accessKeyId: "", secretAccessKey: "" });
  const health = HEALTH[backend.health];
  const retired = backend.retiredAt !== null;
  return (
    <article className={cn("bg-card flex flex-col gap-3 rounded-lg border p-4 text-sm", backend.writing && "border-primary/40")}>
      <header className="flex flex-wrap items-center gap-2">
        <h2 className="font-medium">{backend.label}</h2>
        <span className={cn("rounded-full border px-2 py-0.5 text-xs", health.tone)}>{health.text}</span>
        {backend.writing && <span className="border-primary/35 bg-primary/10 text-primary-ink rounded-full border px-2 py-0.5 text-xs">New objects go here</span>}
        {retired && <span className="text-muted-foreground rounded-full border px-2 py-0.5 text-xs">Retired</span>}
      </header>
      <dl className="text-muted-foreground grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
        <dt>Bucket</dt>
        <dd className="font-mono text-xs">{backend.endpoint}/{backend.bucket}</dd>
        <dt>Public address</dt>
        <dd className="font-mono text-xs">{backend.publicUrl ?? "none: signed addresses"}</dd>
        <dt>Key</dt>
        <dd className="font-mono text-xs">{backend.accessKeyId}</dd>
        <dt>Holds</dt>
        <dd>
          {backend.objects.toLocaleString()} objects
          {backend.pending > 0 && `, ${backend.pending.toLocaleString()} waiting to be written`}
          {backend.missing > 0 && <span className="text-destructive">, {backend.missing.toLocaleString()} missing</span>}
        </dd>
        {backend.checkedAt && (
          <>
            <dt>Tested</dt>
            <dd>{date(backend.checkedAt, DAY_TIME)}</dd>
          </>
        )}
      </dl>
      {backend.lastError && <p className="text-destructive">{backend.lastError}</p>}
      {test && (
        <ul className="flex flex-col gap-0.5">
          {test.steps.map((step) => (
            <li key={step.name} className={step.ok ? "text-emerald-300" : "text-destructive"}>
              {step.ok ? "✓" : "✗"} {step.name}
              {step.detail && <span className="text-muted-foreground">: {step.detail}</span>}
            </li>
          ))}
          {test.ok && !test.conditionalPut && (
            <li className="text-muted-foreground">This bucket replaces objects on a second write, so Spoken looks before it writes.</li>
          )}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => onAction("test")}>
          {busy === "test" ? "Testing…" : "Test"}
        </Button>
        {!retired && !backend.writing && (
          <Button size="sm" disabled={busy !== null || !canWrite || backend.health !== "ok"} onClick={() => onAction("write")}>
            Send new objects here
          </Button>
        )}
        {backend.writing && (
          <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => onAction("stop")}>
            Send new objects to Spoken&apos;s archive
          </Button>
        )}
        {!rekeying && (
          <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => setRekeying(true)}>
            Change key
          </Button>
        )}
        {!retired && (
          <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => onAction("retire")}>
            Retire
          </Button>
        )}
        {backend.objects + backend.pending === 0 && (
          <Button size="sm" variant="ghost" disabled={busy !== null} onClick={onRemove}>
            Remove
          </Button>
        )}
      </div>
      {rekeying && (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            onRekey(key);
            setRekeying(false);
            setKey({ accessKeyId: "", secretAccessKey: "" });
          }}
        >
          <Input className="w-56" placeholder="Access key id" aria-label="Access key id" value={key.accessKeyId} onChange={(e) => setKey({ ...key, accessKeyId: e.target.value })} />
          <Input className="w-72" type="password" autoComplete="off" placeholder="Secret access key" aria-label="Secret access key" value={key.secretAccessKey} onChange={(e) => setKey({ ...key, secretAccessKey: e.target.value })} />
          <Button size="sm" type="submit" disabled={!key.accessKeyId || !key.secretAccessKey}>Save and test</Button>
          <Button size="sm" type="button" variant="ghost" onClick={() => setRekeying(false)}>Cancel</Button>
        </form>
      )}
    </article>
  );
}

const EMPTY = { label: "", endpoint: "", region: "", bucket: "", publicUrl: "", accessKeyId: "", secretAccessKey: "" };

function NewBackend({
  providers,
  onSaved,
  lang,
}: {
  providers: StorageView["providers"];
  onSaved: (backend: BackendView) => Promise<void>;
  lang: Lang;
}) {
  const [provider, setProvider] = useState<Provider>("r2");
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const preset = providers.find((p) => p.id === provider)!;
  const field = (name: keyof typeof EMPTY) => ({
    value: form[name],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [name]: e.target.value }),
  });

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    const answer = await call(`/api/storage?lang=${lang}`, {
      method: "POST",
      body: JSON.stringify({ ...form, provider, endpoint: form.endpoint || preset.endpoint, region: form.region || preset.region }),
    });
    setSaving(false);
    if (answer.error || !answer.backend) return setError(answer.error ?? "not saved");
    setForm(EMPTY);
    await onSaved(answer.backend);
  };

  return (
    <form onSubmit={save} className="bg-card flex flex-col gap-3 rounded-lg border p-4 text-sm">
      <h2 className="font-medium">Connect a bucket</h2>
      <label className="flex flex-col gap-1">
        <span className="text-muted-foreground">Provider</span>
        <select className="bg-background h-9 w-72 rounded-md border px-2" value={provider} onChange={(e) => setProvider(e.target.value as Provider)}>
          {providers.map((p) => (
            <option key={p.id} value={p.id}>{p.label}</option>
          ))}
        </select>
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input placeholder={`Endpoint: ${preset.endpoint}`} aria-label="Endpoint" {...field("endpoint")} />
        <Input placeholder={preset.region ? `Region: ${preset.region}` : "Region, e.g. eu-central-1"} aria-label="Region" {...field("region")} />
        <Input placeholder="Bucket" aria-label="Bucket" {...field("bucket")} />
        <Input placeholder="Public address (optional), e.g. https://audio.example.org/" aria-label="Public address" {...field("publicUrl")} />
        <Input placeholder="Access key id" aria-label="Access key id" {...field("accessKeyId")} />
        <Input type="password" autoComplete="off" placeholder="Secret access key" aria-label="Secret access key" {...field("secretAccessKey")} />
        <Input placeholder="Name (optional)" aria-label="Name" {...field("label")} />
      </div>
      <p className="text-muted-foreground">
        The key needs to read, write and look up objects. Without a public address the site hands listeners signed
        addresses that expire. Saving tests the bucket; nothing goes to it until you switch it on.
      </p>
      {error && <p className="text-destructive">{error}</p>}
      <div>
        <Button type="submit" size="sm" disabled={saving}>{saving ? "Saving…" : "Save and test"}</Button>
      </div>
    </form>
  );
}
