"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";

import { useSession } from "@/lib/auth-client";
import type { Grant } from "@/lib/permissions";

/**
 * What the signed-in person holds in each language, asked for once per page.
 *
 * The header's menu and the explorer below it both need it, and each asking on its own was
 * the same request twice on every page a translator opened. Empty for a visitor, who costs
 * no request at all. The server checks again on every write: this only decides what to draw.
 *
 * The same answer carries a site admin's count of pack submissions waiting for review. The
 * review page sets it after each decision, so the header's badge does not go on counting a
 * submission that was just decided.
 */
type Mine = {
  grants: readonly Grant[];
  pendingPacks: number;
  setPendingPacks: (count: number) => void;
};

const GrantsContext = createContext<Mine>({ grants: [], pendingPacks: 0, setPendingPacks: () => {} });

export function GrantsProvider({ children }: { children: React.ReactNode }) {
  const { data: session } = useSession();
  const userId = session?.user.id ?? null;
  const [grants, setGrants] = useState<Grant[]>([]);
  const [pendingPacks, setPendingPacks] = useState(0);

  useEffect(() => {
    if (!userId) {
      setGrants([]);
      setPendingPacks(0);
      return;
    }
    let live = true;
    fetch("/api/grants/mine")
      .then((response) => (response.ok ? response.json() : { grants: [] }))
      .then((body: { grants: Grant[]; pendingPacks?: number }) => {
        if (!live) return;
        setGrants(body.grants);
        setPendingPacks(body.pendingPacks ?? 0);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [userId]);

  const value = useMemo(() => ({ grants, pendingPacks, setPendingPacks }), [grants, pendingPacks]);
  return <GrantsContext.Provider value={value}>{children}</GrantsContext.Provider>;
}

export function useGrants(): readonly Grant[] {
  return useContext(GrantsContext).grants;
}

/** Pack submissions waiting for review; always 0 for anybody but a site admin. */
export function usePendingPacks(): [number, (count: number) => void] {
  const { pendingPacks, setPendingPacks } = useContext(GrantsContext);
  return [pendingPacks, setPendingPacks];
}
