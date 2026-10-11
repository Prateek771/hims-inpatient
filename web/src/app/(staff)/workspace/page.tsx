import { redirect } from "next/navigation";
import { requireStaff } from "@/server/access";
import { roleHome } from "@/components/role-navigation";

export default async function Workspace() {
  const staff = await requireStaff();
  redirect(roleHome(staff.role));
}
