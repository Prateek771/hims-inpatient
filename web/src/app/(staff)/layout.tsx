import { redirect } from "next/navigation";
import { requireStaff } from "@/server/access";
import { DomainError } from "@/server/contracts";
import { AppShell } from "@/components/app-shell";
import { db } from "@/server/db";
import { hospitalSettings } from "@/server/schema";
export default async function StaffLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let staff;
  try {
    staff = await requireStaff();
  } catch (e) {
    if (e instanceof DomainError) redirect("/login");
    throw e;
  }
  const [hospital] = await db
    .select({ name: hospitalSettings.name })
    .from(hospitalSettings)
    .limit(1);
  return (
    <AppShell role={staff.role} hospitalName={hospital?.name}>
      {children}
    </AppShell>
  );
}
