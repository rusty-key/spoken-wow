/**
 * Outgoing email, through Resend's HTTP API.
 */
import "server-only";

const SEND_TIMEOUT_MS = 10_000;

/**
 * Hand the reset link to the mail provider.
 *
 * Never awaited by the caller, and never throws. Better Auth answers an unknown address without
 * sending anything, so a request that waited on Resend, or failed with it, would tell a stranger
 * which addresses have accounts.
 */
export function sendPasswordResetEmail(to: string, url: string): void {
  send(to, url).catch((error) => {
    // The address and the link stay out of the log: the link is a credential for an hour.
    console.error("email: could not send a password reset", error);
  });
}

async function send(to: string, url: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM;
  if (!apiKey || !from) {
    // Lets the flow be tried locally without a Resend account.
    if (process.env.NODE_ENV !== "production") {
      console.info(`email: RESEND_API_KEY or RESEND_FROM unset; reset link for ${to}: ${url}`);
      return;
    }
    throw new Error("RESEND_API_KEY and RESEND_FROM must be set");
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to,
      subject: "Reset your Spoken password",
      text: [
        "Someone asked to reset the password of your Spoken account.",
        "",
        `Choose a new password here: ${url}`,
        "",
        "The link works once and expires in one hour. If this wasn't you, ignore this email and your password stays as it is.",
      ].join("\n"),
    }),
    signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`Resend answered ${response.status}: ${await response.text()}`);
  }
}
