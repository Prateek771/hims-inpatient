import { redirect } from "next/navigation";
import { requireStaff } from "@/server/access";
import { DomainError } from "@/server/contracts";
import { roleHome } from "@/components/role-navigation";

export default async function Home() {
  let staff;
  try { staff = await requireStaff(); }
  catch (error) {
    if (error instanceof DomainError) redirect("/login");
    throw error;
  }
  redirect(roleHome(staff.role));
}
