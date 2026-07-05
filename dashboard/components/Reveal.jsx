"use client";

import { useEffect, useRef, useState } from "react";

// Scroll-reveal wrapper: adds .in when the section enters the viewport.
// CSS handles the motion and disables it under prefers-reduced-motion.
export default function Reveal({ children }) {
  const ref = useRef(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setInView(true);
          obs.disconnect();
        }
      },
      { rootMargin: "0px 0px -60px 0px", threshold: 0.08 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return (
    <div ref={ref} className={`reveal${inView ? " in" : ""}`}>
      {children}
    </div>
  );
}
