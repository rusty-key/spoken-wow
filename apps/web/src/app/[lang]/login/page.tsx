import type { Metadata } from "next";

import AuthForm from "@/components/AuthForm";
import { Contained } from "@/components/Width";

export const metadata: Metadata = { title: "Sign in · Spoken" };

export default async function Page({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const { next } = await searchParams;
  return (
    <main className="pt-6 pb-36">
      <Contained>
        <AuthForm mode="login" next={typeof next === "string" ? next : null} />
      </Contained>
    </main>
  );
}
