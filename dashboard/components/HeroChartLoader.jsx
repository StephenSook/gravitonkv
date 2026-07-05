"use client";

import dynamic from "next/dynamic";

// Recharts touches browser APIs; load it client-side only. The static export
// ships the data inline, so there is no fetch waterfall.
const HeroDeltaChart = dynamic(() => import("./HeroDeltaChart"), {
  ssr: false,
  loading: () => (
    <div style={{ height: 340, display: "flex", alignItems: "center", justifyContent: "center", color: "#8a897f", fontSize: 13 }}>
      loading chart
    </div>
  ),
});

export default function HeroChartLoader({ hero }) {
  return <HeroDeltaChart hero={hero} />;
}
