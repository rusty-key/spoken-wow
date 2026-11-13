/**
 * The checks a route runs before it changes an open invite: a signed-in viewer, an invite that is
 * open, and the right to hand out everything it names.
 */
import "server-only";

import { headers } from "next/headers";

import { auth } from "@/lib/auth";
import { refusedGrant, viewerOf } from "@/lib/grants/store";
import { isLang, type Lang } from "@/lib/lang";
import type { Viewer } from "@/lib/permissions";
import { isUuid } from "@/lib/uuid";

import { openInvite, type InviteRow } from "./store";

type Session = NonNullable<Awaited<ReturnType<typeof auth.api.getSession>>>;

export type Manageable = { session: Session; viewer: Viewer; invite: InviteRow; lang: Lang };

const notAllowed = () => Response.json({ error: "not allowed" }, { status: 403 });
export const noSuchInvite = () => Response.json({ error: "no such invite" }, { status: 404 });

/** The open invite `id` and who may change it, or the 403 or 404 to answer instead. */
export async function manageableInvite(id: string): Promise<Manageable | Response> {
  const session = await auth.api.getSession({ headers: await headers() });
  const viewer = await viewerOf(session);
  if (!session || !viewer) return notAllowed();
  const invite = isUuid(id) ? await openInvite(id) : null;
  if (!invite || !isLang(invite.lang)) return noSuchInvite();
  const lang = invite.lang;
  if (await refusedGrant(viewer, invite.capabilities, lang)) return notAllowed();
  return { session, viewer, invite, lang };
}
