"use client";

import dynamic from "next/dynamic";

const loading = () => (
  <div className="skel" style={{ height: 240 }} role="status" aria-label="loading" />
);

export const ParetoBand = dynamic(() => import("./ParetoBand"), { ssr: false, loading });
export const ScalingBand = dynamic(() => import("./ScalingBand"), { ssr: false, loading });
export const CostBand = dynamic(() => import("./CostBand"), { ssr: false, loading });
export const QualityBand = dynamic(() => import("./QualityBand"), { ssr: false, loading });
export const ExplorerBand = dynamic(() => import("./ExplorerBand"), { ssr: false, loading });
