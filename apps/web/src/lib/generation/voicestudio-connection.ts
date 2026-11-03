/**
 * A collaborator's own VoiceStudio service: where it is, the key it wants, which model to ask
 * for and how many lines it can take at once.
 *
 * Stored sealed in "voicestudio_key" like the other providers' keys, as this JSON, so the rest
 * of the credential path -- readApiKey, requireApiKey, the worker's lanes -- carries one opaque
 * string for every provider. Only speakerFrom and the worker's budget look inside it.
 *
 * The collaborator runs the service and puts it behind https themselves. The server fetches
 * the URL they give it, so a host that names this machine or its private network is refused:
 * that would be asking the server to call itself on somebody's behalf.
 *
 * Free of server imports: the profile form validates with the same rules before it posts.
 */
export type VoiceStudioConnection = {
  /** The service root, https, without a trailing slash or /v1. */
  baseUrl: string;
  /** Sent as a bearer token when set. */
  apiKey: string;
  model: string;
  maxConcurrency: number;
};

export const VOICESTUDIO_DEFAULT_MODEL = "omnivoice";
export const VOICESTUDIO_DEFAULT_CONCURRENCY = 1;
export const VOICESTUDIO_MAX_CONCURRENCY = 8;

const MODEL = /^[A-Za-z0-9._:/-]{1,100}$/;

type Parsed = { connection: VoiceStudioConnection; error: null } | { connection: null; error: string };

function invalid(error: string): Parsed {
  return { connection: null, error };
}

/** An IPv4 literal in a range that is this machine or a private network. */
function privateV4(host: string): boolean {
  const parts = host.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

/** An IPv6 literal (URL.hostname keeps its brackets) for loopback, link-local or private. */
function privateV6(host: string): boolean {
  if (!host.startsWith("[")) return false;
  const address = host.slice(1, -1).toLowerCase();
  if (address === "::" || address === "::1") return true;
  if (/^f[cd]/.test(address) || /^fe[89ab]/.test(address)) return true;
  // An IPv4 address written as IPv6, which the URL parser normalises to hex.
  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(address);
  if (mapped) {
    const high = parseInt(mapped[1], 16);
    const low = parseInt(mapped[2], 16);
    return privateV4(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
  }
  return false;
}

export function serviceUrl(raw: string): { url: string; error: null } | { url: null; error: string } {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { url: null, error: "the service URL is not a URL" };
  }
  if (url.protocol !== "https:") return { url: null, error: "the service URL must be https" };
  if (url.username || url.password) {
    return { url: null, error: "put the key in its own field, not in the URL" };
  }
  if (url.search || url.hash) return { url: null, error: "the service URL takes no query or fragment" };
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || privateV4(host) || privateV6(host)) {
    return { url: null, error: "the service URL must name a public host, not this server or a private address" };
  }
  // The documented value is the service root. Forgiving of an OpenAI client base URL ending in
  // /v1, so requests do not become /v1/v1/…
  const path = url.pathname.replace(/\/+$/, "").replace(/\/v1$/, "");
  return { url: `${url.origin}${path}`, error: null };
}

/** A connection from what the profile form sent, or why it cannot be one. */
export function parseConnection(input: {
  baseUrl?: unknown;
  apiKey?: unknown;
  model?: unknown;
  maxConcurrency?: unknown;
}): Parsed {
  if (typeof input.baseUrl !== "string" || input.baseUrl.trim() === "") {
    return invalid("a service URL is required");
  }
  const { url, error } = serviceUrl(input.baseUrl);
  if (error !== null) return invalid(error);

  const apiKey = typeof input.apiKey === "string" ? input.apiKey.trim() : "";

  const model =
    typeof input.model === "string" && input.model.trim() !== ""
      ? input.model.trim()
      : VOICESTUDIO_DEFAULT_MODEL;
  if (!MODEL.test(model)) return invalid("the model name has characters a model name cannot");

  const concurrency =
    input.maxConcurrency === undefined || input.maxConcurrency === null || input.maxConcurrency === ""
      ? VOICESTUDIO_DEFAULT_CONCURRENCY
      : Number(input.maxConcurrency);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > VOICESTUDIO_MAX_CONCURRENCY) {
    return invalid(`concurrency must be a whole number from 1 to ${VOICESTUDIO_MAX_CONCURRENCY}`);
  }

  return { connection: { baseUrl: url, apiKey, model, maxConcurrency: concurrency }, error: null };
}

export function encodeConnection(connection: VoiceStudioConnection): string {
  return JSON.stringify(connection);
}

/**
 * The stored connection, checked again: a row saved under older rules must not reach fetch.
 * Throws, like a row that will not open, so the caller reports it rather than reading "none".
 */
export function decodeConnection(stored: string): VoiceStudioConnection {
  let raw: unknown;
  try {
    raw = JSON.parse(stored);
  } catch {
    throw new Error("the stored VoiceStudio connection is not readable; set it again in your profile");
  }
  const { connection, error } = parseConnection((raw ?? {}) as Record<string, unknown>);
  if (error !== null) throw new Error(`the stored VoiceStudio connection is invalid: ${error}`);
  return connection;
}

/** What the profile shows of a stored connection: the host, which is not a secret. */
export function connectionHint(connection: VoiceStudioConnection): string {
  return new URL(connection.baseUrl).host;
}
