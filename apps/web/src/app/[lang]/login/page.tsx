import type { Metadata } from "next";

import AuthForm from "@/components/AuthForm";
import { Contained } from "@/components/Width";
import { lookupInvite } from "@/lib/invites/store";

export const metadata: Metadata = { title: "Sign in · Spoken", referrer: "no-referrer" };

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<{ invite?: string | string[] }> }) {
  const { invite: token } = await searchParams;
  const found = typeof token === "string" && token ? await lookupInvite(token) : null;
  const invite = found?.state === "pending" ? { token: token as string, email: found.email } : undefined;
  return (
    <main className="pt-6 pb-36">
      <Contained>
        <AuthForm mode="login" invite={invite} />
      </Contained>
    </main>
  );
}
