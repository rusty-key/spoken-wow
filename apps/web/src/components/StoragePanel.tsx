"use client";

import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DAY_TIME, useLocalDates } from "@/components/useLocalDates";
import { useUiText } from "@/components/UiTextProvider";
import { langName, type Lang } from "@/lib/lang";
import { fill } from "@/lib/site-text/format";
import type { BackendView, Provider } from "@/lib/storage/backends";
import type { CloudflareAccount } from "@/lib/storage/cloudflare";
import type { MoveView } from "@/lib/storage/moves";
import type { ProbeResult } from "@/lib/storage/probe";
import type { StorageView } from "@/lib/storage/view";
import type { UiText } from "@/lib/ui-text/en";
import { cn } from "@/lib/utils";

const TONE: Record<BackendView["health"], string> = {
  unchecked: "border-border text-muted-foreground",
  ok: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
  failing: "border-destructive/40 bg-destructive/10 text-destructive",
};

type Answer = { backend?: BackendView; test?: ProbeResult | null; move?: MoveView; needsKey?: boolean; why?: string; error?: string };

const POLL_MS = 10_000;

async function call(url: string, init: RequestInit, words: UiText["storage"]): Promise<Answer> {
  const res = await fetch(url, { ...init, headers: { "content-type": "application/json" } }).catch(() => null);
  if (!res) return { error: words.noAnswer };
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
  cloudflare,
}: {
  lang: Lang;
  initial: StorageView;
  cloudflare: CloudflareReturn;
}) {
  const t = useUiText();
  const words = t.storage;
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
    const answer = await call(`/api/storage/moves?lang=${lang}`, { method: "POST", body: JSON.stringify({ from, to }) }, words);
    if (answer.error) return setError(answer.error);
    // Shown at once, and the polling that follows it starts, even if the refresh is slow.
    if (answer.move) setView((current) => ({ ...current, moves: [answer.move!, ...current.moves] }));
    await refresh();
  };

  const stopMove = async (id: string) => {
    const answer = await call(`/api/storage/moves/${id}?lang=${lang}`, { method: "DELETE" }, words);
    if (answer.error) return setError(answer.error);
    await refresh();
  };

  const nameOf = (id: string | null, label: string | null) =>
    id
      ? (view.backends.find((b) => b.id === id)?.label ?? label ?? words.removedBucket)
      : label
        ? fill(words.removedLabel, { label })
        : words.spokenArchive;

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
    const answer = await call(`/api/storage/${id}?lang=${lang}`, init, words);
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
          {fill(words.destinationBefore, {
            team: view.team.name,
            langs: view.team.langs.map(langName).join(", "),
          })}
          <span className="font-medium">
            {writing
              ? fill(words.destinationNamed, { label: writing.label, bucket: writing.bucket })
              : view.ownStorage
                ? words.nowhere
                : words.spokenArchive}
          </span>
          {words.destinationAfter}
        </p>
        {view.ownStorage && !writing && (
          <p className="text-destructive mt-2">
            {words.emptyWarning}
          </p>
        )}
        <p className="text-muted-foreground mt-2">
          {words.archiveNote}
        </p>
        {!view.archiveIsBucket && (
          <p className="text-destructive mt-2">{words.diskArchive}</p>
        )}
        {!view.canSeal && <p className="text-destructive mt-2">{words.noKeySite}</p>}
      </section>

      {error && <p className="text-destructive text-sm">{error}</p>}

      {view.moves.length > 0 && (
        <section className="bg-card flex flex-col gap-2 rounded-lg border p-4 text-sm">
          <h2 className="font-medium">{words.moves}</h2>
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

      {view.canSeal && (
        <NewBackend
          providers={view.providers}
          onSaved={async (backend) => {
            replace(backend);
            await post(backend.id, "test");
          }}
          lang={lang}
          cloudflare={view.cloudflare ? cloudflare : null}
          onConnected={(backend, test) => {
            replace(backend);
            if (test) setTests((current) => ({ ...current, [backend.id]: test }));
          }}
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
  const words = useUiText().storage;
  const [rekeying, setRekeying] = useState(false);
  const [key, setKey] = useState({ accessKeyId: "", secretAccessKey: "" });
  const health = { text: words.health[backend.health], tone: TONE[backend.health] };
  const retired = backend.retiredAt !== null;
  return (
    <article className={cn("bg-card flex flex-col gap-3 rounded-lg border p-4 text-sm", backend.writing && "border-primary/40")}>
      <header className="flex flex-wrap items-center gap-2">
        <h2 className="font-medium">{backend.label}</h2>
        <span className={cn("rounded-full border px-2 py-0.5 text-xs", health.tone)}>{health.text}</span>
        {backend.writing && <span className="border-primary/35 bg-primary/10 text-primary-ink rounded-full border px-2 py-0.5 text-xs">{words.newObjectsHere}</span>}
        {retired && <span className="text-muted-foreground rounded-full border px-2 py-0.5 text-xs">{words.retired}</span>}
      </header>
      <dl className="text-muted-foreground grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
        <dt>{words.bucket}</dt>
        <dd className="font-mono text-xs">{backend.endpoint}/{backend.bucket}</dd>
        <dt>{words.publicAddress}</dt>
        <dd className="font-mono text-xs">{backend.publicUrl ?? words.signedOnly}</dd>
        <dt>{words.key}</dt>
        <dd className="font-mono text-xs">{backend.accessKeyId}</dd>
        <dt>{words.holds}</dt>
        <dd>
          {fill(words.objects, { n: backend.objects.toLocaleString() })}
          {backend.pending > 0 && fill(words.waitingToWrite, { n: backend.pending.toLocaleString() })}
          {backend.missing > 0 && <span className="text-destructive">{fill(words.missing, { n: backend.missing.toLocaleString() })}</span>}
        </dd>
        {backend.checkedAt && (
          <>
            <dt>{words.tested}</dt>
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
            <li className="text-muted-foreground">{words.replaceNote}</li>
          )}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => onAction("test")}>
          {busy === "test" ? words.testing : words.test}
        </Button>
        {!retired && !backend.writing && (
          <Button size="sm" disabled={busy !== null || !canWrite || backend.health !== "ok"} onClick={() => onAction("write")}>
            {words.sendHere}
          </Button>
        )}
        {backend.writing && !ownStorage && (
          <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => onAction("stop")}>
            {words.sendToArchive}
          </Button>
        )}
        {!rekeying && (
          <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => setRekeying(true)}>
            {words.changeKey}
          </Button>
        )}
        {!retired && (
          <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => onAction("retire")}>
            {words.retire}
          </Button>
        )}
        {!retired && backend.health === "ok" && (
          <Button size="sm" variant="outline" disabled={busy !== null || moving || !canWrite} onClick={onMoveIn} title={words.copyArchiveHint}>
            {words.copyArchive}
          </Button>
        )}
        {backend.objects > 0 && others.length > 0 && (
          <select
            aria-label={fill(words.moveObjectsFor, { label: backend.label })}
            className="bg-background h-8 rounded-md border px-2 text-sm"
            disabled={busy !== null || moving || !canWrite}
            value=""
            onChange={(event) => event.target.value && onMoveTo(event.target.value)}
          >
            <option value="">{words.moveObjects}</option>
            {others.map((other) => (
              <option key={other.id} value={other.id}>{other.label}</option>
            ))}
          </select>
        )}
        {backend.objects > 0 && !ownStorage && (
          <Button size="sm" variant="outline" disabled={busy !== null || moving || !canWrite} onClick={onMoveOut} title={words.bringBackHint}>
            {words.bringBack}
          </Button>
        )}
        {backend.objects + backend.pending === 0 && (
          <Button size="sm" variant="ghost" disabled={busy !== null} onClick={onRemove}>
            {words.remove}
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
          <Input className="w-56" placeholder={words.accessKeyId} aria-label={words.accessKeyId} value={key.accessKeyId} onChange={(e) => setKey({ ...key, accessKeyId: e.target.value })} />
          <Input className="w-72" type="password" autoComplete="off" placeholder={words.secretAccessKey} aria-label={words.secretAccessKey} value={key.secretAccessKey} onChange={(e) => setKey({ ...key, secretAccessKey: e.target.value })} />
          <Button size="sm" type="submit" disabled={!key.accessKeyId.trim() || !key.secretAccessKey}>{words.saveAndTest}</Button>
          <Button size="sm" type="button" variant="ghost" onClick={() => setRekeying(false)}>{words.cancel}</Button>
        </form>
      )}
    </article>
  );
}

function MoveLine({ move, from, to, onStop }: { move: MoveView; from: string; to: string; onStop: () => void }) {
  const words = useUiText().storage;
  const done = move.copied + move.already + move.missing;
  const active = move.state === "queued" || move.state === "running";
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span>
        {fill(words.moveLine, { from, to, state: words.moveState[move.state] })}
        {/* The total is counted when the move starts; objects kept since can take it past that. */}
        {move.total !== null && fill(words.moveProgress, { done: done.toLocaleString(), total: Math.max(done, move.total).toLocaleString() })}
        {move.missing > 0 && <span className="text-destructive">{fill(words.moveMissing, { n: move.missing.toLocaleString() })}</span>}
      </span>
      {move.lastError && <span className="text-destructive">{move.lastError}</span>}
      {active && (
        <Button size="sm" variant="ghost" onClick={onStop}>
          {words.stop}
        </Button>
      )}
    </div>
  );
}

/** The Cloudflare grant stays in an httpOnly cookie; this asks only which account, which name, and the key. */
function CloudflareSetup({
  lang,
  returned,
  onConnected,
  onBusy,
}: {
  lang: Lang;
  returned: CloudflareReturn;
  onConnected: (backend: BackendView, test: ProbeResult | null) => void;
  /** Told while a request runs, so the card around it holds still: a remount could send it twice. */
  onBusy: (busy: boolean) => void;
}) {
  const words = useUiText().storage;
  /** The grant waiting in the cookie: the accounts it reaches, and whether it may make the key. */
  const [grant, setGrant] = useState<{ accounts: CloudflareAccount[]; mintsKeys: boolean } | null>(null);
  const [accountId, setAccountId] = useState("");
  const [bucket, setBucket] = useState("");
  /** Set once the bucket exists and waits for the key the admin makes. */
  const [needsKey, setNeedsKey] = useState(false);
  const [key, setKey] = useState({ accessKeyId: "", secretAccessKey: "" });
  const [error, setError] = useState<string | null>(returned.error);
  const [working, setWorkingHere] = useState(false);
  const setWorking = (busy: boolean) => {
    setWorkingHere(busy);
    onBusy(busy);
  };
  const url = `/api/storage/cloudflare?lang=${lang}`;

  // The query said where the grant stands once; a reload must not say it again.
  useEffect(() => {
    if (!returned.connected && !returned.error) return;
    const here = new URL(window.location.href);
    here.searchParams.delete("cloudflare");
    here.searchParams.delete("cloudflare_error");
    window.history.replaceState(null, "", here);
  }, [returned]);

  // Asked on every load, not only on the way back from Cloudflare: a reload must not lose a grant
  // still waiting. No grant (409) is the usual state, worth a word only on the way back.
  useEffect(() => {
    void (async () => {
      const res = await fetch(url).catch(() => null);
      if (res?.status === 409 && !returned.connected) return;
      const answer = (await res?.json().catch(() => null)) as
        | { accounts?: CloudflareAccount[]; bucket?: string; mintsKeys?: boolean; error?: string }
        | null;
      if (!res?.ok || !answer?.accounts) return setError(answer?.error ?? words.accountsUnreadable);
      if (answer.accounts.length === 0) return setError(words.noAccount);
      setGrant({ accounts: answer.accounts, mintsKeys: answer.mintsKeys === true });
      setAccountId(answer.accounts[0].id);
      setBucket(answer.bucket ?? "");
    })();
  }, [returned.connected, url]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setWorking(true);
    setError(null);
    const body = { accountId, bucket: bucket.trim(), ...(needsKey ? { accessKeyId: key.accessKeyId.trim(), secretAccessKey: key.secretAccessKey.trim() } : {}) };
    const answer = await call(url, { method: "POST", body: JSON.stringify(body) }, words);
    setWorking(false);
    if (answer.error) return setError(answer.error);
    if (answer.needsKey) {
      if (answer.why) setError(fill(words.keyRefused, { why: answer.why }));
      return setNeedsKey(true);
    }
    reset();
    if (answer.backend) onConnected(answer.backend, answer.test ?? null);
  };

  const reset = () => {
    setGrant(null);
    setNeedsKey(false);
    setKey({ accessKeyId: "", secretAccessKey: "" });
  };

  const cancel = async () => {
    setWorking(true);
    setError(null);
    const answer = await call(url, { method: "DELETE" }, words);
    setWorking(false);
    // The form stays while the grant may still be waiting.
    if (answer.error) return setError(answer.error);
    reset();
  };

  if (!grant) {
    return (
      <div className="flex flex-col gap-3">
        <ul className="text-muted-foreground flex list-disc flex-col gap-1 pl-5">
          <li>{words.cloudflareMakesBucket}</li>
          <li>{words.cloudflareKeepsKey}</li>
          <li>{words.cloudflareOptionalTokens}</li>
        </ul>
        <div>
          <Button asChild size="sm">
            <a href={`/api/storage/cloudflare/start?lang=${lang}`}>{words.connectCloudflareButton}</a>
          </Button>
        </div>
        {error && <p className="text-destructive">{error}</p>}
      </div>
    );
  }

  const { accounts, mintsKeys } = grant;
  const ready = bucket.trim() && (!needsKey || (key.accessKeyId.trim() && key.secretAccessKey.trim()));
  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <fieldset disabled={working} className="contents">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="text-muted-foreground">{words.account}</span>
            <select className="bg-background h-9 rounded-md border px-2" value={accountId} disabled={needsKey} onChange={(e) => setAccountId(e.target.value)}>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>{account.name}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-muted-foreground">{words.bucket}</span>
            <Input aria-label={words.bucket} value={bucket} disabled={needsKey} onChange={(e) => setBucket(e.target.value)} />
          </label>
        </div>
        {needsKey ? (
          <>
            <p>{fill(words.bucketReady, { bucket })}</p>
            <ol className="text-muted-foreground flex list-decimal flex-col gap-1 pl-5">
              <li>
                {words.step1Before}
                <a className="text-primary-ink underline" href={`https://dash.cloudflare.com/${accountId}/r2/api-tokens`} target="_blank" rel="noreferrer">
                  R2 API tokens
                </a>
                {words.step1Middle}
                <span className="text-foreground">{words.step1Action}</span>
                {words.step1After}
              </li>
              <li>
                {words.step2Before}
                <span className="text-foreground">{words.step2Value}</span>
                {words.step2After}
              </li>
              <li>
                {words.step3Before}
                <span className="text-foreground">{words.step3Value}</span>
                {words.step3Middle}
                <span className="text-foreground font-mono">{bucket}</span>
                {words.step3After}
              </li>
              <li>
                {words.step4Before}
                <span className="text-foreground">{words.step4Value}</span>
                {words.step4After}
              </li>
              <li>
                {words.step5Before}
                <span className="text-foreground">{words.step5AccessKey}</span>
                {words.step5Middle}
                <span className="text-foreground">{words.step5Secret}</span>
                {words.step5After}
              </li>
            </ol>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input placeholder={words.accessKeyId} aria-label={words.accessKeyId} value={key.accessKeyId} onChange={(e) => setKey({ ...key, accessKeyId: e.target.value })} />
              <Input type="password" autoComplete="off" placeholder={words.secretAccessKey} aria-label={words.secretAccessKey} value={key.secretAccessKey} onChange={(e) => setKey({ ...key, secretAccessKey: e.target.value })} />
            </div>
          </>
        ) : (
          <p className="text-muted-foreground">
            {mintsKeys ? words.mintsKeysNote : words.handKeyNote}
          </p>
        )}
        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={!ready}>
            {working ? words.working : needsKey ? words.saveAndTest : mintsKeys ? words.createAndTest : words.createBucket}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => void cancel()}>{words.cancel}</Button>
        </div>
      </fieldset>
      {error && <p className="text-destructive">{error}</p>}
    </form>
  );
}

const EMPTY = { label: "", endpoint: "", region: "", bucket: "", publicUrl: "", accessKeyId: "", secretAccessKey: "" };

function NewBackend({
  providers,
  onSaved,
  lang,
  cloudflare,
  onConnected,
}: {
  providers: StorageView["providers"];
  onSaved: (backend: BackendView) => Promise<void>;
  lang: Lang;
  /** Where the Cloudflare grant stands, or null when this site cannot connect Cloudflare. */
  cloudflare: CloudflareReturn | null;
  onConnected: (backend: BackendView, test: ProbeResult | null) => void;
}) {
  const words = useUiText().storage;
  const [provider, setProvider] = useState<Provider>("r2");
  const [byHand, setByHand] = useState(false);
  /** A Cloudflare setup is running: switching provider or mode now would unmount it mid-request. */
  const [settingUp, setSettingUp] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const preset = providers.find((p) => p.id === provider)!;
  const viaCloudflare = provider === "r2" && cloudflare !== null && !byHand;
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
    }, words);
    setSaving(false);
    if (answer.error || !answer.backend) return setError(answer.error ?? words.notSaved);
    setForm(EMPTY);
    await onSaved(answer.backend);
  };

  return (
    <section className="bg-card flex flex-col gap-3 rounded-lg border p-4 text-sm">
      <h2 className="font-medium">{words.connect}</h2>
      <label className="flex flex-col gap-1">
        <span className="text-muted-foreground">{words.provider}</span>
        <select
          className="bg-background h-9 w-72 rounded-md border px-2"
          value={provider}
          disabled={saving || settingUp}
          onChange={(e) => setProvider(e.target.value as Provider)}
        >
          {providers.map((p) => (
            <option key={p.id} value={p.id}>{p.label}</option>
          ))}
        </select>
      </label>
      {provider === "r2" && cloudflare && (
        <div className="flex flex-wrap gap-2" role="group" aria-label={words.howToConnectR2}>
          <Button type="button" size="sm" variant={byHand ? "outline" : "secondary"} aria-pressed={!byHand} disabled={settingUp} onClick={() => setByHand(false)}>
            {words.connectCloudflare}
          </Button>
          <Button type="button" size="sm" variant={byHand ? "secondary" : "outline"} aria-pressed={byHand} disabled={settingUp} onClick={() => setByHand(true)}>
            {words.detailsByHand}
          </Button>
        </div>
      )}
      {viaCloudflare ? (
        <CloudflareSetup lang={lang} returned={cloudflare} onConnected={onConnected} onBusy={setSettingUp} />
      ) : (
        <form onSubmit={save} className="flex flex-col gap-3">
          {/* Held while saving: the form clears when the save returns, and would take edits with it. */}
          <fieldset disabled={saving} className="contents">
            <div className="grid gap-3 sm:grid-cols-2">
              <Input placeholder={fill(words.endpointPlaceholder, { endpoint: preset.endpoint })} aria-label={words.endpoint} {...field("endpoint")} />
              <Input placeholder={preset.region ? fill(words.regionPlaceholder, { region: preset.region }) : words.regionExample} aria-label={words.region} {...field("region")} />
              <Input placeholder={words.bucket} aria-label={words.bucket} {...field("bucket")} />
              <Input placeholder={words.publicUrlPlaceholder} aria-label={words.publicAddress} {...field("publicUrl")} />
              <Input placeholder={words.accessKeyId} aria-label={words.accessKeyId} {...field("accessKeyId")} />
              <Input type="password" autoComplete="off" placeholder={words.secretAccessKey} aria-label={words.secretAccessKey} {...field("secretAccessKey")} />
              <Input placeholder={words.nameOptional} aria-label={words.name} {...field("label")} />
            </div>
            <p className="text-muted-foreground">
              {words.keyNote}
            </p>
          </fieldset>
          {error && <p className="text-destructive">{error}</p>}
          <div>
            <Button type="submit" size="sm" disabled={saving}>{saving ? words.saving : words.saveAndTest}</Button>
          </div>
        </form>
      )}
    </section>
  );
}
