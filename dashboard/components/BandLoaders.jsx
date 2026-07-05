"use client";

import dynamic from "next/dynamic";

const loading = () => (
  <div style={{ height: 240, display: "flex", alignItems: "center", justifyContent: "center", color: "#8a897f", fontSize: 13 }}>
    loading
  </div>
);

export const ParetoBand = dynamic(() => import("./ParetoBand"), { ssr: false, loading });
export const ScalingBand = dynamic(() => import("./ScalingBand"), { ssr: false, loading });
export const ExplorerBand = dynamic(() => import("./ExplorerBand"), { ssr: false, loading });
