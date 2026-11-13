import type { Metadata } from "next";
import Link from "next/link";

import InviteAccept, { InviteJoined } from "@/components/InviteAccept";
import { Contained } from "@/components/Width";
import { currentInvite } from "@/lib/invites/cookie";
import { isLang, langName, localeHref } from "@/lib/lang";
import { capabilityLabel } from "@/lib/permissions";
import { currentSession } from "@/lib/session";

export const metadata: Metadata = {
  title: "Invitation · Spoken",
};

export const dynamic = "force-dynamic";

const ADVICE = "Ask whoever invited you to send it again.";

export default async function Page() {
  const invite = await currentInvite();
  const session = invite?.state === "pending" || invite?.state === "accepted" ? await currentSession() : null;

  let body: React.ReactNode;
  if (!invite || !isLang(invite.lang)) {
    body = <p>This invite link is not valid any more. {ADVICE}</p>;
  } else if (invite.state === "expired") {
    body = <p>This invite has expired. {ADVICE}</p>;
  } else if (invite.state === "revoked") {
    body = <p>This invite was withdrawn. {ADVICE}</p>;
  } else if (invite.state === "accepted" && invite.acceptedBy === session?.user.id) {
    // Refreshed after pressing Accept: the person who did it still sees that it worked.
    body = <InviteJoined lang={invite.lang} />;
  } else if (invite.state === "accepted") {
    body = (
      <p>
        This invite has been used.{" "}
        <Link href={localeHref(invite.lang, "/")} className="underline underline-offset-4">
          Go to {langName(invite.lang)}
        </Link>
      </p>
    );
  } else {
    body = (
      <>
        <p>
          {invite.inviterName ?? "Somebody"} invited you to work on {langName(invite.lang)} as{" "}
          {invite.capabilities.map(capabilityLabel).join(", ")}.
        </p>
        <InviteAccept
          email={invite.email}
          lang={invite.lang}
          signedInAs={session?.user.email ?? null}
        />
      </>
    );
  }
  return (
    <main className="pt-6 pb-36">
      <Contained>
        <h1 className="mb-4 text-xl font-semibold">Invitation</h1>
        {body}
      </Contained>
    </main>
  );
}
