"use client";

import { useEffect, useRef } from "react";

function fmt(v, decimals, signed, suffix) {
  return `${signed && v >= 0 ? "+" : ""}${v.toFixed(decimals)}${suffix}`;
}

// Count-up for the hero delta numbers. The final script-generated value is in
// the static markup (SEO and no-JS correct); JS only animates the display.
// Screen readers get the real value via the sr-only span; the animated copy is
// aria-hidden. Skipped entirely under prefers-reduced-motion.
export default function CountUp({ value, decimals = 1, signed = true, suffix = "%", duration = 1100 }) {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf;
    const t0 = performance.now();
    const tick = (t) => {
      const p = Math.min((t - t0) / duration, 1);
      const eased = p === 1 ? 1 : 1 - Math.pow(2, -10 * p);
      el.textContent = fmt(value * eased, decimals, signed, suffix);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, decimals, signed, suffix, duration]);

  const finalText = fmt(value, decimals, signed, suffix);
  return (
    <>
      <span className="sr-only">{finalText}</span>
      <span aria-hidden="true" ref={ref} style={{ fontVariantNumeric: "tabular-nums" }}>
        {finalText}
      </span>
    </>
  );
}
