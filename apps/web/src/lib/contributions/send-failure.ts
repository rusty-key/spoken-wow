/**
 * Led by the HTTP status: an error from Cloudflare or nginx is an HTML page with no body to read.
 * `null` is no response at all, and `code` is the route's own error when it sent one. The number
 * and code are in the text so a report can name the failure.
 */
export function sendFailureMessage(status: number | null, code?: string): string {
  if (status === null) {
    return "Your browser could not reach the site. Check your connection, turn off any blocker for this page, and try again.";
  }
  if (status === 429) return "That is a lot of sending for one hour. Try again later.";
  if (status === 413) return "That is more than the site takes in one send (error 413).";
  if (status >= 500) {
    return `The site could not finish that (error ${status}). It may be busy or restarting, so try again in a few minutes.`;
  }
  return `The site refused that (error ${status}${code ? `: ${code}` : ""}). If it keeps happening, tell us the error.`;
}
