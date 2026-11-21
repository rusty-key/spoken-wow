import type { Metadata } from "next";

import AuthForm from "@/components/AuthForm";
import { Contained } from "@/components/Width";
import { currentInvite } from "@/lib/invites/cookie";

export const metadata: Metadata = { title: "Register · Spoken" };

export const dynamic = "force-dynamic";

export default async function Page() {
  const found = await currentInvite();
  const invite = found?.state === "pending" ? { email: found.email } : undefined;
  return (
    <main className="pt-6 pb-36">
      <Contained>
        <AuthForm mode="register" invite={invite} />
      </Contained>
    </main>
  );
}
