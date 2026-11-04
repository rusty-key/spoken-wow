import type { Metadata } from "next";

import ForgotPasswordForm from "@/components/ForgotPasswordForm";
import { Contained } from "@/components/Width";

export const metadata: Metadata = { title: "Reset your password · Spoken" };

export default function Page() {
  return (
    <main className="pt-6 pb-36">
      <Contained>
        <ForgotPasswordForm />
      </Contained>
    </main>
  );
}
