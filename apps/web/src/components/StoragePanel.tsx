"use client";

import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DAY_TIME, useLocalDates } from "@/components/useLocalDates";
import { langName, type Lang } from "@/lib/lang";
import type { BackendView, Provider } from "@/lib/storage/backends";
import type { CloudflareAccount } from "@/lib/storage/cloudflare";
import type { MoveView } from "@/lib/storage/moves";
import type { ProbeResult } from "@/lib/storage/probe";
import type { StorageView } from "@/lib/storage/view";
import { cn } from "@/lib/utils";

const HEALTH: Record<BackendView["health"], { text: string; tone: string }> = {
  unchecked: { text: "Not tested", tone: "border-border text-muted-foreground" },
  ok: { text: "Working", tone: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300" },
  failing: { text: "Failing", tone: "border-destructive/40 bg-destructive/10 text-destructive" },
};

type Answer = { backend?: BackendView; test?: ProbeResult | null; move?: MoveView; error?: string };

const POLL_MS = 10_000;

const MOVE_STATE: Record<MoveView["state"], string> = {
  queued: "Waiting to start",
  running: "Moving",
  done: "Done",
  failed: "Stopped on an error",
  cancelled: "Stopped",
};

async function call(url: string, init: RequestInit): Promise<Answer> {
  const res = await fetch(url, { ...init, headers: { "content-type": "application/json" } }).catch(() => null);
  if (!res) return { error: "No answer from the site: reload to see whether it took effect before trying again." };
  if (res.status === 204) return {};
  const answer = (await res.json().catch(() => ({ error: `HTTP ${res.status}` }))) as Answer;
  // A refusal may still carry the bucket and a test's steps, which say why.
  return res.ok ? answer : { ...answer, error: answer.error ?? `HTTP ${res.status}` };
}

/** Where the Cloudflare grant stands when the page loads: just granted, or refused on the way back. */
export type CloudflareReturn = { connected: boolean; error: string | null };

/** A team's own buckets: connect one, test it, send new objects to it, retire it. */
export default function StoragePanel({
  lang,
  initial,
  cloudflare = { connected: false, error: null },
}: {
  lang: Lang;
  initial: StorageView;
  cloudflare?: CloudflareReturn;
}) {
  const [view, setView] = useState(initial);
  const [tests, setTests] = useState<Record<string, ProbeResult>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<{ id: string; action: string } | null>(null);
  // While our archive is still the volume, no team bucket takes anything, whatever it is set to.
  const writing = view.archiveIsBucket ? (view.backends.find((backend) => backend.writing) ?? null) : null;
  const moving = view.moves.find((move) => move.state === "queued" || move.state === "running") ?? null;

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/storage?lang=${lang}`).catch(() => null);
    if (res?.ok) setView((await res.json()) as StorageView);
  }, [lang]);

  // A move advances on the server a chunk a minute; its count is worth watching.
  useEffect(() => {
    if (!moving) return;
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [moving, refresh]);

  const move = async (from: string | null, to: string | null) => {
    setError(null);
    const answer = await call(`/api/storage/moves?lang=${lang}`, { method: "POST", body: JSON.stringify({ from, to }) });
    if (answer.error) return setError(answer.error);
    // Shown at once, and the polling that follows it starts, even if the refresh is slow.
    if (answer.move) setView((current) => ({ ...current, moves: [answer.move!, ...current.moves] }));
    await refresh();
  };

  const stopMove = async (id: string) => {
    const answer = await call(`/api/storage/moves/${id}?lang=${lang}`, { method: "DELETE" });
    if (answer.error) return setError(answer.error);
    await refresh();
  };

  const nameOf = (id: string | null, label: string | null) =>
    id ? (view.backends.find((b) => b.id === id)?.label ?? label ?? "a removed bucket") : label ? `${label} (removed)` : "Spoken's archive";

  const replace = (backend: BackendView) =>
    setView((current) => {
      const known = current.backends.some((b) => b.id === backend.id);
      const backends = known ? current.backends.map((b) => (b.id === backend.id ? backend : b)) : [...current.backends, backend];
      // Switching one on switches the others off.
      return { ...current, backends: backend.writing ? backends.map((b) => (b.id === backend.id ? b : { ...b, writing: false })) : backends };
    });

  /** True when the server took the change. */
  const act = async (id: string, init: RequestInit, label: string): Promise<boolean> => {
    setBusy({ id, action: label });
    setError(null);
    const answer = await call(`/api/storage/${id}?lang=${lang}`, init);
    setBusy(null);
    if (answer.test) setTests((current) => ({ ...current, [id]: answer.test! }));
    else if (label === "test" || label === "rekey") {
      // No test, or one about a configuration since replaced: older steps would mislead.
      setTests(({ [id]: _stale, ...rest }) => rest);
    }
    if (answer.error) {
      setError(answer.error);
      return false;
    }
    if (init.method === "DELETE") {
      setView((current) => ({ ...current, backends: current.backends.filter((b) => b.id !== id) }));
      return true;
    }
    if (answer.backend) replace(answer.backend);
    return true;
  };

  const post = (id: string, action: string) => act(id, { method: "POST", body: JSON.stringify({ action }) }, action);

  return (
    <div className="flex flex-col gap-6">
      <section className="bg-card rounded-lg border p-4 text-sm">
        <p>
          New takes, recordings and clone clips of {view.team.name} ({view.team.langs.map(langName).join(", ")}) go to{" "}
          <span className="font-medium">
            {writing ? `${writing.label} (${writing.bucket})` : view.ownStorage ? "nowhere yet" : "Spoken's archive"}
          </span>
          .
        </p>
        {view.ownStorage && !writing && (
          <p className="text-destructive mt-2">
            Your team keeps its audio only in its own bucket. Until one is connected, tested and switched on, nothing
            can be generated, recorded or uploaded.
          </p>
        )}
        <p className="text-muted-foreground mt-2">
          Your bucket is yours: Spoken never deletes your audio from it (only its own test object under probe/), and
          what you delete there is gone, so that line reads as unvoiced. We recommend versioning or an object lock, and a key that can read and write but not delete. What
          is already in Spoken&apos;s archive stays there.
        </p>
        {!view.archiveIsBucket && (
          <p className="text-destructive mt-2">This site still keeps its archive on disk, so a team bucket cannot be switched on yet.</p>
        )}
        {!view.canSeal && <p className="text-destructive mt-2">SPOKEN_STORAGE_KEY is not set on this site, so no bucket can be saved.</p>}
      </section>

      {error && <p className="text-destructive text-sm">{error}</p>}

      {view.moves.length > 0 && (
        <section className="bg-card flex flex-col gap-2 rounded-lg border p-4 text-sm">
          <h2 className="font-medium">Moves</h2>
          {view.moves.map((m) => (
            <MoveLine key={m.id} move={m} from={nameOf(m.fromBackendId, m.fromLabel)} to={nameOf(m.toBackendId, m.toLabel)} onStop={() => void stopMove(m.id)} />
          ))}
        </section>
      )}

      {view.backends.map((backend) => (
        <BackendCard
          key={backend.id}
          backend={backend}
          test={tests[backend.id]}
          // Every card waits while any change is in flight, so two never cross on the active bucket.
          busy={busy ? (busy.id === backend.id ? busy.action : "other") : null}
          canWrite={view.archiveIsBucket}
          onAction={(action) => void post(backend.id, action)}
          onRemove={() => void act(backend.id, { method: "DELETE" }, "remove")}
          onRekey={(fields) => act(backend.id, { method: "PATCH", body: JSON.stringify(fields) }, "rekey")}
          moving={moving !== null}
          ownStorage={view.ownStorage}
          onMoveIn={() => void move(null, backend.id)}
          onMoveOut={() => void move(backend.id, null)}
          onMoveTo={(to) => void move(backend.id, to)}
          others={view.backends.filter((b) => b.id !== backend.id && b.health === "ok" && !b.retiredAt)}
        />
      ))}

      {view.canSeal && view.cloudflare && (
        <ConnectCloudflare
          lang={lang}
          returned={cloudflare}
          onConnected={(backend, test) => {
            replace(backend);
            if (test) setTests((current) => ({ ...current, [backend.id]: test }));
          }}
        />
      )}

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
  moving,
  ownStorage,
  onMoveIn,
  onMoveOut,
  onMoveTo,
  others,
}: {
  backend: BackendView;
  test: ProbeResult | undefined;
  busy: string | null;
  canWrite: boolean;
  onAction: (action: "test" | "write" | "stop" | "retire") => void;
  onRemove: () => void;
  onRekey: (fields: { accessKeyId: string; secretAccessKey: string }) => Promise<boolean>;
  /** A move of this team's is queued or running, so no other may start. */
  moving: boolean;
  /** New audio goes only to the team's own bucket: no switching new objects back to Spoken's archive, no move into it. */
  ownStorage: boolean;
  onMoveIn: () => void;
  onMoveOut: () => void;
  onMoveTo: (to: string) => void;
  /** The team's other buckets this one's objects can move into. */
  others: BackendView[];
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
        {backend.writing && !ownStorage && (
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
        {!retired && backend.health === "ok" && (
          <Button size="sm" variant="outline" disabled={busy !== null || moving || !canWrite} onClick={onMoveIn} title="Copies what Spoken's archive holds for this team. Spoken keeps its copy.">
            Copy Spoken&apos;s archive here
          </Button>
        )}
        {backend.objects > 0 && others.length > 0 && (
          <select
            aria-label={`Move ${backend.label}'s objects into another bucket`}
            className="bg-background h-8 rounded-md border px-2 text-sm"
            disabled={busy !== null || moving || !canWrite}
            value=""
            onChange={(event) => event.target.value && onMoveTo(event.target.value)}
          >
            <option value="">Move objects into…</option>
            {others.map((other) => (
              <option key={other.id} value={other.id}>{other.label}</option>
            ))}
          </select>
        )}
        {backend.objects > 0 && !ownStorage && (
          <Button size="sm" variant="outline" disabled={busy !== null || moving || !canWrite} onClick={onMoveOut} title="Copies this bucket's objects into Spoken's archive and reads them from there. Nothing is deleted here.">
            Bring objects back to Spoken&apos;s archive
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
            // Kept on a refusal, so the admin can correct it rather than type it again.
            void onRekey({ accessKeyId: key.accessKeyId.trim(), secretAccessKey: key.secretAccessKey }).then((saved) => {
              if (!saved) return;
              setRekeying(false);
              setKey({ accessKeyId: "", secretAccessKey: "" });
            });
          }}
        >
          <Input className="w-56" placeholder="Access key id" aria-label="Access key id" value={key.accessKeyId} onChange={(e) => setKey({ ...key, accessKeyId: e.target.value })} />
          <Input className="w-72" type="password" autoComplete="off" placeholder="Secret access key" aria-label="Secret access key" value={key.secretAccessKey} onChange={(e) => setKey({ ...key, secretAccessKey: e.target.value })} />
          <Button size="sm" type="submit" disabled={!key.accessKeyId.trim() || !key.secretAccessKey}>Save and test</Button>
          <Button size="sm" type="button" variant="ghost" onClick={() => setRekeying(false)}>Cancel</Button>
        </form>
      )}
    </article>
  );
}

function MoveLine({ move, from, to, onStop }: { move: MoveView; from: string; to: string; onStop: () => void }) {
  const done = move.copied + move.already + move.missing;
  const active = move.state === "queued" || move.state === "running";
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span>
        {from} → {to}: {MOVE_STATE[move.state]}
        {/* The total is counted when the move starts; objects kept since can take it past that. */}
        {move.total !== null && ` · ${done.toLocaleString()} of ${Math.max(done, move.total).toLocaleString()}`}
        {move.missing > 0 && <span className="text-destructive"> · {move.missing.toLocaleString()} missing at the source</span>}
      </span>
      {move.lastError && <span className="text-destructive">{move.lastError}</span>}
      {active && (
        <Button size="sm" variant="ghost" onClick={onStop}>
          Stop
        </Button>
      )}
    </div>
  );
}

/**
 * One click to Cloudflare and back: the site makes the bucket and a key for it alone, then forgets
 * the grant. The grant itself waits in an httpOnly cookie; this only asks which account and name.
 */
function ConnectCloudflare({
  lang,
  returned,
  onConnected,
}: {
  lang: Lang;
  returned: CloudflareReturn;
  onConnected: (backend: BackendView, test: ProbeResult | null) => void;
}) {
  const [accounts, setAccounts] = useState<CloudflareAccount[] | null>(null);
  const [accountId, setAccountId] = useState("");
  const [bucket, setBucket] = useState("");
  const [error, setError] = useState<string | null>(returned.error);
  const [working, setWorking] = useState(false);
  const url = `/api/storage/cloudflare?lang=${lang}`;

  // The query said where the grant stands once; a reload must not say it again.
  useEffect(() => {
    if (!returned.connected && !returned.error) return;
    const here = new URL(window.location.href);
    here.searchParams.delete("cloudflare");
    here.searchParams.delete("cloudflare_error");
    window.history.replaceState(null, "", here);
  }, [returned]);

  useEffect(() => {
    if (!returned.connected) return;
    void (async () => {
      const res = await fetch(url).catch(() => null);
      const answer = (await res?.json().catch(() => null)) as { accounts?: CloudflareAccount[]; bucket?: string; error?: string } | null;
      if (!res?.ok || !answer?.accounts) return setError(answer?.error ?? "Cloudflare's accounts could not be read: connect again.");
      if (answer.accounts.length === 0) return setError("The grant reaches no Cloudflare account: connect again and pick one.");
      setAccounts(answer.accounts);
      setAccountId(answer.accounts[0].id);
      setBucket(answer.bucket ?? "");
    })();
  }, [returned.connected, url]);

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    setWorking(true);
    setError(null);
    const answer = await call(url, { method: "POST", body: JSON.stringify({ accountId, bucket: bucket.trim() }) });
    setWorking(false);
    if (answer.error || !answer.backend) return setError(answer.error ?? "not connected");
    setAccounts(null);
    onConnected(answer.backend, answer.test ?? null);
  };

  const cancel = async () => {
    await call(url, { method: "DELETE" });
    setAccounts(null);
  };

  return (
    <section className="bg-card flex flex-col gap-3 rounded-lg border p-4 text-sm">
      <h2 className="font-medium">Connect Cloudflare R2</h2>
      {accounts ? (
        <form onSubmit={create} className="flex flex-col gap-3">
          <fieldset disabled={working} className="contents">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1">
                <span className="text-muted-foreground">Account</span>
                <select className="bg-background h-9 rounded-md border px-2" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                  {accounts.map((account) => (
                    <option key={account.id} value={account.id}>{account.name}</option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-muted-foreground">Bucket</span>
                <Input aria-label="Bucket" value={bucket} onChange={(e) => setBucket(e.target.value)} />
              </label>
            </div>
            <p className="text-muted-foreground">
              Spoken creates the bucket unless the account already has one by that name, and a key that reads and
              writes objects in it alone. Then it tests the bucket and lets go of the access you granted.
            </p>
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={!bucket.trim()}>{working ? "Setting up…" : "Create and test"}</Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => void cancel()}>Cancel</Button>
            </div>
          </fieldset>
        </form>
      ) : (
        <>
          <p className="text-muted-foreground">
            Sign in to Cloudflare and grant access once: Spoken creates an R2 bucket and its key for you, so there is
            nothing to copy over.
          </p>
          <div>
            <Button asChild size="sm">
              <a href={`/api/storage/cloudflare/start?lang=${lang}`}>Connect Cloudflare</a>
            </Button>
          </div>
        </>
      )}
      {error && <p className="text-destructive">{error}</p>}
    </section>
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
      {/* Held while saving: the form clears when the save returns, and would take edits with it. */}
      <fieldset disabled={saving} className="contents">
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
        The key needs to read and write objects (GetObject and PutObject; on Amazon S3 also ListBucket, without
        which a missing object answers 403 rather than 404). Without a public address the site hands listeners signed
        addresses that expire. Saving tests the bucket; nothing goes to it until you switch it on.
      </p>
      </fieldset>
      {error && <p className="text-destructive">{error}</p>}
      <div>
        <Button type="submit" size="sm" disabled={saving}>{saving ? "Saving…" : "Save and test"}</Button>
      </div>
    </form>
  );
}
