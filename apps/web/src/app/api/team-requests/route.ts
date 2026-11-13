import { bad, bodyOf, objectOf } from "@/lib/api-body";
import { BASE_LANG, isLang } from "@/lib/lang";
import { loadLanguages } from "@/lib/languages/catalogue";
import { describedName, LANG_CODE, newLanguageError } from "@/lib/languages/validate";
import { isAdmin } from "@/lib/permissions";
import { currentSession } from "@/lib/session";
import { TeamError } from "@/lib/teams/admin";
import { createRequest, listRequests, type RequestState } from "@/lib/teams/requests";

export const dynamic = "force-dynamic";

const MAX_NOTE = 1000;
const signedOut = () => Response.json({ error: "Sign in first." }, { status: 401 });

/** The caller's own requests; a site admin asking `?state=pending` gets everybody's. */
export async function GET(request: Request) {
  const session = await currentSession();
  if (!session) return signedOut();
  const state = new URL(request.url).searchParams.get("state");
  if (state === "pending" && isAdmin(session.user.role)) {
    return Response.json({ requests: await listRequests({ state: state as RequestState }) });
  }
  return Response.json({ requests: await listRequests({ userId: session.user.id }) });
}

export async function POST(request: Request) {
  const session = await currentSession();
  if (!session) return signedOut();

  const body = objectOf(await bodyOf(request));
  if (!body) return bad("Expected { lang, language?, teamName, note? }.");
  const { lang, language, teamName, note } = body;
  if (typeof lang !== "string" || !LANG_CODE.test(lang)) return bad("A language code is two lowercase letters and two capitals.");
  if (lang === BASE_LANG) return bad("English is one team; it cannot be requested.");
  const team = describedName(teamName);
  if (!team) return bad("A team needs a name of 1 to 60 characters.");
  if (note !== undefined && note !== null && (typeof note !== "string" || note.length > MAX_NOTE)) {
    return bad(`A note is at most ${MAX_NOTE} characters.`);
  }

  await loadLanguages();
  let names: { name: string; native: string } | null = null;
  if (isLang(lang)) {
    if (language !== undefined && language !== null) return bad(`${lang} is already a language; send no names.`);
  } else {
    const given = objectOf(language);
    const problem = newLanguageError(lang, given?.name, given?.native);
    if (problem) return bad(problem);
    names = { name: describedName(given?.name)!, native: describedName(given?.native)! };
  }

  try {
    const made = await createRequest(session.user.id, {
      lang,
      language: names,
      teamName: team,
      note: typeof note === "string" && note.trim() ? note.trim() : null,
    });
    return Response.json({ request: made });
  } catch (error) {
    if (error instanceof TeamError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
