import { headers } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { listStaff } from "@/server/staff";
import { DomainError } from "@/server/contracts";
import { StaffForms } from "@/components/staff-forms";
export default async function StaffPage() {
  let staff;
  try {
    staff = await listStaff(await headers());
  } catch (error) {
    if (error instanceof DomainError)
      redirect(error.code === "UNAUTHORIZED" ? "/login" : "/workspace");
    throw error;
  }
  return (
    <>
      <Link href="/overview">Back to Home</Link>
      <h1>Staff</h1>
      <p className="page-description">
        Managed identities, professional roles and current access.
      </p>
      <div className="admin-staff-forms"><StaffForms staff={staff} /></div>
      <section className="notice"><h2>Current access and sessions</h2><p>Disabling an account, changing its role or resetting its password revokes existing sessions. The last active Administrator remains protected. Roles do not grant another profession’s clearance authority.</p></section>
    </>
  );
}
