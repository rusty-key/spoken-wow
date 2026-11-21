/**
 * The Discord server's invite, and the address everything else links to instead of it.
 *
 * spoken.quest/discord is the link the addons, READMEs and store pages carry. An invite can
 * die without anyone touching those pages: someone deletes it, its creator leaves the server.
 * When that happens the fix is a new invite here and a deploy, not a re-paste of every
 * CurseForge description and a release of every addon.
 *
 * TEMPORARY, NOT PERMANENT. A 308 is cached by the browser, so a player who once followed it
 * would keep landing on the dead invite after it is replaced.
 */
export const DISCORD_INVITE = "https://discord.gg/KgeQhjv9Rd";

export const discordRedirects = [{ source: "/discord", destination: DISCORD_INVITE, permanent: false }];
