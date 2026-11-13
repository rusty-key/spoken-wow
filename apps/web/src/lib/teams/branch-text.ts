import type { Branch } from "./found";

/** What approving a request would do, in the words the requester and the site admin both read. */
export function branchText(branch: Branch, name: string): string {
  switch (branch) {
    case "new-language":
      return "A new language";
    case "hand-over":
      return `Nobody looks after ${name} yet; your team takes it over`;
    case "second-team":
      return `${name} has a team already; a second team is not possible yet`;
  }
}
