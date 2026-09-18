"use client";

import type { VodItem } from "@/types";
import { imgUrl } from "@/lib/viu";

function fmtDur(m: number | null): string {
  if (!m || m <= 0) return "—";
  if (Math.floor(m / 60)) return `${Math.floor(m / 60)}h ${m % 60}m`;
  return `${m}m`;
}

interface VodCardProps {
  item: VodItem;
  onPlay: () => void;
  onDirectPlay?: () => void;
}

export function VodCard({ item, onPlay, onDirectPlay }: VodCardProps) {
  const isSeries = item.type === "series";

  return (
    <div className="relative">
      <button onClick={onPlay} className="text-left w-full">
        <div className="relative aspect-[2/3] rounded-lg overflow-hidden bg-[#1a1a1a] shadow-lg mb-1.5">
          <span
            className={`absolute top-1.5 left-1.5 z-10 text-white text-[8px] sm:text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded ${
              isSeries ? "bg-[#8b5cf6]" : "bg-[#3b82f6]"
            }`}
          >
            {isSeries ? "Series" : "Movie"}
          </span>
          {item.poster && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imgUrl(item.poster)}
              alt={item.title}
              className="w-full h-full object-cover"
              loading="lazy"
            />
          )}
        </div>
        <h3 className="text-[11px] sm:text-xs font-bold leading-tight line-clamp-2">{item.title}</h3>
        <p className="text-[9px] sm:text-[10px] text-white/40 mt-0.5 uppercase tracking-wide">
          {item.duration ? fmtDur(item.duration) : item.year || ""}
        </p>
      </button>
      {!isSeries && (
        <button
          onClick={(e) => { e.stopPropagation(); if (onDirectPlay) onDirectPlay(); else onPlay(); }}
          className="absolute top-1.5 right-1.5 z-10 w-6 h-6 rounded-full bg-[#ec1c24] text-white flex items-center justify-center shadow-lg"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-2.5 h-2.5 ml-0.5">
            <polygon points="5 3 19 12 5 21 5 3" />
          </svg>
        </button>
      )}
    </div>
  );
}
