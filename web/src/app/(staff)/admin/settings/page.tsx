import { headers } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { listSettings } from "@/server/settings";
import { DomainError } from "@/server/contracts";
import { SettingsForms } from "@/components/settings-forms";
export default async function SettingsPage() {
  let settings;
  try {
    settings = await listSettings(await headers());
  } catch (error) {
    if (error instanceof DomainError)
      redirect(error.code === "UNAUTHORIZED" ? "/login" : "/workspace");
    throw error;
  }
  return (
    <>
      <Link href="/workspace">Back to workspace</Link>
      <p className="eyebrow">Hospital administration</p>
      <h1>Hospital settings</h1>
      <p className="page-description">
        Changes create a new version. Existing stays will retain the policy
        version assigned to them.
      </p>
      <SettingsForms {...settings} />
    </>
  );
}
