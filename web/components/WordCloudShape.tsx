"use client";

import { useEffect, useRef } from "react";

export type CloudWord = { text: string; weight: number; count?: number };

type Point = { x: number; y: number; tone: number };
type Placed = { x: number; y: number; w: number; h: number; size: number; angle: number };

const FONT_STACK = '"IBM Plex Sans", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif';
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const SHAPE_VERSION = "20261028f";

function token(name: string, element: Element) {
  return getComputedStyle(element).getPropertyValue(name).trim();
}

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

function loadImage(source: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`无法加载 ${source}`));
    image.src = source;
  });
}

export function WordCloudShape({ words }: { words: CloudWord[] }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const element = canvasRef.current;
    if (!element) return;
    const canvas: HTMLCanvasElement = element;
    const context = canvas.getContext("2d");
    if (!context) return;
    const ctx = context;

    let maskData: Uint8ClampedArray | null = null;
    let maskW = 0;
    let maskH = 0;
    let toneData: Uint8ClampedArray | null = null;
    let toneW = 0;
    let toneH = 0;
    let toneImage: HTMLImageElement | null = null;
    let outline: HTMLImageElement | null = null;
    let disposed = false;
    let frame = 0;

    function sampleMask(x: number, y: number) {
      if (!maskData || !maskW || !maskH) return false;
      const mx = Math.max(0, Math.min(maskW - 1, Math.round(x * (maskW - 1))));
      const my = Math.max(0, Math.min(maskH - 1, Math.round(y * (maskH - 1))));
      return maskData[(my * maskW + mx) * 4] > 80;
    }

    function sampleTone(x: number, y: number) {
      if (!toneData || !toneW || !toneH) return -1;
      const mx = Math.max(0, Math.min(toneW - 1, Math.round(x * (toneW - 1))));
      const my = Math.max(0, Math.min(toneH - 1, Math.round(y * (toneH - 1))));
      const offset = (my * toneW + mx) * 4;
      if (toneData[offset + 3] < 80) return -1;
      return toneData[offset] / 255;
    }

    function draw() {
      if (disposed) return;
      const rect = canvas.getBoundingClientRect();
      const width = Math.max(rect.width, 1);
      const height = Math.max(rect.height, 1);
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, width, height);
      if (!maskData || !words.length) return;

      const ink = token("--paper", canvas) || "#fbfbf6";
      const mist = token("--mist", canvas) || "#dbe4ff";
      const random = seededRandom(0x51a1c0de + words.length);
      const list = [...words].sort((a, b) => b.weight - a.weight);
      const maxWeight = list[0]?.weight || 1;
      const maxLog = Math.log(maxWeight + 1);
      const minSize = Math.max(1.8, width * 0.00292);
      const maxSize = Math.max(14, width * 0.0298);
      const cell = 1;
      const cols = Math.max(1, Math.ceil(width / cell));
      const rows = Math.max(1, Math.ceil(height / cell));
      const occupied = new Uint8Array(cols * rows);
      let placedCount = 0;

      if (toneImage) {
        ctx.save();
        ctx.globalAlpha = 0.26;
        ctx.drawImage(toneImage, 0, 0, width, height);
        ctx.restore();
      }

      function inside(x: number, y: number, w: number, h: number) {
        if (x < 0 || y < 0 || x + w > width || y + h > height) return false;
        const xs = [x, x + w / 2, x + w];
        const ys = [y, y + h / 2, y + h];
        for (const py of ys) {
          for (const px of xs) {
            if (!sampleMask(px / width, py / height)) return false;
          }
        }
        return true;
      }

      function free(box: Placed) {
        const x0 = Math.max(0, Math.floor(box.x / cell));
        const x1 = Math.min(cols - 1, Math.floor((box.x + box.w) / cell));
        const y0 = Math.max(0, Math.floor(box.y / cell));
        const y1 = Math.min(rows - 1, Math.floor((box.y + box.h) / cell));
        for (let gy = y0; gy <= y1; gy += 1) {
          const row = gy * cols;
          for (let gx = x0; gx <= x1; gx += 1) {
            if (occupied[row + gx]) return false;
          }
        }
        return true;
      }

      function mark(box: Placed) {
        const x0 = Math.max(0, Math.floor(box.x / cell));
        const x1 = Math.min(cols - 1, Math.floor((box.x + box.w) / cell));
        const y0 = Math.max(0, Math.floor(box.y / cell));
        const y1 = Math.min(rows - 1, Math.floor((box.y + box.h) / cell));
        for (let gy = y0; gy <= y1; gy += 1) {
          const row = gy * cols;
          for (let gx = x0; gx <= x1; gx += 1) {
            occupied[row + gx] = 1;
          }
        }
      }

      const anchors: Point[] = [];
      const step = 7;
      for (let y = step; y < height - step; y += step) {
        for (let x = step; x < width - step; x += step) {
          const ax = x + (random() - 0.5) * 4.4;
          const ay = y + (random() - 0.5) * 4.4;
          const tone = sampleTone(ax / width, ay / height);
          if (sampleMask(ax / width, ay / height) && tone >= 0) {
            anchors.push({ x: ax, y: ay, tone });
          }
        }
      }
      const shadowStarts = anchors.filter((anchor) => anchor.tone < 0.45);
      const midStarts = anchors.filter(
        (anchor) => anchor.tone >= 0.45 && anchor.tone <= 0.68,
      );
      const lightStarts = anchors.filter((anchor) => anchor.tone > 0.68);

      const centerX = width / 2;
      const centerY = height * 0.475;

      function attempt(
        text: string,
        size: number,
        startX: number,
        startY: number,
        steps: number,
        rotated: boolean,
      ): Placed | null {
        ctx.font = `${size < 6 ? 500 : 600} ${size.toFixed(2)}px ${FONT_STACK}`;
        const textWidth = ctx.measureText(text).width;
        const textHeight = size * 1.04;
        const boxWidth = rotated ? textHeight : textWidth;
        const boxHeight = rotated ? textWidth : textHeight;
        const basePad = size < 5 ? 0.1 : 0.28;
        for (let index = 0; index < steps; index += 1) {
          const radius = 1.35 * Math.sqrt(index);
          const angle = index * GOLDEN_ANGLE + size;
          const centerX = startX + Math.cos(angle) * radius;
          const centerY = startY + Math.sin(angle) * radius;
          const tone = sampleTone(centerX / width, centerY / height);
          const pad = basePad + Math.max(0, tone) * 1.5;
          const x = centerX - boxWidth / 2;
          const y = centerY - boxHeight / 2;
          const box = {
            x: x - pad,
            y: y - pad,
            w: boxWidth + pad * 2,
            h: boxHeight + pad * 2,
            size,
            angle: rotated ? Math.PI / 2 : 0,
          };
          if (!inside(box.x, box.y, box.w, box.h)) continue;
          if (!free(box)) continue;
          return box;
        }
        return null;
      }

      list.forEach((word, index) => {
        const share = Math.log(word.weight + 1) / maxLog;
        let size = minSize + Math.pow(share, 3.2) * (maxSize - minSize);
        const prominent = index < 18;
        const sizeRatio = (size - minSize) / (maxSize - minSize);
        const preferRotated =
          !prominent && /[A-Za-z]/.test(word.text) && word.text.length >= 7;
        if (sizeRatio < 0.3) size *= 0.92;
        let spot: Placed | null = null;

        for (let tryIndex = 0; tryIndex < 8 && !spot; tryIndex += 1) {
          const rotated = preferRotated ? tryIndex < 2 : tryIndex >= 4;
          let pool = anchors;
          if (!prominent) {
            if (sizeRatio < 0.3) {
              if (tryIndex <= 4) pool = shadowStarts;
              else if (tryIndex === 5 && index % 7 === 0) pool = lightStarts;
              else if (tryIndex === 7) pool = anchors;
              else pool = midStarts;
            } else if (tryIndex <= 2 || tryIndex === 6) {
              pool = lightStarts;
            } else if (tryIndex <= 5) {
              pool = midStarts;
            }
          }
          if (!pool.length) pool = anchors;
          const start = prominent
            ? {
                x: centerX + (random() - 0.5) * width * (0.05 + tryIndex * 0.06),
                y: centerY + (random() - 0.5) * height * (0.04 + tryIndex * 0.04),
              }
            : pool[Math.floor(random() * pool.length)];
          if (!start) break;
          spot = attempt(
            word.text,
            size,
            start.x,
            start.y,
            prominent ? 2000 : 1500,
            rotated,
          );
          if (!spot) size = Math.max(0.95, size * 0.9);
        }

        if (!spot) return;
        mark(spot);
        placedCount += 1;

        ctx.font = `${spot.size < 6 ? 500 : 600} ${spot.size.toFixed(2)}px ${FONT_STACK}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const spotTone = sampleTone(
          (spot.x + spot.w / 2) / width,
          (spot.y + spot.h / 2) / height,
        );
        const tone = spotTone >= 0 ? spotTone : 0.5;
        const depth = 1 - tone;
        const largeWord = share > 0.5;
        ctx.globalAlpha = largeWord ? 0.7 + depth * 0.3 : 0.3 + depth * 0.7;
        ctx.fillStyle = share > 0.55 || tone < 0.45 ? ink : mist;
        ctx.save();
        ctx.translate(spot.x + spot.w / 2, spot.y + spot.h / 2);
        ctx.rotate(spot.angle);
        ctx.fillText(word.text, 0, 0);
        ctx.restore();
        ctx.globalAlpha = 1;
      });

      if (outline) {
        ctx.save();
        ctx.globalAlpha = 0.46;
        ctx.drawImage(outline, 0, 0, width, height);
        ctx.restore();
      }
      canvas.dataset.placed = String(placedCount);
      canvas.dataset.total = String(list.length);
    }

    function schedule() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(draw);
    }

    const observer = new ResizeObserver(schedule);
    observer.observe(canvas);

    Promise.all([
      loadImage(`/wordcloud-mask.png?v=${SHAPE_VERSION}`),
      loadImage(`/wordcloud-outline.png?v=${SHAPE_VERSION}`),
      loadImage(`/wordcloud-tone.png?v=${SHAPE_VERSION}`),
    ])
      .then(([mask, line, tone]) => {
        if (disposed) return;
        const buffer = document.createElement("canvas");
        buffer.width = mask.width;
        buffer.height = mask.height;
        const bufferContext = buffer.getContext("2d", { willReadFrequently: true });
        if (!bufferContext) return;
        bufferContext.drawImage(mask, 0, 0);
        maskData = bufferContext.getImageData(0, 0, mask.width, mask.height).data;
        maskW = mask.width;
        maskH = mask.height;
        const toneBuffer = document.createElement("canvas");
        toneBuffer.width = tone.width;
        toneBuffer.height = tone.height;
        const toneContext = toneBuffer.getContext("2d", { willReadFrequently: true });
        if (!toneContext) return;
        toneContext.drawImage(tone, 0, 0);
        toneData = toneContext.getImageData(0, 0, tone.width, tone.height).data;
        toneW = tone.width;
        toneH = tone.height;
        toneImage = tone;
        canvas.style.aspectRatio = `${mask.width} / ${mask.height}`;
        outline = line;
        schedule();
      })
      .catch(() => {
        if (!disposed) canvas.dataset.error = "mask";
      });

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [words]);

  return (
    <canvas
      ref={canvasRef}
      className="cloud-canvas"
      role="img"
      aria-label="全部入选文章按词频和评分加权的词云，人物轮廓取自首页人像"
    />
  );
}
