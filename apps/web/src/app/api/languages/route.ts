/**
 * Which languages the site serves, and switching one on or off.
 *
 * GET is public: the header's switcher asks it, and an enabled language is no secret. An
 * admin is also told about the languages that are off, so they can open one to prepare it
 * before anybody else sees it. PUT and POST are admin-only.
 */
import { headers } from "next/headers";

import { auth } from "@/lib/auth";
import { langName } from "@/lib/lang";
import { forgetLanguages } from "@/lib/languages/catalogue";
import { LanguageExistsError, addLanguage, languageStates, setEnabled } from "@/lib/languages/store";
import { recordActivity } from "@/lib/activity/store";
import { inTransaction } from "@/lib/db";
import { isAdmin } from "@/lib/permissions";
import { forgetTeams } from "@/lib/teams/store";

export const dynamic = "force-dynamic";

export async function GET() {
  const [session, states] = await Promise.all([
    auth.api.getSession({ headers: await headers() }),
    languageStates(),
  ]);
  const admin = isAdmin(session?.user.role);
  return Response.json({
    languages: states
      .filter((state) => state.enabled || admin)
      .map((state) => ({ code: state.code, name: langName(state.code), enabled: state.enabled })),
  });
}

export async function PUT(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !isAdmin(session.user.role)) {
    return Response.json({ error: "not allowed" }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as { code?: unknown; enabled?: unknown } | null;
  if (typeof body?.code !== "string" || typeof body.enabled !== "boolean") {
    return Response.json({ error: "expected { code, enabled }" }, { status: 400 });
  }

  try {
    await setEnabled(body.code, body.enabled, session.user.id);
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
  return GET();
}

const CODE = /^[a-z]{2}[A-Z]{2}$/;
const PROVIDER = /^[a-z]{2}$/;
const BCP47 = /^[a-z]{2,3}-[A-Z]{2}$/;
const MAX_NAME = 60;

function described(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text && text.length <= MAX_NAME ? text : null;
}

/** The page sections, baked in by next.config.ts: the standalone bundle cannot read src/app/[lang]. */
function isPageSection(code: string): boolean {
  const sections = (process.env.SPOKEN_PAGE_SECTIONS ?? "").split(",");
  return sections.some((section) => section.toLowerCase() === code.toLowerCase());
}

/** A new language, switched off. */
export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !isAdmin(session.user.role)) {
    return Response.json({ error: "not allowed" }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const name = described(body?.name);
  const native = described(body?.native);
  const { code, bcp47, provider } = body ?? {};
  if (
    typeof code !== "string" || !CODE.test(code) ||
    typeof provider !== "string" || !PROVIDER.test(provider) ||
    typeof bcp47 !== "string" || !BCP47.test(bcp47) ||
    !name || !native
  ) {
    return Response.json(
      { error: "expected { code: xxXX, name, native, bcp47: xx-XX, provider: xx }" },
      { status: 400 },
    );
  }

  if (isPageSection(code)) {
    return Response.json({ error: `${code} would shadow a page` }, { status: 400 });
  }

  try {
    await inTransaction((client) => addLanguage(client, { code, name, native, bcp47, provider }, session.user.id));
  } catch (error) {
    if (error instanceof LanguageExistsError) return Response.json({ error: error.message }, { status: 409 });
    throw error;
  }
  forgetLanguages();
  forgetTeams();
  await recordActivity({ kind: "language.added", lang: code, actorId: session.user.id, detail: { name } });
  return GET();
}
