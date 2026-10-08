import { redirect } from "next/navigation";
import { requireStaff } from "@/server/access";
import { DomainError } from "@/server/contracts";
import { AppShell } from "@/components/app-shell";
export default async function StaffLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  try {
    await requireStaff();
  } catch (e) {
    if (e instanceof DomainError) redirect("/login");
    throw e;
  }
  return <AppShell>{children}</AppShell>;
}
