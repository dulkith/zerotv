"use client";

import type { Channel } from "@/types";

interface EpgNow {
  now: { start: string; end: string; title: string; img: number | null } | null;
}

function imgUrl(id: number | null): string {
  return !id ? "" : `/api/img/${id}`;
}

function clock(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

interface ChannelCardProps {
  channel: Channel;
  epg?: EpgNow;
  onWatch: () => void;
  onSchedule: () => void;
}

export function ChannelCard({ channel, epg, onWatch, onSchedule }: ChannelCardProps) {
  const now = epg?.now;
  const bgImg = now?.img ? imgUrl(now.img) : channel.logo ? imgUrl(channel.logo) : "";
  const hasProgramImg = !!now?.img;

  let pct = 0;
  if (now) {
    const s = new Date(now.start).getTime();
    const e = new Date(now.end).getTime();
    const t = Date.now();
    pct = Math.max(0, Math.min(100, ((t - s) / (e - s)) * 100));
  }

  return (
    <div
      className="group bg-gradient-to-b from-[#1c1c20]/90 to-[#121216]/95 border border-white/[0.06] rounded-[14px] overflow-hidden transition-all duration-200 cursor-pointer flex flex-col hover:-translate-y-[3px] hover:border-[#ec1c24]/40 hover:shadow-[0_12px_30px_rgba(0,0,0,0.6),0_0_0_1px_rgba(236,28,36,0.15)]"
      onClick={onWatch}
    >
      {/* Thumbnail */}
      <div className="relative aspect-[16/10] bg-[#131316] overflow-hidden">
        {bgImg && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={bgImg}
            alt=""
            className={`absolute inset-0 w-full h-full object-cover transition-transform duration-400 group-hover:scale-[1.08] ${hasProgramImg ? "" : "p-2"}`}
            loading="lazy"
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/25 to-transparent" />
        {hasProgramImg && channel.logo && (
          <div className="absolute top-1.5 left-1.5 w-7 h-7 rounded-md bg-black/55 backdrop-blur-sm border border-white/15 flex items-center justify-center z-[3] p-0.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={imgUrl(channel.logo)} alt="" className="w-full h-full object-contain" />
          </div>
        )}
        <span className="absolute top-2 right-2 inline-flex items-center gap-1 bg-[#ec1c24] text-white px-1.5 py-0.5 rounded-[5px] text-[8px] font-extrabold uppercase tracking-wider z-[3]">
          <span className="w-1 h-1 rounded-full bg-white animate-pulse" /> Live
        </span>
        {channel.number && (
          <span className="absolute bottom-1.5 right-1.5 bg-black/70 backdrop-blur-sm text-white/90 px-1.5 py-0.5 rounded-[5px] text-[9px] font-bold z-[3]">
            CH {channel.number}
          </span>
        )}
        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-200 z-[4] bg-black/30">
          <svg viewBox="0 0 24 24" className="w-[38px] h-[38px] bg-[#ec1c24] rounded-full p-2.5 fill-white">
            <polygon points="6 4 20 12 6 20" />
          </svg>
        </div>
      </div>

      {/* Info */}
      <div className="px-2.5 py-2 flex flex-col gap-1 flex-1">
        <div className="text-xs font-bold text-white leading-tight truncate">{channel.name}</div>
        <div className="flex items-center gap-1 text-[9px] text-white/40 uppercase tracking-wide font-semibold">
          {channel.resolution && <span>{channel.resolution}</span>}
          <span>{channel.catchup ? "Catchup" : "Live"}</span>
        </div>
        {now ? (
          <div className="mt-auto pt-1.5 border-t border-white/[0.06] min-h-[32px]">
            <div className="text-[10px] font-semibold text-white/85 truncate">
              <span style={{ color: "#22c55e" }}>●</span> {now.title}
            </div>
            <div className="flex justify-between text-[8px] text-white/40 font-semibold">
              <span>{clock(now.start)} – {clock(now.end)}</span>
            </div>
            <div className="h-[2px] bg-white/[0.08] rounded-sm overflow-hidden mt-1">
              <div className="h-full bg-[#ec1c24] transition-all" style={{ width: `${pct}%` }} />
            </div>
          </div>
        ) : (
          <div className="mt-auto pt-1.5 border-t border-white/[0.06]">
            <div className="text-[9px] text-white/25 italic">No EPG data</div>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="px-2.5 pb-2.5 flex gap-1">
        <button
          onClick={(e) => { e.stopPropagation(); onWatch(); }}
          className="flex-1 py-1.5 rounded-md bg-[#ec1c24] text-white text-[9px] font-bold uppercase flex items-center justify-center gap-1"
        >
          ▶ Watch
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onSchedule(); }}
          className="px-2 py-1.5 rounded-md bg-white/5 border border-white/[0.08] text-white/70 text-[9px] font-bold uppercase"
        >
          📅
        </button>
      </div>
    </div>
  );
}
