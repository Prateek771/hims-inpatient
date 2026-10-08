import { redirect } from "next/navigation";
import { requireAdmin } from "@/server/access";
import { DomainError } from "@/server/contracts";
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  try {
    await requireAdmin();
  } catch (e) {
    if (e instanceof DomainError) redirect("/workspace");
    throw e;
  }
  return children;
}
