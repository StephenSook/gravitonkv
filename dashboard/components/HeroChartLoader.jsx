"use client";

import dynamic from "next/dynamic";

// Recharts touches browser APIs; load it client-side only. The static export
// ships the data inline, so there is no fetch waterfall.
const HeroDeltaChart = dynamic(() => import("./HeroDeltaChart"), {
  ssr: false,
  loading: () => (
    <div className="skel" style={{ height: 340 }} role="status" aria-label="loading chart" />
  ),
});

export default function HeroChartLoader({ hero }) {
  return <HeroDeltaChart hero={hero} />;
}
