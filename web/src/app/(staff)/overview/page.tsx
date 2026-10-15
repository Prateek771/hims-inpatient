import { MvpWorkspace, type MvpFilters } from "@/components/mvp-workspace";
import LegacyOverview from "@/components/legacy-overview";
import { requireStaff } from "@/server/access";
import { notFound } from "next/navigation";
export default async function Overview({ searchParams }: { searchParams: Promise<MvpFilters & { legacy?: string; bedCategory?: string }> }) {
  if ((await requireStaff()).role !== "ADMIN") notFound();
  const params = await searchParams;
  if (params.legacy === "1") return <LegacyOverview searchParams={Promise.resolve(params)} />;
  return <MvpWorkspace filters={params} />;
}
