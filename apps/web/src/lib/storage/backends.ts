/**
 * A team's own buckets (docs/platform/STORAGE.md). Nothing here checks the viewer; the route has.
 * Every read and write acts as the team and names it too (TEAM_ROWS): row-level security does not
 * bind a superuser, which is what a developer's checkout connects as.
 */
import "server-only";

import { randomUUID } from "node:crypto";

import { query, TEAM_ROWS, withTeam, type TeamId } from "@/lib/db";
import { seal } from "@/lib/blobs/seal";
import { readsBlobs } from "@/lib/blobs/store";
import { BACKEND_COLUMNS, forgetBackends, storeOfRow, type BackendRow } from "@/lib/blobs/where";

import { assertPublicHost, PrivateHostError } from "./host";
import { probe, type ProbeResult } from "./probe";

export const PROVIDERS = {
  r2: { label: "Cloudflare R2", endpoint: "https://<account id>.r2.cloudflarestorage.com", region: "auto", pathStyle: true },
  s3: { label: "Amazon S3", endpoint: "https://s3.<region>.amazonaws.com", region: "", pathStyle: false },
  b2: { label: "Backblaze B2", endpoint: "https://s3.<region>.backblazeb2.com", region: "", pathStyle: true },
  wasabi: { label: "Wasabi", endpoint: "https://s3.<region>.wasabisys.com", region: "", pathStyle: true },
  gcs: { label: "Google Cloud Storage (HMAC keys)", endpoint: "https://storage.googleapis.com", region: "auto", pathStyle: true },
  minio: { label: "MinIO", endpoint: "https://", region: "auto", pathStyle: true },
  other: { label: "Other S3-compatible", endpoint: "https://", region: "auto", pathStyle: true },
} as const;

export type Provider = keyof typeof PROVIDERS;

export const isProvider = (value: unknown): value is Provider => typeof value === "string" && value in PROVIDERS;

export type BackendView = {
  id: string;
  label: string;
  provider: Provider;
  endpoint: string;
  region: string;
  bucket: string;
  pathStyle: boolean;
  publicUrl: string | null;
  accessKeyId: string;
  conditionalPut: boolean;
  writing: boolean;
  health: "unchecked" | "ok" | "failing";
  checkedAt: string | null;
  lastError: string | null;
  createdAt: string;
  retiredAt: string | null;
  objects: number;
  pending: number;
  missing: number;
};

/** A refusal fit to show, with the status the route answers. */
export class StorageError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 = 400,
  ) {
    super(message);
    this.name = "StorageError";
  }
}

export type BackendInput = {
  label: string;
  provider: Provider;
  endpoint: string;
  region: string;
  bucket: string;
  pathStyle: boolean;
  publicUrl: string | null;
  accessKeyId: string;
  secretAccessKey: string;
};

const text = (value: unknown, name: string, max = 200): string => {
  if (typeof value !== "string" || !value.trim()) throw new StorageError(`${name} is required.`);
  if (value.length > max) throw new StorageError(`${name} is too long.`);
  return value.trim();
};

/** Just scheme and host: what the bucket's own address is built from. */
function endpointOf(value: unknown): string {
  const raw = text(value, "The endpoint");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new StorageError("The endpoint is not an address.");
  }
  if (url.protocol !== "https:") throw new StorageError("The endpoint must be https.");
  if (url.pathname !== "/" || url.search || url.hash || url.username) {
    throw new StorageError("The endpoint is a scheme and host only, without the bucket or a path.");
  }
  if (url.hostname.includes("<")) throw new StorageError("Fill in the endpoint's placeholder.");
  return `https://${url.host}`;
}

function publicUrlOf(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  const raw = text(value, "The public address", 300);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new StorageError("The public address is not an address.");
  }
  if (url.protocol !== "https:") throw new StorageError("The public address must be https.");
  if (url.search || url.hash) throw new StorageError("The public address has no query or fragment.");
  return url.toString().endsWith("/") ? url.toString() : `${url.toString()}/`;
}

/** Checks and normalises what a team admin sent. Throws a StorageError naming the first problem. */
export function backendInput(body: Record<string, unknown>): BackendInput {
  if (!isProvider(body.provider)) throw new StorageError(`The provider is one of ${Object.keys(PROVIDERS).join(", ")}.`);
  const preset = PROVIDERS[body.provider];
  const bucket = text(body.bucket, "The bucket", 63);
  if (!/^[a-z0-9][a-z0-9.\-_]{1,62}$/.test(bucket)) throw new StorageError("The bucket's name is lowercase letters, digits, dots, dashes and underscores.");
  const region = typeof body.region === "string" && body.region.trim() ? body.region.trim() : preset.region || "auto";
  if (!/^[a-z0-9-]{1,40}$/.test(region)) throw new StorageError("The region is lowercase letters, digits and dashes, or auto.");
  return {
    label: typeof body.label === "string" && body.label.trim() ? text(body.label, "The name", 80) : bucket,
    provider: body.provider,
    endpoint: endpointOf(body.endpoint),
    region,
    bucket,
    // A dotted name as a host would not match the provider's wildcard certificate.
    pathStyle: bucket.includes(".") || (typeof body.pathStyle === "boolean" ? body.pathStyle : preset.pathStyle),
    publicUrl: publicUrlOf(body.publicUrl),
    accessKeyId: text(body.accessKeyId, "The access key id"),
    secretAccessKey: text(body.secretAccessKey, "The secret access key", 500),
  };
}

async function reachable(...urls: (string | null)[]): Promise<void> {
  try {
    for (const url of urls) if (url) await assertPublicHost(url);
  } catch (error) {
    if (error instanceof PrivateHostError) throw new StorageError(error.message);
    throw new StorageError(`${error instanceof Error ? error.message : error}: the address does not resolve.`);
  }
}

const VIEW = `
  select b."id", b."label", b."provider", b."endpoint", b."region", b."bucket", b."pathStyle", b."publicUrl",
         b."accessKeyId", b."conditionalPut", b."writing", b."health", b."checkedAt", b."lastError",
         b."createdAt", b."retiredAt",
         c."objects", c."pending", c."missing"
    from "storage_backend" b
   cross join lateral (
     select count(*) filter (where not o."pending")::int as "objects",
            count(*) filter (where o."pending")::int as "pending",
            count(*) filter (where o."missingAt" is not null)::int as "missing"
       from "archive_object" o where o."backendId" = b."id") c
   where ${TEAM_ROWS}`;

type ViewRow = Omit<BackendView, "checkedAt" | "createdAt" | "retiredAt"> & {
  checkedAt: Date | null;
  createdAt: Date;
  retiredAt: Date | null;
};

const toView = (row: ViewRow): BackendView => ({
  ...row,
  checkedAt: row.checkedAt?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
  retiredAt: row.retiredAt?.toISOString() ?? null,
});

export async function listBackends(team: TeamId): Promise<BackendView[]> {
  return withTeam(team, async (client) => {
    const { rows } = await client.query<ViewRow>(`${VIEW} order by b."retiredAt" is not null, b."createdAt"`);
    return rows.map(toView);
  });
}

export async function backendView(team: TeamId, id: string): Promise<BackendView> {
  const view = await withTeam(team, async (client) => (await client.query<ViewRow>(`${VIEW} and b."id" = $1`, [id])).rows[0]);
  if (!view) throw new StorageError("No such bucket in this team.", 404);
  return toView(view);
}

type Row = BackendRow & { retiredAt: Date | null; health: BackendView["health"] };

async function rowOf(team: TeamId, id: string): Promise<Row> {
  const [row] = await withTeam(team, async (client) =>
    (await client.query<Row>(
      `select ${BACKEND_COLUMNS}, "retiredAt", "health" from "storage_backend" where "id" = $1 and ${TEAM_ROWS}`,
      [id],
    )).rows,
  );
  if (!row) throw new StorageError("No such bucket in this team.", 404);
  return row;
}

/** Saved unchecked: nothing goes to it until a test passes and an admin switches it on. */
export async function createBackend(team: TeamId, input: BackendInput, userId: string): Promise<BackendView> {
  await reachable(input.endpoint, input.publicUrl);
  const id = randomUUID();
  await withTeam(team, (client) =>
    client.query(
      `insert into "storage_backend"
         ("id", "label", "provider", "endpoint", "region", "bucket", "pathStyle", "publicUrl",
          "accessKeyId", "secretSealed", "createdBy")
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [id, input.label, input.provider, input.endpoint, input.region, input.bucket, input.pathStyle, input.publicUrl,
        input.accessKeyId, seal(input.secretAccessKey, id), userId],
    ),
  );
  return backendView(team, id);
}

export type BackendChange = {
  label?: string;
  publicUrl?: string | null;
  accessKeyId?: string;
  secretAccessKey?: string;
};

export function backendChange(body: Record<string, unknown>): BackendChange {
  const change: BackendChange = {};
  if ("label" in body) change.label = text(body.label, "The name", 80);
  if ("publicUrl" in body) change.publicUrl = publicUrlOf(body.publicUrl);
  if ("accessKeyId" in body || "secretAccessKey" in body) {
    change.accessKeyId = text(body.accessKeyId, "The access key id");
    change.secretAccessKey = text(body.secretAccessKey, "The secret access key", 500);
  }
  return change;
}

/**
 * A new key or address is tested at once, since objects may be going to the bucket: a failing
 * test marks it failing.
 */
export async function changeBackend(team: TeamId, id: string, change: BackendChange): Promise<ProbeResult | null> {
  await rowOf(team, id);
  if (change.publicUrl) await reachable(change.publicUrl);
  await withTeam(team, (client) =>
    client.query(
      `update "storage_backend" set
         "label" = coalesce($2, "label"),
         "publicUrl" = case when $3 then $4 else "publicUrl" end,
         "accessKeyId" = coalesce($5, "accessKeyId"),
         "secretSealed" = coalesce($6, "secretSealed")
       where "id" = $1 and ${TEAM_ROWS}`,
      [id, change.label ?? null, "publicUrl" in change, change.publicUrl ?? null, change.accessKeyId ?? null,
        change.secretAccessKey ? seal(change.secretAccessKey, id) : null],
    ),
  );
  forgetBackends();
  const tested = change.accessKeyId !== undefined || "publicUrl" in change;
  return tested ? testBackend(team, id) : null;
}

/** Runs the probe and records what it found. A retired bucket is tested too: it still serves what it holds. */
export async function testBackend(team: TeamId, id: string): Promise<ProbeResult> {
  const row = await rowOf(team, id);
  let result: ProbeResult;
  try {
    await reachable(row.endpoint, row.publicUrl);
    result = await probe(storeOfRow(row));
  } catch (error) {
    result = { ok: false, conditionalPut: row.conditionalPut, steps: [{ name: "Reach the bucket", ok: false, detail: error instanceof Error ? error.message : String(error) }] };
  }
  const failed = result.steps.find((step) => !step.ok);
  await withTeam(team, (client) =>
    client.query(
      `update "storage_backend"
          set "health" = $2, "checkedAt" = now(), "lastError" = $3, "conditionalPut" = $4
        where "id" = $1 and ${TEAM_ROWS}`,
      [id, result.ok ? "ok" : "failing", failed ? `${failed.name}: ${failed.detail ?? "failed"}` : null, result.conditionalPut],
    ),
  );
  forgetBackends();
  return result;
}

/**
 * Sends the team's new objects to `id`, or to our bucket with null. A bucket must have passed its
 * test, and our own archive must already be a bucket: in `disk` or `dual` mode the volume is the
 * record, and nothing could be read back from a team's bucket.
 */
export async function setWriting(team: TeamId, id: string | null): Promise<void> {
  if (id !== null) {
    if (!readsBlobs()) throw new StorageError("The site's archive is not a bucket yet (SPOKEN_ARCHIVE_STORE=r2), so a team's bucket cannot be switched on.", 409);
    const row = await rowOf(team, id);
    if (row.retiredAt) throw new StorageError("A retired bucket takes no new objects.", 409);
    if (row.health !== "ok") throw new StorageError("Test the bucket first: only one that passed takes new objects.", 409);
  }
  await withTeam(team, async (client) => {
    await client.query(`update "storage_backend" set "writing" = false where "writing" and "id" is distinct from $1 and ${TEAM_ROWS}`, [id]);
    if (id !== null) await client.query(`update "storage_backend" set "writing" = true where "id" = $1 and ${TEAM_ROWS}`, [id]);
  });
  forgetBackends();
}

/** No new objects, for good. It keeps serving what it holds until they are moved away. */
export async function retireBackend(team: TeamId, id: string): Promise<void> {
  await rowOf(team, id);
  await withTeam(team, (client) =>
    client.query(`update "storage_backend" set "writing" = false, "retiredAt" = coalesce("retiredAt", now()) where "id" = $1 and ${TEAM_ROWS}`, [id]),
  );
  forgetBackends();
}

/** Only a bucket that holds nothing the archive knows of: the rest are retired instead. */
export async function removeBackend(team: TeamId, id: string): Promise<void> {
  await rowOf(team, id);
  const [{ n }] = await query<{ n: number }>(`select count(*)::int as "n" from "archive_object" where "backendId" = $1`, [id]);
  if (n > 0) throw new StorageError(`The bucket holds ${n} of the archive's objects. Retire it, or move them away first.`, 409);
  try {
    await withTeam(team, (client) => client.query(`delete from "storage_backend" where "id" = $1 and ${TEAM_ROWS}`, [id]));
  } catch (error) {
    if ((error as { code?: string }).code === "23503") throw new StorageError("The bucket holds objects of the archive now.", 409);
    throw error;
  }
  forgetBackends();
}

/** The team's bucket new objects go to, null for ours. */
export async function writingBackend(team: TeamId): Promise<{ id: string; health: BackendView["health"] } | null> {
  const [row] = await withTeam(team, async (client) =>
    (await client.query<{ id: string; health: BackendView["health"] }>(
      `select "id", "health" from "storage_backend" where "writing" and ${TEAM_ROWS}`,
    )).rows,
  );
  return row ?? null;
}
