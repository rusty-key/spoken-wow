import type { Metadata } from "next";

import ResetPasswordForm from "@/components/ResetPasswordForm";
import { Contained } from "@/components/Width";

export const metadata: Metadata = {
  title: "Choose a new password · Spoken",
  // The address holds the reset token, which must not reach another site as a Referer.
  referrer: "no-referrer",
};

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const { token } = await searchParams;
  return (
    <main className="pt-6 pb-36">
      <Contained>
        <ResetPasswordForm token={typeof token === "string" && token ? token : null} />
      </Contained>
    </main>
  );
}
