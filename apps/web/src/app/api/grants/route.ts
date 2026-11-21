/**
 * Who may do what in which language.
 *
 * A global admin sees and changes every grant. Somebody who is `admin` in a language sees and
 * changes their own team's grants there, and hands out its team capabilities into that team. An
 * admin of any team of the language also sees its text maintainers, and appoints them when the
 * language lets its teams (`textByTeam`).
 * lib/permissions.ts `canGrant` is the rule; this only applies it.
 */
import { headers } from "next/headers";

import { auth } from "@/lib/auth";
import { addGrants, OtherTeamError, refusedGrant, removeGrant, userByEmail, viewerOf } from "@/lib/grants/store";
import { deletingResponse } from "@/lib/teams/deleting";
import { listingFor, notAllowed } from "@/lib/invites/listing";
import {
  createInvite,
  emailInvite,
  InviteExistsError,
  InviteRateError,
  InviteSendError,
  revokeOpenFor,
  normalEmail,
} from "@/lib/invites/store";
import { knownLang } from "@/lib/languages/catalogue";
import { isAdmin, isCapability, removesOwnAdmin, type Viewer } from "@/lib/permissions";
import { teamIn } from "@/lib/teams/acting";
import { ownerOf } from "@/lib/teams/store";

export const dynamic = "force-dynamic";

async function viewer(): Promise<{ viewer: Viewer; userId: string } | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  const seen = await viewerOf(session);
  return session && seen ? { viewer: seen, userId: session.user.id } : null;
}

export async function GET() {
  const who = await viewer();
  return who ? listingFor(who.viewer, who.userId) : notAllowed();
}

export async function PUT(request: Request) {
  const who = await viewer();
  if (!who) return notAllowed();

  const body = (await request.json().catch(() => ({}))) as {
    email?: unknown;
    lang?: unknown;
    capabilities?: unknown;
  };
  const { email, capabilities } = body;
  const lang = await knownLang(body.lang);
  if (
    typeof email !== "string" ||
    !lang ||
    !Array.isArray(capabilities) ||
    capabilities.length === 0 ||
    !capabilities.every(isCapability)
  ) {
    return Response.json({ error: "expected { email, lang, capabilities: [...] }" }, { status: 400 });
  }
  const address = normalEmail(email);
  if (!address) return Response.json({ error: `${email} is not an email address` }, { status: 400 });
  if (await refusedGrant(who.viewer, capabilities, lang)) return notAllowed();

  // By email, not by id: a language admin cannot list the users, and an address is what
  // a translator gives somebody when asking to be let in.
  const user = await userByEmail(address);
  if (user) {
    // A site owner's grant lands in the target person's team, else the team the site owner acts
    // in, the one they picked included.
    const team = isAdmin(who.viewer.role) ? ((await teamIn(user.id, lang)) ?? (await ownerOf(lang))) : undefined;
    try {
      await addGrants(user.id, lang, capabilities, who.userId, {
        team,
        within: (client) => revokeOpenFor(client, lang, address, user.id, capabilities, who.userId),
      });
    } catch (error) {
      if (error instanceof OtherTeamError) return Response.json({ error: error.message }, { status: 409 });
      const deleting = deletingResponse(error);
      if (deleting) return deleting;
      throw error;
    }
    return listingFor(who.viewer, who.userId, { invited: false });
  }

  // Nobody has registered as it: invite the address instead, into the inviter's team. A site
  // owner's joins the team they act in: the language's one team, else the one they picked.
  const inviterTeam = isAdmin(who.viewer.role) ? null : await teamIn(who.userId, lang);
  const team = inviterTeam ?? (await ownerOf(lang));
  if (!team) return Response.json({ error: `${lang} has no team to invite into` }, { status: 409 });
  try {
    await createInvite({
      email: address,
      lang,
      capabilities,
      invitedBy: who.userId,
      team,
      limited: !isAdmin(who.viewer.role),
      deliver: emailInvite,
    });
  } catch (error) {
    if (error instanceof InviteSendError) return Response.json({ error: error.message }, { status: 502 });
    const deleting = deletingResponse(error);
    if (deleting) return deleting;
    if (error instanceof InviteExistsError || error instanceof InviteRateError) {
      if (error instanceof InviteRateError) console.warn(`invites: ${who.userId} refused: ${error.message}`);
      return Response.json({ error: error.message }, { status: error instanceof InviteExistsError ? 409 : 429 });
    }
    throw error;
  }
  return listingFor(who.viewer, who.userId, { invited: true });
}

export async function DELETE(request: Request) {
  const who = await viewer();
  if (!who) return notAllowed();

  const params = new URL(request.url).searchParams;
  const userId = params.get("userId");
  const lang = await knownLang(params.get("lang"));
  const capability = params.get("capability");
  if (!userId || !lang || !isCapability(capability)) {
    return Response.json({ error: "userId, lang and capability are required" }, { status: 400 });
  }
  if (await refusedGrant(who.viewer, [capability], lang)) return notAllowed();
  if (removesOwnAdmin(who.viewer, who.userId, userId, capability)) {
    return Response.json({ error: "you cannot remove your own admin" }, { status: 403 });
  }

  // A team admin takes away only what their own team gave.
  const [team, theirs] =
    isAdmin(who.viewer.role) || capability === "text"
      ? [undefined, undefined]
      : await Promise.all([teamIn(who.userId, lang), teamIn(userId, lang)]);
  if (team && theirs && theirs !== team) return notAllowed();
  await removeGrant(userId, lang, capability, who.userId, team ?? undefined);
  return listingFor(who.viewer, who.userId);
}
