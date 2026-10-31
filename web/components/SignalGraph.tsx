"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { storyTitle } from "../lib/story-title";
import { useEffect, useMemo, useRef, useState } from "react";
import type { GraphEdge, Story } from "../lib/types";
import { ScoreBadge } from "./ScoreBadge";

const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), { ssr: false });

type Props = {
  stories: Story[];
  edges: GraphEdge[];
  height?: number;
  title?: string;
  caption?: string;
};

function token(name: string, element?: Element | null) {
  if (typeof window === "undefined") return "";
  const node = element ?? document.documentElement;
  return getComputedStyle(node).getPropertyValue(name).trim();
}

export function SignalGraph({
  stories,
  edges,
  height = 520,
  title = "关系网络",
  caption = "节点是事件簇，连线表示共享标签。拖动、缩放，点击查看故事。",
}: Props) {
  const [selected, setSelected] = useState<Story | null>(null);
  const [width, setWidth] = useState(0);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const paletteRef = useRef<{ accent: string; ink: string; link: string } | null>(null);
  useEffect(() => {
    const element = surfaceRef.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      setWidth(entries[0].contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const storyIds = useMemo(() => new Set(stories.map((story) => story.id)), [stories]);
  const nodes = useMemo(
    () =>
      stories.map((story) => ({
        id: story.id,
        name: `${storyTitle(story).zh} / ${storyTitle(story).en}`,
        score: story.score ?? 0,
      })),
    [stories],
  );
  const links = useMemo(
    () =>
      edges
        .filter((edge) => storyIds.has(edge.source) && storyIds.has(edge.target))
        .map((edge) => ({
          source: edge.source,
          target: edge.target,
          kind: edge.kind,
        })),
    [edges, storyIds],
  );

  return (
    <section className="graph-panel" aria-label={title}>
      <div className="graph-panel__head">
        <h2>{title}</h2>
        <span>{stories.length} 个节点</span>
      </div>
      <div className="graph-surface" ref={surfaceRef} style={{ height }}>
        <p className="graph-caption">{caption}</p>
        {width > 0 ? (
        <ForceGraph2D
          graphData={{ nodes, links } as never}
          width={width}
          height={height}
          nodeRelSize={5}
          nodeCanvasObject={(node, ctx) => {
            const n = node as { x?: number; y?: number; score?: number; name?: string };
            if (typeof n.x !== "number" || typeof n.y !== "number") return;
            if (!paletteRef.current) {
              paletteRef.current = {
                accent: token("--graph-node", surfaceRef.current),
                ink: token("--graph-node-soft", surfaceRef.current),
                link: token("--graph-link", surfaceRef.current),
              };
            }
            const { accent, ink } = paletteRef.current;
            if (!accent || !ink) return;
            const radius = Math.max(4, Math.min(10, (n.score ?? 4) * 0.85));
            ctx.beginPath();
            ctx.arc(n.x, n.y, radius + 3, 0, Math.PI * 2);
            ctx.fillStyle = (n.score ?? 0) >= 8 ? accent : ink;
            ctx.globalAlpha = 0.14;
            ctx.fill();
            ctx.globalAlpha = 1;
            ctx.beginPath();
            ctx.arc(n.x, n.y, radius, 0, Math.PI * 2);
            ctx.fillStyle = (n.score ?? 0) >= 8 ? accent : ink;
            ctx.fill();
          }}
          nodeLabel={(node) => (node as { name?: string }).name ?? ""}
          linkColor={() => paletteRef.current?.link ?? "transparent"}
          linkWidth={0.6}
          onNodeClick={(node) => {
            const found = stories.find((story) => story.id === (node as { id?: string }).id);
            if (found) setSelected(found);
          }}
          cooldownTicks={80}
          warmupTicks={20}
          d3AlphaDecay={0.035}
        />
        ) : null}
        {selected ? (
          <div className="graph-selection">
            <div className="graph-selection__meta">
              <span>{selected.source}</span>
              <ScoreBadge score={selected.score} />
            </div>
            <Link href={"/stories/" + encodeURIComponent(selected.id)}><span lang="zh-CN">{storyTitle(selected).zh}</span><span className="bilingual-en" lang="en">{storyTitle(selected).en}</span></Link>
            <button onClick={() => setSelected(null)} type="button">关闭</button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
