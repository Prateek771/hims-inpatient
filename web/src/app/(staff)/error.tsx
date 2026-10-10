"use client";
import Link from "next/link";
export default function StaffError({ reset }: { reset: () => void }) { return <section className="notice" role="alert"><h1>Current records are unavailable</h1><p>This view could not load. Counts and financial totals are unavailable until the records can be checked.</p><button className="button" onClick={reset}>Retry current records</button><Link className="button secondary" href="/workspace">Return to my workspace</Link></section>; }
