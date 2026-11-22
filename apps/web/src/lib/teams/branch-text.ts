import { langName } from "@/lib/lang";

import type { Branch } from "./found";
import type { TeamRequest } from "./requests";

/** What the email and the page call a request's language: the name the request carried, else the registry's. */
export function requestLangName(request: Pick<TeamRequest, "lang" | "langName">): string {
  return request.langName ?? langName(request.lang);
}

/** What approving a request would do, in the words the requester and the site admin both read. */
export function branchText(branch: Branch, name: string): string {
  switch (branch) {
    case "new-language":
      return "A new language";
    case "add-team":
      return `Your team joins ${name}, beside any team it has`;
  }
}
