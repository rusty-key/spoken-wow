/**
 * Outgoing email, through Resend's HTTP API.
 */
import "server-only";

const SEND_TIMEOUT_MS = 10_000;

/**
 * Hand one plain-text email to the mail provider; resolves whether it took it.
 *
 * Never rejects, so a caller whose email follows an act that has already happened can leave it
 * unawaited: a mail provider that is down or slow must not turn that act into an error or a
 * wait. A failure is logged by subject only, since the body can carry a credential.
 */
export function sendEmail(to: string, subject: string, text: string, headers?: Record<string, string>): Promise<boolean> {
  return send(to, subject, text, headers).then(
    () => true,
    (error) => {
      console.error(`email: could not send "${subject}"`, error);
      return false;
    },
  );
}

/**
 * Hand the reset link to the mail provider.
 *
 * Never awaited by the caller, and never throws. Better Auth answers an unknown address without
 * sending anything, so a request that waited on Resend, or failed with it, would tell a stranger
 * which addresses have accounts.
 */
export function sendPasswordResetEmail(to: string, url: string): void {
  void sendEmail(
    to,
    "Reset your Spoken password",
    [
      "Someone asked to reset the password of your Spoken account.",
      "",
      `Choose a new password here: ${url}`,
      "",
      "The link works once and expires in one hour. If this wasn't you, ignore this email and your password stays as it is.",
    ].join("\n"),
  );
}

/** The invitation to an address with no account yet; resolves whether the provider took it. */
export function sendInviteEmail(
  to: string,
  args: { inviterName: string; langName: string; capabilities: string[]; url: string; days: number },
): Promise<boolean> {
  const { inviterName, langName, capabilities, url, days } = args;
  return sendEmail(
    to,
    `You're invited to work on ${langName} on Spoken`,
    [
      `${inviterName} invited you to work on ${langName} on Spoken, as: ${capabilities.join(", ")}.`,
      "",
      `Accept here: ${url}`,
      "",
      `If you have no account yet, register from that link with this address. The link works once and expires in ${days} days. If you don't know ${inviterName}, ignore this email.`,
    ].join("\n"),
  );
}

/** The address that asked on /listen to hear when voices change, and its confirmation link. */
export function sendFollowConfirmEmail(to: string, url: string): Promise<boolean> {
  return sendEmail(
    to,
    "Confirm your email for Spoken's voices",
    [
      "Someone asked Spoken to email this address when a voice they voted on gets a new version.",
      "",
      `Confirm here: ${url}`,
      "",
      "If this wasn't you, ignore this email and you won't hear from us.",
    ].join("\n"),
  );
}

/** One email for every voice shown again since the last one; `listen` links each language's page. */
export function sendVoicesChangedEmail(
  to: string,
  voices: { name: string; langName: string; listen: string }[],
  unsubscribe: string,
): Promise<boolean> {
  const lines = voices.map((voice) => `- ${voice.name} (${voice.langName}): ${voice.listen}`);
  return sendEmail(
    to,
    voices.length === 1 ? `New version of a voice you voted on: ${voices[0].name}` : `New versions of ${voices.length} voices you voted on`,
    [
      "You voted on these voices on Spoken. They have a new version. Have a listen and tell us whether it fits now:",
      "",
      ...lines,
      "",
      `Stop these emails: ${unsubscribe}`,
    ].join("\n"),
    { "List-Unsubscribe": `<${unsubscribe}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
  );
}

async function send(to: string, subject: string, text: string, headers?: Record<string, string>): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM;
  if (!apiKey || !from) {
    // Lets the flows be tried locally without a Resend account.
    if (process.env.NODE_ENV !== "production") {
      console.info(`email: RESEND_API_KEY or RESEND_FROM unset; email to ${to}: ${subject}\n${text}`);
      return;
    }
    throw new Error("RESEND_API_KEY and RESEND_FROM must be set");
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to, subject, text, ...(headers ? { headers } : {}) }),
    signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`Resend answered ${response.status}: ${await response.text()}`);
  }
}
