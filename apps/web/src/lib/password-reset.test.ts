/**
 * The password reset through better-auth's real HTTP handler, against a real Postgres. Only
 * Resend is replaced, so the link the test follows is the link a person would get.
 *
 * Needs DATABASE_URL and the migrations applied.
 */
import { randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { closeDb } = await import("@/lib/db");
const { asSystem } = await import("@/lib/teams/testing");
const { auth } = await import("@/lib/auth");

const ORIGIN = new URL(process.env.BETTER_AUTH_URL ?? "http://localhost:3000").origin;
const made: string[] = [];
const sendToResend = vi.fn<(body: { to: string; text: string }) => Response>();

function post(path: string, body: unknown): Promise<Response> {
  return auth.handler(
    new Request(`${ORIGIN}/api/auth${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: JSON.stringify(body),
    }),
  );
}

async function person() {
  const email = `password-reset-${randomUUID()}@example.test`;
  const password = `pw-${randomUUID()}`;
  const { headers, response } = await auth.api.signUpEmail({
    body: { email, password, name: "Reset" },
    returnHeaders: true,
  });
  made.push(response.user.id);
  return { email, password, cookie: headers.get("set-cookie")!.split(";")[0] };
}

/** Asks for a reset and returns the link from the email, once Resend has been called. */
async function resetLink(email: string): Promise<string> {
  const answer = await post("/request-password-reset", { email, redirectTo: "/frFR/reset-password" });
  expect(answer.status).toBe(200);
  await vi.waitFor(() => expect(sendToResend).toHaveBeenCalled());
  const { to, text } = sendToResend.mock.lastCall![0];
  expect(to).toBe(email);
  return text.match(/https?:\/\/\S+/)![0];
}

/** Follows the emailed link to where it lands in the site. */
async function follow(link: string): Promise<URL> {
  const answer = await auth.handler(new Request(link));
  expect(answer.status).toBe(302);
  return new URL(answer.headers.get("location")!, ORIGIN);
}

beforeAll(async () => {
  // Better Auth turns its origin check off under NODE_ENV=test, and that check is what keeps
  // the emailed link from pointing at another site.
  (await auth.$context).skipOriginCheck = false;
});

beforeEach(() => {
  vi.stubEnv("RESEND_API_KEY", "test-key");
  vi.stubEnv("RESEND_FROM", "Spoken <noreply@example.test>");
  sendToResend.mockReset();
  sendToResend.mockImplementation(() => new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) =>
    sendToResend(JSON.parse(init.body as string)),
  );
});

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await asSystem.query(`delete from "user" where "id" = any($1)`, [made]);
  made.length = 0;
});

afterAll(async () => {
  await closeDb();
});

describe("password reset", () => {
  it("changes the password through the emailed link and signs every device out", async () => {
    const { email, password, cookie } = await person();

    const landed = await follow(await resetLink(email));
    expect(landed.pathname).toBe("/frFR/reset-password");
    const token = landed.searchParams.get("token");

    const newPassword = `pw-${randomUUID()}`;
    expect((await post("/reset-password", { newPassword, token })).status).toBe(200);

    expect((await post("/sign-in/email", { email, password })).status).toBe(401);
    expect((await post("/sign-in/email", { email, password: newPassword })).status).toBe(200);
    expect(await auth.api.getSession({ headers: new Headers({ cookie }) })).toBeNull();
  });

  it("lets a link be used only once, and sends a used link back with an error", async () => {
    const { email } = await person();
    const link = await resetLink(email);
    const token = (await follow(link)).searchParams.get("token");

    const newPassword = `pw-${randomUUID()}`;
    expect((await post("/reset-password", { newPassword, token })).status).toBe(200);
    expect((await post("/reset-password", { newPassword, token })).status).toBe(400);

    const landed = await follow(link);
    expect(landed.searchParams.get("error")).toBe("INVALID_TOKEN");
    expect(landed.searchParams.get("token")).toBeNull();
  });

  it("answers an unknown address the same as a known one, and emails nobody", async () => {
    const answer = await post("/request-password-reset", {
      email: `nobody-${randomUUID()}@example.test`,
      redirectTo: "/frFR/reset-password",
    });
    expect(answer.status).toBe(200);
    expect(sendToResend).not.toHaveBeenCalled();
  });

  it("answers the same when Resend fails, and leaves the password alone", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    sendToResend.mockImplementation(() => new Response("nope", { status: 500 }));
    const { email, password } = await person();

    const answer = await post("/request-password-reset", { email, redirectTo: "/frFR/reset-password" });
    expect(answer.status).toBe(200);
    await vi.waitFor(() => expect(error).toHaveBeenCalled());
    expect(JSON.stringify(error.mock.calls)).not.toContain("/reset-password/");
    error.mockRestore();

    expect((await post("/sign-in/email", { email, password })).status).toBe(200);
  });

  it("refuses to send the emailed link to another site", async () => {
    const { email } = await person();
    const answer = await post("/request-password-reset", {
      email,
      redirectTo: "https://evil.example/steal",
    });
    expect(answer.status).toBe(403);
    expect(sendToResend).not.toHaveBeenCalled();
  });
});
