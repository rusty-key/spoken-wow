/**
 * The role model, shared by the server and the browser so the list of roles is defined once.
 *
 * Two global roles: a `member` is anyone who registered, and an `admin` may do anything,
 * including manage users and voices and approve community voice packs, which any member may
 * submit. Everything in between -- writing a language, cutting
 * takes in it, looking after it -- is a grant for that language (see "Per language" below),
 * English included. Registration assigns `member`; the first `admin` is promoted with SQL
 * (see deploy/README.md), and every grant and promotion after that goes through /admin.
 */
import { createAccessControl } from "better-auth/plugins/access";
import { adminAc, defaultStatements } from "better-auth/plugins/admin/access";

import { CODES, type Lang } from "@/lib/lang";

const statement = {
  ...defaultStatements,
  // `configure` is separate from `regenerate` because the settings are global: changing
  // stability changes every line anyone generates afterwards, whereas a regeneration is one
  // file and is reversible from its history.
  voiceline: ["regenerate", "configure"],
  // Separate from `voiceline` because creating a voice is the heavier act: slots are capped
  // by the ElevenLabs plan (30 on Creator) and a clone spends an account resource that a
  // re-rolled line does not.
  voice: ["manage"],
} as const;

export const ac = createAccessControl(statement);

export const roles = {
  member: ac.newRole({}),
  // Spreading adminAc keeps the admin plugin's own permissions (user: set-role, list, ...).
  // Declaring a custom `admin` role replaces the built-in one, so without this the admin
  // loses access to the very page that hands out roles.
  admin: ac.newRole({
    ...adminAc.statements,
    voiceline: ["regenerate", "configure"],
    voice: ["manage"],
  }),
};

export const ROLES = ["member", "admin"] as const;

export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  member: "Member",
  admin: "Admin",
};

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

/** What the UI calls a role. A role this build does not know shows as stored, not as nothing. */
export function roleLabel(role: string | null | undefined): string {
  const value = role ?? "member";
  return isRole(value) ? ROLE_LABELS[value] : value;
}

/** The one definition of who may reach /admin. */
export function isAdmin(role: string | null | undefined): boolean {
  return role === "admin";
}

/** The one definition of who may change the global generation settings. */
export function canConfigureGeneration(role: string | null | undefined): boolean {
  return role === "admin";
}

//------------------------------------------------------------------------------
// Per language
//------------------------------------------------------------------------------

/**
 * What a grant lets somebody do in one language. See migration 0037 for each.
 *
 * `text` is a text maintainer: the language's original text and its contributions, whichever
 * team voices it. The rest are capabilities inside a team, and `edit` among them is the team's
 * audio reports and missing audio. What a team speaks in place of the original is an override,
 * which `regenerate` writes.
 *
 * `admin` in a language is every team capability there and hands them out, `admin` included.
 * It is not `text`: only a global admin appoints a text maintainer, because the original text is
 * what every team in the language voices.
 */
export const CAPABILITIES = ["text", "edit", "regenerate", "configure", "ignore", "admin", "record"] as const;

export type Capability = (typeof CAPABILITIES)[number];

/**
 * What /admin calls each capability: its own name, except where that would not say who holds
 * it. Total, so a capability added above without a label is a type error.
 */
const CAPABILITY_LABELS: Record<Capability, string> = {
  text: "text maintainer",
  edit: "edit",
  regenerate: "regenerate",
  configure: "configure",
  ignore: "ignore",
  admin: "admin",
  record: "voice actor",
};

export function capabilityLabel(capability: Capability): string {
  return CAPABILITY_LABELS[capability];
}

/**
 * What /admin says each capability lets its holder do, so an admin handing one out does not
 * have to know the code. Total, so a capability added without its words is a type error.
 */
const CAPABILITY_HINTS: Record<Capability, string> = {
  text: "Looks after the language's original text and the contributions to it, whichever team voices it.",
  edit: "Works through the team's audio reports and missing audio.",
  regenerate: "Cuts new takes, paid from their own ElevenLabs or fish.audio key.",
  configure: "Changes the language's generation settings and lexicon.",
  ignore: "Marks a line as never voiced in this language.",
  admin: "Everything the team may do here, and hands out access in this language.",
  record: "Records takes in their own voice.",
};

export function capabilityHint(capability: Capability): string {
  return CAPABILITY_HINTS[capability];
}

export function isCapability(value: unknown): value is Capability {
  return typeof value === "string" && (CAPABILITIES as readonly string[]).includes(value);
}

export type Grant = { lang: string; capability: Capability };

/** Who is asking: their global role, and whatever they hold in particular languages. */
export type Viewer = { role: string | null | undefined; grants: readonly Grant[] };

/**
 * The one definition of whether somebody may do something in a language.
 *
 * A global admin may do anything anywhere. Everybody else holds what their grants for that
 * language say, `admin` there standing for all of them but `text` -- English no differently
 * from the rest, since 0045 turned the old collaborator role into English grants.
 */
export function can(viewer: Viewer | null, capability: Capability, lang: Lang): boolean {
  if (!viewer) return false;
  if (viewer.role === "admin") return true;
  return viewer.grants.some(
    (grant) =>
      grant.lang === lang &&
      (grant.capability === capability || (grant.capability === "admin" && capability !== "text")),
  );
}

/**
 * Every language in which somebody may do something: all of them for a global admin, none
 * for somebody signed out.
 */
export function langsWhere(viewer: Viewer | null, capability: Capability): Lang[] {
  return CODES.filter((lang) => can(viewer, capability, lang));
}

/**
 * Whether somebody does anything that spends ElevenLabs credits, anywhere: regenerating, or
 * configuring a lexicon that is synced to ElevenLabs. They are who may store a key, since
 * every such action is paid for with the caller's own.
 */
export function spendsCredits(viewer: Viewer | null): boolean {
  return CODES.some((lang) => can(viewer, "regenerate", lang) || can(viewer, "configure", lang));
}

/**
 * Whether somebody may open a language's /voices: anybody who spends in it, since that is
 * where they choose their generator for it and put its voices into their own account. What
 * the voices are made from -- the clips, the fish.audio references -- is canManageVoices.
 */
export function canViewVoices(viewer: Viewer | null, lang: Lang): boolean {
  return can(viewer, "regenerate", lang) || can(viewer, "configure", lang);
}

/**
 * The one definition of who may change what a language's voices are made from: their clips
 * and their fish.audio references. Both are the language's own (clone-name.ts, migration
 * 0042), so its admin looks after them, as a global admin does everywhere.
 */
export function canManageVoices(viewer: Viewer | null, lang: Lang): boolean {
  return can(viewer, "admin", lang);
}

/** Whether somebody may hand out or take away `capability` in `lang`. */
export function canGrant(viewer: Viewer | null, capability: Capability, lang: Lang): boolean {
  if (!viewer) return false;
  if (viewer.role === "admin") return true;
  return capability !== "text" && can(viewer, "admin", lang);
}

/**
 * Whether this removal is a language admin taking away their own admin: it is what lets them
 * reach /admin at all, so doing it would lock them out of the page that gives it back. Another
 * admin, or a site admin, can.
 */
export function removesOwnAdmin(viewer: Viewer, viewerId: string, userId: string, capability: Capability): boolean {
  return userId === viewerId && capability === "admin" && !isAdmin(viewer.role);
}

/** Whether somebody holds anything at all in a language, which lets them see it switched off. */
export function worksIn(viewer: Viewer | null, lang: Lang): boolean {
  if (!viewer) return false;
  return viewer.role === "admin" || viewer.grants.some((grant) => grant.lang === lang);
}
