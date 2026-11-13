import type { Metadata } from "next";

import AuthForm from "@/components/AuthForm";
import { Contained } from "@/components/Width";

export const metadata: Metadata = { title: "Register · Spoken" };

export default function Page() {
  return (
    <main className="pt-6 pb-36">
      <Contained>
        <AuthForm mode="register" />
      </Contained>
    </main>
  );
}
