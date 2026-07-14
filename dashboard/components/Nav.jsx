"use client";

import { useEffect, useRef, useState } from "react";

const SECTIONS = [
  { id: "tradeoff", label: "01 tradeoff" },
  { id: "scaling", label: "02 scaling" },
  { id: "cost", label: "03 cost" },
  { id: "quality", label: "04 quality" },
  { id: "cells", label: "05 cells" },
  { id: "methodology", label: "06 methodology" },
];

// Fixed nav with a scrollspy (IntersectionObserver band around the viewport
// center) and a 1px scroll-progress hairline. Progress writes straight to the
// DOM inside rAF so scrolling never re-renders React.
export default function Nav({ statusText }) {
  const [active, setActive] = useState(null);
  const barRef = useRef(null);

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setActive(e.target.id);
      },
      { rootMargin: "-40% 0px -55% 0px" }
    );
    for (const { id } of SECTIONS) {
      const el = document.getElementById(id);
      if (el) obs.observe(el);
    }
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const doc = document.documentElement;
        const max = doc.scrollHeight - doc.clientHeight;
        const p = max > 0 ? Math.min(doc.scrollTop / max, 1) : 0;
        if (barRef.current) barRef.current.style.transform = `scaleX(${p})`;
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => {
      obs.disconnect();
      window.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <nav className="nav">
      <span className="wordmark">
        GRAVITON<b>KV</b>
      </span>
      <div className="links">
        {SECTIONS.map(({ id, label }) => (
          <a key={id} href={`#${id}`} className={active === id ? "active" : undefined}>
            {label}
          </a>
        ))}
      </div>
      <span className="spacer" />
      <span className="chip">
        <span className="dot" />
        {statusText}
      </span>
      <span ref={barRef} className="nav-progress" aria-hidden="true" />
    </nav>
  );
}
