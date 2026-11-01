import { describe, expect, it } from "vitest";

import { CODES } from "./lang";
import {
  can,
  canGrant,
  langsWhere,
  spendsCredits,
  worksIn,
  canConfigureGeneration,
  canManageVoices,
  isAdmin,
  isRole,
  ROLES,
  roles,
  type Grant,
} from "./permissions";

describe("isAdmin", () => {
  it("admits only the admin role", () => {
    expect(isAdmin("admin")).toBe(true);
    expect(isAdmin("member")).toBe(false);
    expect(isAdmin(undefined)).toBe(false);
  });
});

describe("canManageVoices", () => {
  it("admits only admins", () => {
    expect(canManageVoices("admin")).toBe(true);
    expect(canManageVoices("member")).toBe(false);
    expect(canManageVoices(null)).toBe(false);
  });
});

describe("canConfigureGeneration", () => {
  it("admits only admins", () => {
    expect(canConfigureGeneration("admin")).toBe(true);
    expect(canConfigureGeneration("member")).toBe(false);
    expect(canConfigureGeneration(null)).toBe(false);
  });
});

describe("isRole", () => {
  it("accepts every declared role and nothing else", () => {
    for (const role of ROLES) expect(isRole(role)).toBe(true);
    expect(isRole("root")).toBe(false);
    // Retired by 0045, which turned it into English grants.
    expect(isRole("collaborator")).toBe(false);
    expect(isRole(null)).toBe(false);
  });
});

// The access-control grants are what the admin plugin itself enforces, so they have to
// agree with the isAdmin/canManageVoices helpers the UI uses.
describe("access control", () => {
  it("grants voiceline regeneration to admin alone -- anybody else holds it by language", () => {
    const permission = { voiceline: ["regenerate"] } as const;
    expect(roles.member.authorize(permission).success).toBe(false);
    expect(roles.admin.authorize(permission).success).toBe(true);
  });

  it("grants generation configuration to admin alone", () => {
    const permission = { voiceline: ["configure"] } as const;
    expect(roles.member.authorize(permission).success).toBe(false);
    expect(roles.admin.authorize(permission).success).toBe(true);
  });

  it("grants voice management to admin alone", () => {
    const permission = { voice: ["manage"] } as const;
    expect(roles.member.authorize(permission).success).toBe(false);
    expect(roles.admin.authorize(permission).success).toBe(true);
  });

  it("keeps user management on admin alone", () => {
    const permission = { user: ["set-role", "list"] } as const;
    expect(roles.member.authorize(permission).success).toBe(false);
    expect(roles.admin.authorize(permission).success).toBe(true);
  });

  it("declares a role object for every name in ROLES", () => {
    expect(Object.keys(roles).sort()).toEqual([...ROLES].sort());
  });
});

describe("per-language permissions", () => {
  const member = (grants: Grant[]) => ({ role: "member", grants });

  it("gives a global admin everything, everywhere", () => {
    expect(can({ role: "admin", grants: [] }, "configure", "ptBR")).toBe(true);
  });

  it("treats English as a language like the rest: what its grants say, and no more", () => {
    // What the retired collaborator role became in 0045.
    const english = member([
      { lang: "enUS", capability: "edit" },
      { lang: "enUS", capability: "regenerate" },
    ]);
    expect(can(english, "edit", "enUS")).toBe(true);
    expect(can(english, "regenerate", "enUS")).toBe(true);
    expect(can(english, "configure", "enUS")).toBe(false);
    expect(can(english, "edit", "ptBR")).toBe(false);
    // A role left behind by a release before 0045 is worth nothing on its own.
    expect(can({ role: "collaborator", grants: [] }, "edit", "enUS")).toBe(false);
  });

  it("lets a translator write their language and nothing else", () => {
    const translator = member([{ lang: "ptBR", capability: "edit" }]);
    expect(can(translator, "edit", "ptBR")).toBe(true);
    expect(can(translator, "regenerate", "ptBR")).toBe(false);
    expect(can(translator, "edit", "enUS")).toBe(false);
    expect(can(translator, "edit", "deDE")).toBe(false);
  });

  it("makes a language's admin everything in it, and a granter of everything in it", () => {
    const lead = member([{ lang: "ptBR", capability: "admin" }]);
    expect(can(lead, "ignore", "ptBR")).toBe(true);
    expect(canGrant(lead, "edit", "ptBR")).toBe(true);
    expect(canGrant(lead, "regenerate", "ptBR")).toBe(true);
    expect(canGrant(lead, "configure", "ptBR")).toBe(true);
    expect(canGrant(lead, "admin", "ptBR")).toBe(true);
    expect(canGrant(lead, "admin", "deDE")).toBe(false);
    expect(canGrant(lead, "edit", "deDE")).toBe(false);
  });

  it("lets a voice actor record their language, and a language admin make one", () => {
    const actor = member([{ lang: "deDE", capability: "record" }]);
    expect(can(actor, "record", "deDE")).toBe(true);
    expect(can(actor, "record", "frFR")).toBe(false);
    expect(can(actor, "edit", "deDE")).toBe(false);
    expect(can(actor, "regenerate", "deDE")).toBe(false);
    // A language's admin may record in it, as they may do everything there...
    const lead = member([{ lang: "deDE", capability: "admin" }]);
    expect(can(lead, "record", "deDE")).toBe(true);
    expect(canGrant(lead, "record", "deDE")).toBe(true);
    expect(canGrant(lead, "record", "frFR")).toBe(false);
    expect(canGrant({ role: "admin", grants: [] }, "record", "deDE")).toBe(true);
  });

  it("lists the languages somebody may act in", () => {
    expect(langsWhere({ role: "admin", grants: [] }, "regenerate")).toHaveLength(CODES.length);
    expect(langsWhere(member([{ lang: "enUS", capability: "regenerate" }]), "regenerate")).toEqual([
      "enUS",
    ]);
    expect(langsWhere(member([{ lang: "ptBR", capability: "admin" }]), "regenerate")).toEqual([
      "ptBR",
    ]);
    expect(langsWhere(member([{ lang: "ptBR", capability: "edit" }]), "regenerate")).toEqual([]);
    expect(langsWhere(null, "regenerate")).toEqual([]);
  });

  it("lets anybody who regenerates or configures anywhere hold a key", () => {
    expect(spendsCredits(member([{ lang: "enUS", capability: "regenerate" }]))).toBe(true);
    expect(spendsCredits(member([{ lang: "ptBR", capability: "regenerate" }]))).toBe(true);
    expect(spendsCredits(member([{ lang: "ptBR", capability: "configure" }]))).toBe(true);
    expect(spendsCredits(member([{ lang: "ptBR", capability: "edit" }]))).toBe(false);
    expect(spendsCredits(member([]))).toBe(false);
  });

  it("lets somebody working in a language see it before it is switched on", () => {
    expect(worksIn(member([{ lang: "ptBR", capability: "edit" }]), "ptBR")).toBe(true);
    expect(worksIn(member([]), "ptBR")).toBe(false);
  });
});
