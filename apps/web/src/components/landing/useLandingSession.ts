import { useEffect, useState } from "react";

import { useSession } from "@/lib/auth-client";

/**
 * The browser's session, reported as pending until the page has mounted. The session request can
 * settle before hydration finishes, and a first client render that already knows the answer
 * would not match the server's HTML.
 */
export function useLandingSession() {
  const { data, isPending } = useSession();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return { session: mounted ? data : null, pending: !mounted || isPending };
}
