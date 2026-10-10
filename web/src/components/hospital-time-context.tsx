"use client";
import { createContext, useContext, type ReactNode } from "react";
const HospitalTimezone = createContext("Asia/Kolkata");
export function HospitalTimeProvider({ timezone, children }: { timezone: string; children: ReactNode }) { return <HospitalTimezone value={timezone}>{children}</HospitalTimezone>; }
export function useHospitalTimezone() { return useContext(HospitalTimezone); }
