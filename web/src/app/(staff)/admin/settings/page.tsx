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
      <Link href="/overview">Back to Home</Link>
      <h1>Settings</h1>
      <p className="page-description">
        Hospital configuration with attributable reasons and retained versions.
        Existing stays retain their assigned policy version.
      </p>
      <SettingsForms {...settings} />
    </>
  );
}
