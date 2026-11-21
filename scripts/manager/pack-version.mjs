// A pack's version is the one in the .toc it has on the channel: a press on the droplet cannot
// commit, so nothing in git keeps up with it.
export const BUMPS = ["patch", "minor", "major"];

const VERSION_LINE = /^## Version:[ \t]*(.*?)[ \t]*$/m;

export function bumpVersion(version, bump) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`cannot bump version ${version}: it is not x.y.z`);
  const [major, minor, patch] = version.split(".").map(Number);
  if (bump === "major") return `${major + 1}.0.0`;
  if (bump === "minor") return `${major}.${minor + 1}.0`;
  if (bump === "patch") return `${major}.${minor}.${patch + 1}`;
  throw new Error(`no such bump: ${bump}`);
}

export function tocVersion(text) {
  const version = VERSION_LINE.exec(text)?.[1];
  if (!version) throw new Error("the .toc has no '## Version:' line");
  return version;
}

export function withTocVersion(text, version) {
  if (!VERSION_LINE.test(text)) throw new Error("the .toc has no '## Version:' line");
  return text.replace(VERSION_LINE, () => `## Version: ${version}`);
}
