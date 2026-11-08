/**
 * What to tell a player whose contribution did not arrive, from the HTTP status alone: an error
 * from Cloudflare or nginx is an HTML page with no body to read. `null` is no response at all.
 *
 * The number is in the text so a player's report can say which failure they met.
 */
export function sendFailureMessage(status: number | null): string {
  if (status === null) {
    return "Your browser could not reach the site. Check your connection, turn off any blocker for this page, and try again.";
  }
  if (status === 429) return "That is a lot of sending for one hour. Try again later.";
  if (status === 413) return "That is more than the site takes in one send (error 413).";
  if (status >= 500) {
    return `The site could not finish that (error ${status}). It may be busy or restarting, so try again in a few minutes.`;
  }
  return `The site refused that (error ${status}). If it keeps happening, tell us the error number.`;
}
