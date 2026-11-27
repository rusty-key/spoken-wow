/**
 * Every follow-up email's way out. POST unsubscribes: it is what mail clients send from the
 * List-Unsubscribe header, and what the page behind the email's link submits. GET only shows that
 * page, since mail scanners open links and would otherwise unsubscribe people who never asked.
 * Signed, so nobody can turn off someone else's emails.
 */
import { unsubscribe, verifyUnsubscribe } from "@/lib/voice-feedback/follow";

export const dynamic = "force-dynamic";

const escape = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function signed(request: Request): { email: string; sig: string } | null {
  const params = new URL(request.url).searchParams;
  const email = params.get("email") ?? "";
  const sig = params.get("sig") ?? "";
  return email && sig && verifyUnsubscribe(email, sig) ? { email, sig } : null;
}

const page = (body: string, status = 200) =>
  new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Spoken</title>${body}`, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });

export async function GET(request: Request) {
  const link = signed(request);
  if (!link) return page("<p>This link is not valid.</p>", 400);
  const action = `/api/listen/unsubscribe?email=${encodeURIComponent(link.email)}&sig=${encodeURIComponent(link.sig)}`;
  return page(
    `<p>Stop Spoken's emails about voices to ${escape(link.email)}?</p><form method="post" action="${escape(action)}"><button type="submit">Unsubscribe</button></form>`,
  );
}

export async function POST(request: Request) {
  const link = signed(request);
  if (!link) return page("<p>This link is not valid.</p>", 400);
  await unsubscribe(link.email);
  return page("<p>Done. Spoken won't email you about voices any more.</p>");
}
