/**
 * The role model, shared by the server and the browser so the list of roles is defined once.
 *
 * Two global roles: a `member` is anyone who registered, and an `admin` may do anything,
 * including manage users and voices. Everything in between -- writing a language, cutting
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

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

/** The one definition of who may reach /admin. */
export function isAdmin(role: string | null | undefined): boolean {
  return role === "admin";
}

/** The one definition of who may change what the voices are made from. */
export function canManageVoices(role: string | null | undefined): boolean {
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
 * `admin` in a language is every other capability there, plus handing out `edit` and
 * `regenerate` in it -- never `configure`, `ignore`, `record` or `admin`, which only a global
 * admin grants: the first three decide things for everybody working in the language, and
 * `record` puts somebody's voice in a pack under their name (0061).
 */
export const CAPABILITIES = ["edit", "regenerate", "configure", "ignore", "admin", "record"] as const;

export type Capability = (typeof CAPABILITIES)[number];

/**
 * What /admin calls each capability: its own name, except where that would not say who holds
 * it. Total, so a capability added above without a label is a type error.
 */
const CAPABILITY_LABELS: Record<Capability, string> = {
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
 * language say, `admin` there standing for all of them -- English no differently from the
 * rest, since 0045 turned the old collaborator role into English grants.
 */
export function can(viewer: Viewer | null, capability: Capability, lang: Lang): boolean {
  if (!viewer) return false;
  if (viewer.role === "admin") return true;
  return viewer.grants.some(
    (grant) =>
      grant.lang === lang && (grant.capability === capability || grant.capability === "admin"),
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
 * the voices are made from -- the clips, the fish.audio references -- stays canManageVoices.
 */
export function canViewVoices(viewer: Viewer | null, lang: Lang): boolean {
  return can(viewer, "regenerate", lang) || can(viewer, "configure", lang);
}

/** Whether somebody may hand out grants in `lang`: every capability there, or none. */
export function canGrant(viewer: Viewer | null, lang: Lang): boolean {
  if (!viewer) return false;
  if (viewer.role === "admin") return true;
  return can(viewer, "admin", lang);
}

/** Whether somebody holds anything at all in a language, which lets them see it switched off. */
export function worksIn(viewer: Viewer | null, lang: Lang): boolean {
  if (!viewer) return false;
  return viewer.role === "admin" || viewer.grants.some((grant) => grant.lang === lang);
}
