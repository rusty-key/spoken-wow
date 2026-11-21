export const CURSEFORGE = "https://www.curseforge.com/wow/addons";
export const WAGO = "https://addons.wago.io/addons";
export const GITHUB = "https://github.com/rusty-key/spoken-wow";
export const RELEASES = `${GITHUB}/releases`;
export const MANAGER_URL = `${RELEASES}/tag/manager-latest`;

/** The GitHub releases of one release tag prefix. */
export const githubReleases = (release: string) => `${RELEASES}?q=${encodeURIComponent(release)}`;
