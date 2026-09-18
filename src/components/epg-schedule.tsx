"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { getDeviceUid } from "@/lib/auth";
import type { Channel } from "@/types";
import { imgUrl } from "@/lib/viu";
import { Play } from "lucide-react";

function clock(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch { return ""; }
}

function dateKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function dayLabel(d: Date, compact?: boolean): string {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const key = dateKey(d);
  const dateStr = d.toLocaleDateString([], { month: "short", day: "numeric" });
  if (key === dateKey(yesterday)) return compact ? `Yest · ${dateStr}` : `Yesterday (${dateStr})`;
  if (key === dateKey(today)) return compact ? `Today · ${dateStr}` : `Today (${dateStr})`;
  if (key === dateKey(tomorrow)) return compact ? `Tmrw · ${dateStr}` : `Tomorrow (${dateStr})`;
  return d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
}

interface EpgProgram {
  start: string; end: string; title: string; desc: string; img: number | null;
}

interface EpgScheduleProps {
  channel: Channel;
  onClose: () => void;
  onPlay: (uid: string) => void;
  onCatchup?: (chUid: string, begin: string, end: string, title: string, queue?: { kind: "catchup"; index: number; items: { uid: string; title: string; begin: string; end: string }[] }) => void;
}

export function EpgSchedule({ channel, onClose, onPlay, onCatchup }: EpgScheduleProps) {
  const [programs, setPrograms] = useState<EpgProgram[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeDay, setActiveDay] = useState("");
  const [isMobile, setIsMobile] = useState(false);
  const programsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 640);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    async function load() {
      try {
        const deviceUid = await getDeviceUid();
        const res = await fetch(`/api/epg/channel/${channel.uid}?days=5`, {
          headers: { "x-device-uid": deviceUid },
          signal: ctrl.signal,
        });
        if (res.ok) {
          const data = await res.json();
          setPrograms((data.programs || []).slice().sort((a: EpgProgram, b: EpgProgram) => a.start.localeCompare(b.start)));
        }
      } catch {}
      setLoading(false);
    }
    load();
    return () => ctrl.abort();
  }, [channel.uid]);

  const days = useMemo(() => {
    const result: { key: string; date: Date; items: EpgProgram[] }[] = [];
    const dayMap: Record<string, { key: string; date: Date; items: EpgProgram[] }> = {};
    for (const p of programs) {
      const d = new Date(p.start);
      const k = dateKey(d);
      if (!dayMap[k]) { dayMap[k] = { key: k, date: d, items: [] }; result.push(dayMap[k]); }
      dayMap[k].items.push(p);
    }
    return result;
  }, [programs]);

  const now = Date.now();
  const today = useMemo(() => dateKey(new Date()), []);
  const catchupMs = ((channel as any).catchupHours || 72) * 3600 * 1000;

  const handleCardClick = (p: EpgProgram, isLive: boolean, isUpcoming: boolean, withinCatchup: boolean) => (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isLive) onPlay(channel.uid);
    else if (withinCatchup && onCatchup) {
      const ce = new Date(p.end).getTime();
      const catchupItems = programs
        .filter((cp) => { const cEnd = new Date(cp.end).getTime(); return cEnd < now && channel.catchup && (now - cEnd) <= catchupMs; })
        .map((cp) => ({ uid: channel.uid, title: cp.title, begin: cp.start, end: cp.end }));
      const idx = catchupItems.findIndex((ci) => ci.begin === p.start && ci.end === p.end);
      onCatchup(channel.uid, p.start, p.end, p.title, { kind: "catchup", index: idx >= 0 ? idx : 0, items: catchupItems });
    } else if (isUpcoming) {
      const toast = document.createElement("div");
      toast.textContent = "Not started yet";
      Object.assign(toast.style, { position: "fixed", bottom: 30, left: "50%", transform: "translate(-50%, 20px)", background: "rgba(30,30,34,0.95)", border: "1px solid rgba(255,255,255,0.15)", color: "#fff", padding: "12px 22px", borderRadius: 999, fontSize: 14, fontWeight: 600, opacity: "0", transition: "all 0.25s", zIndex: 9999, pointerEvents: "none" });
      document.body.appendChild(toast);
      setTimeout(() => { toast.style.opacity = "1"; toast.style.transform = "translate(-50%, 0)"; }, 10);
      setTimeout(() => { toast.style.opacity = "0"; setTimeout(() => toast.remove(), 300); }, 2200);
    }
  };

  useEffect(() => {
    if (!activeDay && days.length) {
      const def = days.find((d) => d.key === today) || days[0];
      if (def) setActiveDay(def.key);
    }
  }, [activeDay, today, days]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!activeDay || !programsRef.current) return;
    const timer = setTimeout(() => {
      const liveEl = programsRef.current?.querySelector<HTMLElement>("[data-live='true']");
      if (liveEl) liveEl.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 100);
    return () => clearTimeout(timer);
  }, [activeDay, programs]);

  return (
    <div className="fixed inset-0 z-50" onClick={onClose}>
      {/* Background */}
      <div className="absolute inset-0 overflow-y-auto" onClick={(e) => e.stopPropagation()} style={{ backgroundColor: "#0a0a0a" }}>
        {/* Background image — fixed behind scroll */}
        <div style={{ position: "fixed", inset: 0, backgroundImage: channel.logo ? `url('${imgUrl(channel.logo).replace(/'/g, "\\'")}')` : undefined, backgroundSize: "cover", backgroundPosition: "center", filter: "blur(40px) brightness(0.3)", transform: "scale(1.1)", pointerEvents: "none", zIndex: 0 }} />
        {/* Dark overlay — fixed, content scrolls over it */}
        <div style={{ position: "fixed", inset: 0, background: "linear-gradient(to bottom, rgba(10,10,10,0.7) 0%, rgba(10,10,10,0.92) 30%)", pointerEvents: "none", zIndex: 0 }} />

        {/* Back button */}
        <button className="detail-back" onClick={(e) => { e.stopPropagation(); onClose(); }} style={{ position: "fixed", top: 24, left: 24, width: 48, height: 48, borderRadius: "50%", background: "rgba(0,0,0,0.5)", border: "1px solid rgba(255,255,255,0.15)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#fff", zIndex: 20, padding: 0 }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 22, height: 22 }}><path d="m12 19-7-7 7-7"/><path d="M19 12H5"/></svg>
        </button>

        {/* Hero */}
        <div style={{ position: "relative", zIndex: 1, padding: "90px 40px 30px" }} className="epg-hero-responsive">
          <div style={{ display: "flex", gap: 24, alignItems: "flex-start" }} className="epg-hero-inner-responsive">
            {channel.normalLogo ? (
              <div style={{ width: 100, height: 100, flexShrink: 0 }}>
                <img src={imgUrl(channel.normalLogo)} alt="" style={{ width: "100%", height: "100%", objectFit: "contain", filter: "drop-shadow(0 2px 8px rgba(0,0,0,0.6))" }} />
              </div>
            ) : channel.logo ? (
              <div style={{ width: 100, height: 100, borderRadius: 16, overflow: "hidden", background: "rgba(20,20,20,0.8)", border: "1px solid rgba(255,255,255,0.1)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <img src={imgUrl(channel.logo)} alt="" style={{ width: "100%", height: "100%", objectFit: "contain", padding: 10 }} />
              </div>
            ) : null}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                <h1 style={{ fontSize: "1.75rem", fontWeight: 800, color: "#fff", margin: 0, lineHeight: 1.2 }}>{channel.name}</h1>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5, background: "#ec1c24", color: "#fff", padding: "3px 8px", borderRadius: 6, fontSize: 10, fontWeight: 800, textTransform: "uppercase", flexShrink: 0 }}>
                  <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#fff", animation: "pulse 1.2s infinite" }} />
                  LIVE
                </span>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, fontSize: "0.8rem", color: "rgba(255,255,255,0.5)", marginBottom: 16 }}>
                {channel.number && <span style={{ background: "rgba(255,255,255,0.08)", padding: "2px 8px", borderRadius: 4 }}>CH {channel.number}</span>}
                {channel.resolution && <span style={{ background: "rgba(255,255,255,0.08)", padding: "2px 8px", borderRadius: 4 }}>{channel.resolution}</span>}
                {channel.catchup && <span style={{ background: "rgba(59,130,246,0.15)", color: "#60a5fa", padding: "2px 8px", borderRadius: 4 }}>Catchup</span>}
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); onPlay(channel.uid); }}
                style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "10px 20px", borderRadius: 999, background: "#ec1c24", border: "none", color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}
              >
                <Play className="w-4 h-4 fill-current" /> Watch Live
              </button>
            </div>
          </div>
        </div>

        {/* Body */}
        <div style={{ position: "relative", zIndex: 1, padding: "0 16px 60px", width: "100%", boxSizing: "border-box" }} className="epg-body-responsive">
          {loading ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "40px 0", gap: 12 }}>
              <div className="spinner" />
              <p style={{ color: "rgba(255,255,255,0.5)", fontSize: 14 }}>Loading schedule…</p>
            </div>
          ) : days.length === 0 ? (
            <div style={{ textAlign: "center", padding: "40px 0", color: "rgba(255,255,255,0.4)" }}>No schedule data</div>
          ) : (
            <>
              {/* Day tabs */}
              <div className="epg-days-scroll" style={{ display: "flex", gap: 6, overflowX: "auto", padding: "12px 0 16px", position: "sticky", top: 0, background: "linear-gradient(to bottom, rgba(0,0,0,0.95), rgba(0,0,0,0.85))", zIndex: 5 }}>
                {days.map((d) => (
                  <button
                    key={d.key}
                    onClick={(e) => { e.stopPropagation(); setActiveDay(d.key); }}
                    className="epg-day-tab"
                    style={{
                      padding: "8px 14px", borderRadius: 999,
                      background: activeDay === d.key ? "#ec1c24" : "rgba(255,255,255,0.06)",
                      border: `1px solid ${activeDay === d.key ? "#ec1c24" : "rgba(255,255,255,0.08)"}`,
                      color: activeDay === d.key ? "#fff" : "rgba(255,255,255,0.7)",
                      fontWeight: 700, fontSize: 12, cursor: "pointer", whiteSpace: "nowrap", fontFamily: "inherit", flexShrink: 0,
                    }}
                  >
                    {dayLabel(d.date, isMobile)}
                  </button>
                ))}
              </div>

              {/* Programs grid */}
              <div ref={programsRef} className="epg-programs-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 8, width: "100%" }}>
                {days.filter((d) => d.key === activeDay).map((d) =>
                  d.items.map((p, i) => {
                    const s = new Date(p.start).getTime();
                    const e = new Date(p.end).getTime();
                    const isLive = s <= now && now < e;
                    const isPast = now >= e;
                    const isUpcoming = s > now;
                    const withinCatchup = isPast && channel.catchup && (now - e) <= catchupMs;
                    const dur = Math.round((e - s) / 60000);
                    const pct = isLive ? Math.min(100, ((now - s) / (e - s)) * 100) : 0;

                    return (
                      <div
                        key={i}
                        className="epg-program-card"
                        onClick={handleCardClick(p, isLive, isUpcoming, withinCatchup)}
                        data-live={isLive ? "true" : undefined}
                        style={{
                          borderRadius: 12, overflow: "hidden",
                          background: isLive
                            ? "linear-gradient(135deg, rgba(236,28,36,0.1), rgba(20,20,22,0.9))"
                            : "rgba(20,20,22,0.8)",
                          border: `1px solid ${isLive ? "rgba(236,28,36,0.4)" : "rgba(255,255,255,0.06)"}`,
                          opacity: isPast && !withinCatchup ? 0.45 : isUpcoming ? 0.5 : 1,
                          cursor: isLive ? "pointer" : withinCatchup ? "pointer" : "default",
                          position: "relative",
                        }}
                      >
                        {/* Thumbnail */}
                        <div className="epg-program-thumb" style={{
                          width: "100%", aspectRatio: "16/9",
                          background: "#1a1a1c",
                          position: "relative", overflow: "hidden",
                        }}>
                          {p.img ? (
                            <img src={imgUrl(p.img)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                          ) : (
                            <div style={{ width: "100%", height: "100%", background: "linear-gradient(135deg, #1a1a1c, #222)" }} />
                          )}
                          {/* Tags — right side */}
                          <div style={{ position: "absolute", top: 6, right: 6, display: "flex", gap: 4, zIndex: 2 }}>
                            {isLive && (
                              <span style={{ display: "inline-flex", alignItems: "center", gap: 3, padding: "2px 7px", borderRadius: 4, fontSize: 9, fontWeight: 800, textTransform: "uppercase", background: "#ec1c24", color: "#fff" }}>
                                <span style={{ width: 4, height: 4, borderRadius: "50%", background: "#fff", animation: "pulse 1.2s infinite" }} />
                                LIVE
                              </span>
                            )}
                            {withinCatchup && (
                              <span style={{ padding: "2px 7px", borderRadius: 4, fontSize: 9, fontWeight: 800, textTransform: "uppercase", background: "rgba(59,130,246,0.95)", color: "#fff" }}>Replay</span>
                            )}
                            {isUpcoming && (
                              <span style={{ padding: "2px 7px", borderRadius: 4, fontSize: 9, fontWeight: 800, background: "rgba(0,0,0,0.7)", color: "#fff" }}>{clock(p.start)}</span>
                            )}
                          </div>
                          {isLive && (
                            <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 3, background: "rgba(255,255,255,0.15)" }}>
                              <div style={{ height: "100%", background: "#ec1c24", width: `${pct}%` }} />
                            </div>
                          )}
                        </div>
                        {/* Body */}
                        <div style={{ padding: "8px 12px" }}>
                          <div style={{ fontSize: 10, fontWeight: 600, color: isLive ? "#ec1c24" : "rgba(255,255,255,0.5)", marginBottom: 3 }}>
                            {clock(p.start)} – {clock(p.end)} · {dur}m
                          </div>
                          <div style={{ fontSize: "0.8rem", fontWeight: 700, color: "#fff", lineHeight: 1.2, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                            {p.title}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </>
          )}
        </div>
      </div>

      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
        .spinner { width: 40px; height: 40px; border: 3px solid rgba(255,255,255,0.1); border-top-color: #ec1c24; border-radius: 50%; animation: spin 0.8s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
        .epg-days-scroll::-webkit-scrollbar { display: none; }
        .epg-days-scroll { -ms-overflow-style: none; scrollbar-width: none; }
        @media (max-width: 640px) {
          .epg-hero-responsive { padding: 70px 16px 16px !important; }
          .epg-hero-inner-responsive { flex-direction: column !important; align-items: flex-start !important; gap: 16px !important; }
          .epg-body-responsive { padding: 0 10px 60px !important; }
          .epg-days-scroll { gap: 4px !important; padding: 10px 0 12px !important; }
          .epg-day-tab { padding: 6px 10px !important; font-size: 10px !important; }
          .epg-programs-grid { grid-template-columns: repeat(2, 1fr) !important; gap: 6px !important; }
          .epg-program-thumb { aspect-ratio: 16/9 !important; }
          .epg-program-card { border-radius: 8px !important; }
        }
      `}</style>
    </div>
  );
}
