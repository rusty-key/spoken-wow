/**
 * Who may do what in which language.
 *
 * A global admin sees and changes every grant. Somebody who is `admin` in a language sees
 * that language's and may hand out its team capabilities, and `text` when its team appoints it
 * (`textByTeam`).
 * lib/permissions.ts `canGrant` is the rule; this only applies it.
 */
import { headers } from "next/headers";

import { auth } from "@/lib/auth";
import { recordActivity } from "@/lib/activity/store";
import { sendInviteEmail } from "@/lib/email";
import { addGrants, refusedGrant, removeGrant, userByEmail, viewerOf } from "@/lib/grants/store";
import { listingFor } from "@/lib/invites/listing";
import {
  createInvite,
  InviteExistsError,
  InviteRateError,
  inviteUrl,
  normalEmail,
} from "@/lib/invites/store";
import { isLang, langName } from "@/lib/lang";
import { capabilityLabel, isAdmin, isCapability, removesOwnAdmin, type Viewer } from "@/lib/permissions";

export const dynamic = "force-dynamic";

const FORBIDDEN = () => Response.json({ error: "not allowed" }, { status: 403 });

async function viewer(): Promise<{ viewer: Viewer; userId: string } | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  const seen = await viewerOf(session);
  return session && seen ? { viewer: seen, userId: session.user.id } : null;
}

export async function GET() {
  const who = await viewer();
  return who ? listingFor(who.viewer) : FORBIDDEN();
}

export async function PUT(request: Request) {
  const who = await viewer();
  if (!who) return FORBIDDEN();

  const body = (await request.json().catch(() => ({}))) as {
    email?: unknown;
    lang?: unknown;
    capabilities?: unknown;
  };
  const { email, lang, capabilities } = body;
  if (
    typeof email !== "string" ||
    !isLang(lang) ||
    !Array.isArray(capabilities) ||
    capabilities.length === 0 ||
    !capabilities.every(isCapability)
  ) {
    return Response.json({ error: "expected { email, lang, capabilities: [...] }" }, { status: 400 });
  }
  const address = normalEmail(email);
  if (!address) return Response.json({ error: `${email} is not an email address` }, { status: 400 });
  if (await refusedGrant(who.viewer, capabilities, lang)) return FORBIDDEN();

  // By email, not by id: a language admin cannot list the users, and an address is what
  // a translator gives somebody when asking to be let in.
  const user = await userByEmail(address);
  if (user) {
    await addGrants(user.id, lang, capabilities, who.userId);
    return listingFor(who.viewer, { invited: false });
  }

  // Nobody has registered as it: invite the address instead.
  try {
    const { invite, token } = await createInvite({
      email: address,
      lang,
      capabilities,
      invitedBy: who.userId,
      limited: !isAdmin(who.viewer.role),
    });
    await recordActivity({
      kind: "invite.sent",
      lang,
      subject: invite.id,
      actorId: who.userId,
      detail: { email: address, capabilities },
    });
    sendInviteEmail(address, {
      inviterName: invite.invitedByName ?? "A Spoken team member",
      langName: langName(lang),
      capabilities: capabilities.map(capabilityLabel),
      url: inviteUrl(token),
    });
  } catch (error) {
    if (error instanceof InviteExistsError || error instanceof InviteRateError) {
      if (error instanceof InviteRateError) console.warn(`invites: ${who.userId} refused: ${error.message}`);
      return Response.json({ error: error.message }, { status: error instanceof InviteExistsError ? 409 : 429 });
    }
    throw error;
  }
  return listingFor(who.viewer, { invited: true });
}

export async function DELETE(request: Request) {
  const who = await viewer();
  if (!who) return FORBIDDEN();

  const params = new URL(request.url).searchParams;
  const userId = params.get("userId");
  const lang = params.get("lang");
  const capability = params.get("capability");
  if (!userId || !isLang(lang) || !isCapability(capability)) {
    return Response.json({ error: "userId, lang and capability are required" }, { status: 400 });
  }
  if (await refusedGrant(who.viewer, [capability], lang)) return FORBIDDEN();
  if (removesOwnAdmin(who.viewer, who.userId, userId, capability)) {
    return Response.json({ error: "you cannot remove your own admin" }, { status: 403 });
  }

  await removeGrant(userId, lang, capability, who.userId);
  return listingFor(who.viewer);
}
