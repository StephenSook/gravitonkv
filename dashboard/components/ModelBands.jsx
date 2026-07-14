"use client";

import { useState } from "react";
import Reveal from "./Reveal";
import { ParetoBand, ScalingBand, CostBand, QualityBand, ExplorerBand } from "./BandLoaders";

const BANDS = [
  { id: "tradeoff", no: "01", kicker: "the tradeoff surface", title: "Which config should you run?", Comp: ParetoBand },
  { id: "scaling", no: "02", kicker: "context scaling", title: "How the trade moves with context length", Comp: ScalingBand },
  { id: "cost", no: "03", kicker: "cost economics", title: "The tradeoff, in dollars per million tokens", Comp: CostBand },
  { id: "quality", no: "04", kicker: "quality cliffs", title: "Where quantization breaks retrieval", Comp: QualityBand },
  { id: "cells", no: "05", kicker: "cell explorer", title: "Every cell, down to the raw reps", Comp: ExplorerBand },
];

// Short display label for a model name, e.g. "Qwen3-4B-Instruct-2507" -> "Qwen3-4B".
function label(model) {
  const m = model.match(/^([A-Za-z]+[\d.]*-[\d.]+B)/);
  return m ? m[1] : model;
}

// Owns the selected-model state and renders the three data bands scoped to it.
// The picker only appears once more than one model has landed; with a single
// model the page reads exactly as before. Each band is keyed by model so its
// internal state (selected context, open row) resets cleanly on a switch.
export default function ModelBands({ cells, models, flagship }) {
  const [model, setModel] = useState(flagship || models[0]);
  const filtered = cells.filter((c) => c.model === model);

  return (
    <>
      {models.length > 1 && (
        <div className="model-picker">
          <span className="model-picker-label">model</span>
          {models.map((m) => (
            <button
              key={m}
              className={`ctx-btn${m === model ? " active" : ""}`}
              onClick={() => setModel(m)}
              aria-pressed={m === model}
            >
              {label(m)}
            </button>
          ))}
        </div>
      )}
      {BANDS.map(({ id, no, kicker, title, Comp }) => (
        <section id={id} key={id}>
          <Reveal>
            <div className="band-head">
              <span className="band-no">{no}</span>
              <span className="band-kicker">{kicker}</span>
            </div>
            <h2>{title}</h2>
            <div className="chart-card">
              <Comp key={model} cells={filtered} />
            </div>
          </Reveal>
        </section>
      ))}
    </>
  );
}
