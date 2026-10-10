import { notFound } from "next/navigation";
import { requireStaff } from "@/server/access";
export default async function OverviewLayout({ children }: { children: React.ReactNode }) {
  if ((await requireStaff()).role !== "ADMIN") notFound();
  return children;
}
