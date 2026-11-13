// Community pack rules, browser-safe: the submit form and the API route run the same checks.
// They mirror manager/src/main/community.ts validatePack, because the Manager drops any registry
// entry that fails its own copy. Keep this in step with that file, not the other way round.

import { objectOf } from "@/lib/api-body";

export const SECTIONS = ["quests", "places", "readables"] as const;
export type Section = (typeof SECTIONS)[number];

export type PackFields = {
  title: string;
  author: string;
  description: string;
  version: string;
  size: number;
  sha256: string;
  url: string;
  homepage: string | null;
  license: string | null;
};
export type NewPack = PackFields & { id: string; lang: string; section: Section };

type Errors = Record<string, string>;
type Result<T> = { ok: true; value: T } | { ok: false; errors: Errors };

const MAX_ZIP = 8 * 1024 ** 3;
const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const LANGUAGE_CODE = /^[a-z]{2}[A-Z]{2}$/;
const CONTROL = /[\u0000-\u001f\u007f]/;

function text(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s.length > 0 && s.length <= max && !CONTROL.test(s) ? s : null;
}

/**
 * `https://github.com/<owner>/<repo>/releases/download/<tag>/<file>` or an objects.githubusercontent.com link.
 * Copy of isAllowedPackUrl in manager/src/main/community.ts; keep the two in step.
 */
export function isAllowedPackUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 500) return false;
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" || u.username !== "" || u.password !== "" || (u.port !== "" && u.port !== "443"))
    return false;
  if (u.search !== "" || u.hash !== "") return false;
  if (u.hostname === "objects.githubusercontent.com") return u.pathname.length > 1;
  return (
    u.hostname === "github.com" &&
    /^\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+\/releases\/download\/[^/]+\/[^/]+$/.test(u.pathname)
  );
}

function isHttps(value: string): boolean {
  if (value.length > 300) return false;
  try {
    const u = new URL(value);
    return u.protocol === "https:" && u.username === "" && u.password === "" && !CONTROL.test(value);
  } catch {
    return false;
  }
}

// Copy of manager/src/shared/version.ts; keep the two in step, since the Manager decides what counts as an update.
interface Parsed {
  core: number[];
  pre: (string | number)[];
}

function parse(v: string): Parsed | null {
  const m = /^v?(\d+(?:\.\d+)*)(?:-([0-9A-Za-z.-]+))?(?:\+.*)?$/.exec(v.trim());
  if (!m) return null;
  const pre = m[2] ? m[2].split(".").map((p) => (/^\d+$/.test(p) ? Number(p) : p)) : [];
  return { core: m[1]!.split(".").map(Number), pre };
}

/** Negative when a < b, zero when equal, positive when a > b; null when either is not a version. */
export function compareVersions(a: string, b: string): number | null {
  const x = parse(a);
  const y = parse(b);
  if (!x || !y) return null;
  const n = Math.max(x.core.length, y.core.length);
  for (let i = 0; i < n; i++) {
    const d = (x.core[i] ?? 0) - (y.core[i] ?? 0);
    if (d !== 0) return d;
  }
  if (x.pre.length === 0 && y.pre.length === 0) return 0;
  if (x.pre.length === 0) return 1;
  if (y.pre.length === 0) return -1;
  const m = Math.max(x.pre.length, y.pre.length);
  for (let i = 0; i < m; i++) {
    const p = x.pre[i];
    const q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    if (p === q) continue;
    if (typeof p === "number" && typeof q === "number") return p - q;
    if (typeof p === "number") return -1;
    if (typeof q === "number") return 1;
    return p < q ? -1 : 1;
  }
  return 0;
}

function fields(r: Record<string, unknown>, errors: Errors): Partial<PackFields> {
  const out: Partial<PackFields> = {};

  const title = text(r.title, 80);
  if (title) out.title = title;
  else errors.title = "Give the pack a title of 1 to 80 characters.";

  const author = text(r.author, 80);
  if (author) out.author = author;
  else errors.author = "Give an author name of 1 to 80 characters.";

  const description = text(r.description, 400);
  if (description) out.description = description;
  else errors.description = "Describe the pack in 1 to 400 characters.";

  const version = typeof r.version === "string" ? r.version.trim() : "";
  // compareVersions reads build metadata as anything, and a NUL there fails the insert as a 500.
  if (
    version.length > 0 &&
    version.length <= 40 &&
    !/\s/.test(version) &&
    !CONTROL.test(version) &&
    compareVersions(version, version) !== null
  )
    out.version = version;
  else errors.version = "Use a version like 1.2.0, without spaces and at most 40 characters.";

  // The form sends the size as text.
  const size = typeof r.size === "string" && /^\d+$/.test(r.size.trim()) ? Number(r.size.trim()) : r.size;
  if (typeof size === "number" && Number.isSafeInteger(size) && size > 0 && size <= MAX_ZIP) out.size = size;
  else errors.size = "The size is the zip's size in bytes, above 0 and at most 8 GiB.";

  const sha256 = typeof r.sha256 === "string" ? r.sha256.trim() : "";
  if (/^[0-9a-fA-F]{64}$/.test(sha256)) out.sha256 = sha256.toLowerCase();
  else errors.sha256 = "The checksum is 64 hexadecimal characters.";

  const url = typeof r.url === "string" ? r.url.trim() : "";
  if (isAllowedPackUrl(url)) out.url = url;
  else errors.url = "The link must be a GitHub release asset: https://github.com/owner/repo/releases/download/tag/file.zip.";

  const homepage = typeof r.homepage === "string" ? r.homepage.trim() : r.homepage;
  if (homepage === undefined || homepage === null || homepage === "") out.homepage = null;
  else if (typeof homepage === "string" && isHttps(homepage)) out.homepage = homepage;
  else errors.homepage = "The homepage must be an https link of at most 300 characters.";

  const license = typeof r.license === "string" ? r.license.trim() : r.license;
  const licenseText = text(license, 60);
  if (license === undefined || license === null || license === "") out.license = null;
  else if (licenseText) out.license = licenseText;
  else errors.license = "The license must be at most 60 characters.";

  return out;
}

const NOT_AN_OBJECT: Result<never> = { ok: false, errors: { form: "The submission is not in the expected shape." } };

/** The fields an author may change on an existing pack. */
export function validateFields(input: unknown): Result<PackFields> {
  const r = objectOf(input);
  if (!r) return NOT_AN_OBJECT;
  const errors: Errors = {};
  const value = fields(r, errors);
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, value: value as PackFields };
}

/** A first submission: the fields plus the identity that never changes afterwards. */
export function validateNewPack(input: unknown): Result<NewPack> {
  const r = objectOf(input);
  if (!r) return NOT_AN_OBJECT;
  const errors: Errors = {};

  const id = typeof r.id === "string" ? r.id.trim() : "";
  if (id.length === 0 || id.length > 48 || !ID.test(id))
    errors.id = "Use lower-case letters, digits and single hyphens, at most 48 characters.";

  const lang = typeof r.lang === "string" ? r.lang.trim() : "";
  if (!LANGUAGE_CODE.test(lang)) errors.lang = "Use a language code like deDE: two lower-case, two upper-case letters.";

  const section = typeof r.section === "string" ? r.section.trim() : "";
  if (!(SECTIONS as readonly string[]).includes(section)) errors.section = "Choose quests, places or readables.";

  const checked = validateFields(r);
  if (!checked.ok) return { ok: false, errors: { ...errors, ...checked.errors } };
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { ...checked.value, id, lang, section: section as Section } };
}
