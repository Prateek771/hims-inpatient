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
      <Link href="/workspace">Back to workspace</Link>
      <p className="eyebrow">Hospital administration</p>
      <h1>Staff accounts</h1>
      <p className="page-description">
        Create hospital accounts and keep access current. Roles do not grant
        another profession’s clearance authority.
      </p>
      <StaffForms staff={staff} />
    </>
  );
}
