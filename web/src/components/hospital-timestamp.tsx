"use client";
import { useHospitalTimezone } from "./hospital-time-context";
import { formatHospitalTime } from "@/lib/hospital-time";
export function HospitalTimestamp({ value }: { value: string | undefined }) {
  const timezone = useHospitalTimezone();
  return value ? <time dateTime={value} title={value}>{formatHospitalTime(value, timezone)}</time> : <span>Not recorded</span>;
}
