// The bucket, through R2's S3 API, and an in-memory stand-in with the same five calls for tests.
import { fetchRetrying } from "../lib/download.mjs";

export class ConflictError extends Error {}

const XML_ENTITIES = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'" };
const decodeXml = (s) => s.replace(/&(amp|lt|gt|quot|apos);/g, (m) => XML_ENTITIES[m]);

// R2 answers with a weak ETag (W/"…") for JSON it compresses on the way out, and If-Match
// compares strongly, so the weak form never matches: every conditional write would 412.
export const strongEtag = (etag) => etag?.replace(/^W\//, "") ?? null;

export function r2Store(env, { wait } = {}) {
  const need = ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"];
  const missing = need.filter((k) => !env[k]);
  if (missing.length > 0) throw new Error(`missing ${missing.join(", ")}`);
  // Loaded on first use: the manager's tests import memoryStore from here without this package installed.
  let client;
  // A press sends thousands of requests, and aws4fetch retries only on a status, so one dropped
  // connection would end it. Retrying a conditional write is safe: at worst it reports a conflict.
  const signed = async (address, init) => {
    if (!client) {
      const { AwsClient } = await import("aws4fetch");
      client = new AwsClient({
        accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY, service: "s3", region: "auto",
      });
    }
    return fetchRetrying(address, (target) => client.fetch(target, init), wait);
  };
  const bucket = `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${env.R2_BUCKET}`;
  const url = (key) => `${bucket}/${key.split("/").map(encodeURIComponent).join("/")}`;
  const fail = async (what, key, res) => {
    throw new Error(`${what} ${key}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  };

  return {
    async head(key) {
      const res = await signed(url(key), { method: "HEAD" });
      if (res.status === 404) return null;
      if (!res.ok) await fail("HEAD", key, res);
      return { etag: strongEtag(res.headers.get("etag")) };
    },
    async get(key) {
      const res = await signed(url(key));
      if (res.status === 404) return null;
      if (!res.ok) await fail("GET", key, res);
      return { body: Buffer.from(await res.arrayBuffer()), etag: strongEtag(res.headers.get("etag")) };
    },
    async put(key, body, opts = {}) {
      const headers = {};
      if (opts.contentType) headers["content-type"] = opts.contentType;
      if (opts.cacheControl) headers["cache-control"] = opts.cacheControl;
      if (opts.ifMatch) headers["if-match"] = opts.ifMatch;
      if (opts.ifNoneMatch) headers["if-none-match"] = opts.ifNoneMatch;
      const res = await signed(url(key), { method: "PUT", body, headers });
      if (res.status === 412) throw new ConflictError(key);
      if (!res.ok) await fail("PUT", key, res);
    },
    async list(prefix) {
      const out = [];
      let token;
      do {
        const q = new URLSearchParams({ "list-type": "2", prefix });
        if (token) q.set("continuation-token", token);
        const res = await signed(`${bucket}?${q}`);
        if (!res.ok) await fail("LIST", prefix, res);
        const xml = await res.text();
        for (const [, item] of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
          out.push({
            key: decodeXml(/<Key>([\s\S]*?)<\/Key>/.exec(item)[1]),
            lastModified: new Date(/<LastModified>(.*?)<\/LastModified>/.exec(item)[1]),
          });
        }
        token = /<IsTruncated>true<\/IsTruncated>/.test(xml)
          ? decodeXml(/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/.exec(xml)[1])
          : undefined;
      } while (token);
      return out;
    },
    async delete(key) {
      const res = await signed(url(key), { method: "DELETE" });
      if (!res.ok && res.status !== 404) await fail("DELETE", key, res);
    },
  };
}

export function memoryStore() {
  const objects = new Map();
  const log = [];
  let tag = 0;
  return {
    objects,
    log,
    async head(key) {
      log.push(["head", key]);
      const o = objects.get(key);
      return o ? { etag: o.etag } : null;
    },
    async get(key) {
      log.push(["get", key]);
      const o = objects.get(key);
      return o ? { body: o.body, etag: o.etag } : null;
    },
    async put(key, body, opts = {}) {
      log.push(["put", key]);
      const o = objects.get(key);
      if (opts.ifMatch !== undefined && o?.etag !== opts.ifMatch) throw new ConflictError(key);
      if (opts.ifNoneMatch === "*" && o) throw new ConflictError(key);
      objects.set(key, {
        body: Buffer.from(body), etag: `"${++tag}"`, lastModified: new Date(),
        cacheControl: opts.cacheControl, contentType: opts.contentType,
      });
    },
    async list(prefix) {
      return [...objects].filter(([k]) => k.startsWith(prefix)).map(([key, o]) => ({ key, lastModified: o.lastModified }));
    },
    async delete(key) {
      log.push(["delete", key]);
      objects.delete(key);
    },
  };
}
