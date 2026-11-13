import type { Metadata } from "next";
import { cookies } from "next/headers";

import AuthForm from "@/components/AuthForm";
import { Contained } from "@/components/Width";
import { INVITE_COOKIE } from "@/lib/invites/cookie";
import { lookupInvite } from "@/lib/invites/store";

export const metadata: Metadata = { title: "Register · Spoken" };

export const dynamic = "force-dynamic";

export default async function Page() {
  const token = (await cookies()).get(INVITE_COOKIE)?.value;
  const found = token ? await lookupInvite(token) : null;
  const invite = found?.state === "pending" ? { email: found.email } : undefined;
  return (
    <main className="pt-6 pb-36">
      <Contained>
        <AuthForm mode="register" invite={invite} />
      </Contained>
    </main>
  );
}
