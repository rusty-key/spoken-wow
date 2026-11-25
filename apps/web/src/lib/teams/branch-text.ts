import { langName } from "@/lib/lang";

import type { TeamRequest } from "./requests";

/** What the email and the page call a request's language: the name the request carried, else the registry's. */
export function requestLangName(request: Pick<TeamRequest, "lang" | "langName">): string {
  return request.langName ?? langName(request.lang);
}
