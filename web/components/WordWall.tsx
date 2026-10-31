"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";

export type WallCloudWord = { text: string; weight: number; count?: number };

type PlacedWord = {
  text: string;
  x: number;
  y: number;
  size: number;
  rotation: 0 | 90;
  color: string;
  opacity: number;
  fontWeight: number;
  hoverScale: number;
};

type WordStyle = CSSProperties & {
  "--rot": string;
  "--hover-scale": number;
  "--word-color": string;
};

const FONT_STACK = '"IBM Plex Sans", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif';
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const MARGIN = 30;

function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function fontFor(size: number, weight: number) {
  return `${weight} ${size.toFixed(2)}px ${FONT_STACK}`;
}

function computeLayout(
  words: WallCloudWord[],
  width: number,
  height: number,
  ctx: CanvasRenderingContext2D,
): PlacedWord[] {
  if (!words.length) return [];
  const list = [...words].sort((a, b) => b.weight - a.weight);
  const usableW = Math.max(1, width - MARGIN * 2);
  const usableH = Math.max(1, height - MARGIN * 2);
  const maxWeight = list[0]?.weight || 1;
  const maxLog = Math.log(maxWeight + 1);
  const maxSize = Math.min(64, Math.max(36, width * 0.034));
  const minSize = 4.6;
  const sizes = list.map((word) => {
    const share = Math.log(word.weight + 1) / maxLog;
    return minSize + Math.pow(share, 2.7) * (maxSize - minSize);
  });

  let estimate = 0;
  sizes.forEach((size, index) => {
    const weight = size < 8 ? 450 : size < 16 ? 500 : 600;
    ctx.font = fontFor(size, weight);
    const textWidth = ctx.measureText(list[index].text).width;
    estimate += Math.max(textWidth, size) * size * 1.08;
  });
  const target = usableW * usableH * 0.52;
  const scale = Math.min(1.18, Math.max(0.52, Math.sqrt(target / Math.max(estimate, 1))));
  for (let index = 0; index < sizes.length; index += 1) {
    sizes[index] = Math.min(72, Math.max(3.6, sizes[index] * scale));
  }

  const cell = 2;
  const cols = Math.max(1, Math.ceil(width / cell));
  const rows = Math.max(1, Math.ceil(height / cell));
  const occupied = new Uint8Array(cols * rows);

  function gridFree(x: number, y: number, w: number, h: number) {
    const x0 = Math.max(0, Math.floor(x / cell));
    const x1 = Math.min(cols - 1, Math.floor((x + w) / cell));
    const y0 = Math.max(0, Math.floor(y / cell));
    const y1 = Math.min(rows - 1, Math.floor((y + h) / cell));
    for (let gy = y0; gy <= y1; gy += 1) {
      const row = gy * cols;
      for (let gx = x0; gx <= x1; gx += 1) {
        if (occupied[row + gx]) return false;
      }
    }
    return true;
  }

  function mark(x: number, y: number, w: number, h: number) {
    const x0 = Math.max(0, Math.floor(x / cell));
    const x1 = Math.min(cols - 1, Math.floor((x + w) / cell));
    const y0 = Math.max(0, Math.floor(y / cell));
    const y1 = Math.min(rows - 1, Math.floor((y + h) / cell));
    for (let gy = y0; gy <= y1; gy += 1) {
      const row = gy * cols;
      for (let gx = x0; gx <= x1; gx += 1) {
        occupied[row + gx] = 1;
      }
    }
  }

  const random = seededRandom(0x8f31a2 + list.length + Math.round(width * 7 + height * 3));
  const anchors: { x: number; y: number }[] = [];
  const anchorStep = 17;
  for (let y = MARGIN; y < height - MARGIN; y += anchorStep) {
    for (let x = MARGIN; x < width - MARGIN; x += anchorStep) {
      anchors.push({
        x: x + (random() - 0.5) * 12,
        y: y + (random() - 0.5) * 12,
      });
    }
  }

  const macro: { x: number; y: number }[] = [];
  const macroCols = 4;
  const macroRows = 3;
  for (let row = 0; row < macroRows; row += 1) {
    for (let col = 0; col < macroCols; col += 1) {
      macro.push({
        x: MARGIN + ((col + 0.5) / macroCols) * usableW + (random() - 0.5) * usableW * 0.08,
        y: MARGIN + ((row + 0.5) / macroRows) * usableH + (random() - 0.5) * usableH * 0.08,
      });
    }
  }

  function attempt(
    text: string,
    size: number,
    rotation: 0 | 90,
    startX: number,
    startY: number,
    steps: number,
    weight: number,
  ) {
    ctx.font = fontFor(size, weight);
    const textWidth = ctx.measureText(text).width;
    const textHeight = size * 1.02;
    const boxW = rotation ? textHeight : textWidth;
    const boxH = rotation ? textWidth : textHeight;
    const pad = 0.35;
    for (let index = 0; index < steps; index += 1) {
      const radius = 1.65 * Math.sqrt(index);
      const angle = index * GOLDEN_ANGLE + size * 0.37;
      const cx = startX + Math.cos(angle) * radius;
      const cy = startY + Math.sin(angle) * radius;
      const x = cx - boxW / 2 - pad;
      const y = cy - boxH / 2 - pad;
      const w = boxW + pad * 2;
      const h = boxH + pad * 2;
      if (x < MARGIN || y < MARGIN || x + w > width - MARGIN || y + h > height - MARGIN) {
        continue;
      }
      if (!gridFree(x, y, w, h)) continue;
      return { x, y, w, h, cx, cy };
    }
    return null;
  }

  const placed: PlacedWord[] = [];
  list.forEach((word, index) => {
    const share = Math.log(word.weight + 1) / maxLog;
    const longEnglish = /^[A-Za-z][A-Za-z0-9.+#-]{6,}$/.test(word.text);
    let size = sizes[index];
    let rotation: 0 | 90 =
      index >= 12 && size < maxSize * 0.72 && (index % 11 === 0 || (longEnglish && index % 5 === 0))
        ? 90
        : 0;
    let spot: ReturnType<typeof attempt> = null;
    for (let shrink = 0; shrink < 3 && !spot; shrink += 1) {
      const weight = size < 8 ? 450 : size < 16 ? 500 : 600;
      const steps = size > maxSize * 0.4 ? 2400 : 1200;
      for (let retry = 0; retry < 3 && !spot; retry += 1) {
        const start =
          index < 12 && retry === 0
            ? macro[index % macro.length]
            : anchors[Math.floor(random() * anchors.length)];
        spot = attempt(word.text, size, rotation, start.x, start.y, steps, weight);
      }
      if (!spot) {
        size *= 0.87;
        if (size < 6) rotation = 0;
      }
    }
    if (!spot) return;
    mark(spot.x, spot.y, spot.w, spot.h);
    const fontWeight = size < 8 ? 450 : size < 16 ? 500 : 600;
    placed.push({
      text: word.text,
      x: spot.cx,
      y: spot.cy,
      size,
      rotation,
      color: share > 0.52 ? "var(--paper)" : "var(--mist)",
      opacity: 0.62 + share * 0.38,
      fontWeight,
      hoverScale:
        size < 6 ? 2.2 : size < 9 ? 2.0 : size < 14 ? 1.7 : size < 22 ? 1.45 : 1.25,
    });
  });
  return placed;
}

export function WordWall({ words }: { words: WallCloudWord[] }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [placed, setPlaced] = useState<PlacedWord[]>([]);
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const measure = document.createElement("canvas");
    const ctx = measure.getContext("2d");
    if (!ctx) return;
    let disposed = false;
    let frame = 0;

    const layout = () => {
      if (disposed) return;
      const width = host.clientWidth;
      const height = host.clientHeight;
      if (width < 200 || height < 160) return;
      const result = computeLayout(words, width, height, ctx);
      setPlaced(result);
      setBusy(false);
    };

    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(layout);
    };

    const observer = new ResizeObserver(schedule);
    observer.observe(host);
    schedule();
    document.fonts?.ready.then(schedule);
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [words]);

  return (
    <div
      ref={hostRef}
      className="word-wall"
      role="img"
      aria-label={`词墙，共 ${words.length} 个词，鼠标悬停可放大`}
    >
      {busy ? <div className="word-wall__loading">正在排布词云</div> : null}
      {placed.map((word, index) => {
        const style: WordStyle = {
          left: `${word.x}px`,
          top: `${word.y}px`,
          fontSize: `${word.size}px`,
          fontWeight: word.fontWeight,
          opacity: word.opacity,
          "--rot": `${word.rotation}deg`,
          "--hover-scale": word.hoverScale,
          "--word-color": word.color,
        };
        return (
          <span key={`${word.text}-${index}`} className="wall-word" style={style}>
            {word.text}
          </span>
        );
      })}
    </div>
  );
}
