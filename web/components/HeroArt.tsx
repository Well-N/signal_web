"use client";

import Image from "next/image";
import { useEffect, useRef } from "react";

export function HeroArt() {
  const plateRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const plate = plateRef.current;
    if (!plate) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let frame = 0;

    function update() {
      frame = 0;
      if (!plate) return;
      const offset = Math.min(window.scrollY * 0.32, 240);
      plate.style.transform = "translate3d(0, " + offset + "px, 0)";
    }

    function onScroll() {
      if (!frame) frame = window.requestAnimationFrame(update);
    }

    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div className="hero__art" aria-hidden="true">
      <div className="hero__plate" ref={plateRef}>
        <Image
          className="hero__figure hero__figure--portrait"
          src="/hero-figure-blue.png"
          alt=""
          width={1024}
          height={1536}
          unoptimized
          priority
        />
      </div>
    </div>
  );
}

