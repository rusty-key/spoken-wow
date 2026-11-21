"use client";

import Link from "@/components/LocaleLink";
import { BACKSTAGE_HREF } from "./backstage";
import { useSiteText } from "./SiteTextProvider";
import { useLandingSession } from "./useLandingSession";

/** The top bar's sign-in button, or the way into Backstage once there is a session. */
export default function NavSession() {
  const t = useSiteText();
  const { session, pending } = useLandingSession();
  if (pending) {
    return (
      <span className="bn-btn bn-btn-sm" aria-hidden="true" style={{ visibility: "hidden" }}>
        {t.nav.backstage}
      </span>
    );
  }
  return session ? (
    <Link className="bn-btn bn-btn-primary bn-btn-sm" href={BACKSTAGE_HREF}>
      {t.nav.backstage}
    </Link>
  ) : (
    <a className="bn-btn bn-btn-primary bn-btn-sm" href="#backstage">
      {t.nav.signIn}
    </a>
  );
}
