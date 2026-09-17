"use client";

import { useState, useEffect, useMemo } from "react";
import { getDeviceUid } from "@/lib/auth";
import type { Channel } from "@/types";

function imgUrl(id: number | null): string {
  return !id ? "" : `/api/img/${id}`;
}

function clock(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch { return ""; }
}

function dateKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function dayLabel(d: Date): string {
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const key = dateKey(d);
  if (key === dateKey(today)) return "Today";
  if (key === dateKey(tomorrow)) return "Tomorrow";
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

  useEffect(() => {
    const ctrl = new AbortController();
    async function load() {
      try {
        const deviceUid = await getDeviceUid();
        const res = await fetch(`/api/epg/channel/${channel.uid}?days=4`, {
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

  useEffect(() => {
    if (!activeDay && days.length) {
      const def = days.find((d) => d.key === today) || days[0];
      if (def) setActiveDay(def.key);
    }
  }, [activeDay, today]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="fixed inset-0 z-50" onClick={onClose}>
      {/* Background */}
      <div className="absolute inset-0 overflow-y-auto" onClick={(e) => e.stopPropagation()} style={{ backgroundColor: "#0a0a0a", backgroundImage: channel.logo ? `url('${imgUrl(channel.logo)}')` : undefined, backgroundSize: "cover", backgroundPosition: "center" }}>
        {/* Overlay gradients */}
        <div className="absolute inset-0" style={{ background: "linear-gradient(to right, rgba(0,0,0,0.95), rgba(0,0,0,0.5))", pointerEvents: "none" }} />

        {/* Back button */}
        <button className="detail-back" onClick={(e) => { e.stopPropagation(); onClose(); }} style={{ position: "fixed", top: 24, left: 24, width: 48, height: 48, borderRadius: "50%", background: "rgba(0,0,0,0.5)", border: "1px solid rgba(255,255,255,0.15)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#fff", zIndex: 20, padding: 0 }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 22, height: 22 }}><path d="m12 19-7-7 7-7"/><path d="M19 12H5"/></svg>
        </button>

        {/* Hero */}
        <div style={{ position: "relative", zIndex: 1, padding: "90px 40px 30px" }} className="epg-hero-responsive">
          <div style={{ display: "flex", gap: 24, alignItems: "center" }} className="epg-hero-inner-responsive">
            {channel.logo && (
              <div style={{ width: 120, height: 120, borderRadius: 20, overflow: "hidden", background: "rgba(20,20,20,0.8)", border: "1px solid rgba(255,255,255,0.1)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <img src={imgUrl(channel.logo)} alt="" style={{ width: "100%", height: "100%", objectFit: "contain", padding: 12 }} />
              </div>
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#ec1c24", color: "#fff", padding: "4px 10px", borderRadius: 6, fontSize: 11, fontWeight: 800, textTransform: "uppercase", marginBottom: 12 }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#fff", animation: "pulse 1.2s infinite" }} />
                LIVE
              </div>
              <h1 style={{ fontSize: "2rem", fontWeight: 800, color: "#fff", margin: "0 0 6px" }}>{channel.name}</h1>
              <div style={{ fontSize: "0.9rem", color: "rgba(255,255,255,0.6)", marginBottom: 20 }}>
                {channel.number && <span>CH {channel.number}</span>}
                {channel.resolution && <span> · {channel.resolution}</span>}
                {channel.catchup && <span> · Catchup available</span>}
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); onPlay(channel.uid); }}
                style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "12px 22px", borderRadius: 999, background: "#ec1c24", border: "none", color: "#fff", fontWeight: 700, fontSize: 14, cursor: "pointer", fontFamily: "inherit" }}
              >
                ▶ Watch Live
              </button>
            </div>
          </div>
        </div>

        {/* Body */}
        <div style={{ position: "relative", zIndex: 1, padding: "0 40px 60px", maxWidth: 1400 }} className="epg-body-responsive">
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
              <div style={{ display: "flex", gap: 8, overflowX: "auto", padding: "12px 0 16px", position: "sticky", top: 0, background: "linear-gradient(to bottom, rgba(0,0,0,0.95), rgba(0,0,0,0.85))", zIndex: 5 }}>
                {days.map((d) => (
                  <button
                    key={d.key}
                    onClick={(e) => { e.stopPropagation(); setActiveDay(d.key); }}
                    style={{
                      padding: "8px 18px", borderRadius: 999,
                      background: activeDay === d.key ? "#ec1c24" : "rgba(255,255,255,0.06)",
                      border: `1px solid ${activeDay === d.key ? "#ec1c24" : "rgba(255,255,255,0.08)"}`,
                      color: activeDay === d.key ? "#fff" : "rgba(255,255,255,0.7)",
                      fontWeight: 700, fontSize: 13, cursor: "pointer", whiteSpace: "nowrap", fontFamily: "inherit",
                    }}
                  >
                    {dayLabel(d.date)}
                  </button>
                ))}
              </div>

              {/* Programs grid */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 12 }}>
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

                    const cardStyle: React.CSSProperties = {
                      display: "flex", gap: 14, padding: 12, borderRadius: 16,
                      background: isLive
                        ? "linear-gradient(90deg, rgba(236,28,36,0.08), rgba(20,20,22,0.7))"
                        : "rgba(20,20,22,0.7)",
                      border: `1px solid ${isLive ? "rgba(236,28,36,0.5)" : "rgba(255,255,255,0.06)"}`,
                      opacity: isPast && !withinCatchup ? 0.5 : isUpcoming ? 0.5 : 1,
                      cursor: isLive ? "pointer" : withinCatchup ? "pointer" : "default",
                      minHeight: 110,
                    };

                    const handleClick = (e: React.MouseEvent) => {
                      e.stopPropagation();
                      if (isLive) onPlay(channel.uid);
                      else if (withinCatchup && onCatchup) {
                        const catchupItems = programs
                          .filter((cp) => {
                            const cs = new Date(cp.start).getTime();
                            const ce = new Date(cp.end).getTime();
                            return ce < now && channel.catchup && (now - ce) <= catchupMs;
                          })
                          .map((cp) => ({ uid: channel.uid, title: cp.title, begin: cp.start, end: cp.end }));
                        const idx = catchupItems.findIndex((ci) => ci.begin === p.start && ci.end === p.end);
                        onCatchup(channel.uid, p.start, p.end, p.title, {
                          kind: "catchup",
                          index: idx >= 0 ? idx : 0,
                          items: catchupItems,
                        });
                      }
                      else if (isUpcoming) {
                        const toast = document.createElement("div");
                        toast.textContent = "Not started yet";
                        Object.assign(toast.style, { position: "fixed", bottom: 30, left: "50%", transform: "translate(-50%, 20px)", background: "rgba(30,30,34,0.95)", border: "1px solid rgba(255,255,255,0.15)", color: "#fff", padding: "12px 22px", borderRadius: 999, fontSize: 14, fontWeight: 600, opacity: "0", transition: "all 0.25s", zIndex: 9999, pointerEvents: "none" });
                        document.body.appendChild(toast);
                        setTimeout(() => { toast.style.opacity = "1"; toast.style.transform = "translate(-50%, 0)"; }, 10);
                        setTimeout(() => { toast.style.opacity = "0"; setTimeout(() => toast.remove(), 300); }, 2200);
                      }
                    };

                    return (
                      <div key={i} style={cardStyle} onClick={handleClick}>
                        {/* Thumbnail */}
                        <div style={{
                          flexShrink: 0, width: 140, aspectRatio: "16/9", borderRadius: 10,
                          background: p.img ? `url('${imgUrl(p.img)}') center/cover` : "#1a1a1c",
                          position: "relative", alignSelf: "center",
                        }}>
                          {isLive && (
                            <span style={{ position: "absolute", top: 8, left: 8, padding: "3px 8px", borderRadius: 5, fontSize: 10, fontWeight: 800, textTransform: "uppercase", background: "#ec1c24", color: "#fff" }}>LIVE</span>
                          )}
                          {withinCatchup && (
                            <span style={{ position: "absolute", top: 8, left: 8, padding: "3px 8px", borderRadius: 5, fontSize: 10, fontWeight: 800, textTransform: "uppercase", background: "rgba(59,130,246,0.95)", color: "#fff" }}>⏪ Replay</span>
                          )}
                          {isUpcoming && (
                            <span style={{ position: "absolute", top: 8, left: 8, padding: "3px 8px", borderRadius: 5, fontSize: 10, fontWeight: 800, background: "rgba(0,0,0,0.75)", color: "#fff" }}>{clock(p.start)}</span>
                          )}
                        </div>
                        {/* Body */}
                        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", justifyContent: "center" }}>
                          <div style={{ fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.55)", marginBottom: 6 }}>
                            {clock(p.start)} – {clock(p.end)} <span style={{ opacity: 0.5 }}>{dur}m</span>
                          </div>
                          <div style={{ fontSize: "1rem", fontWeight: 700, color: "#fff", marginBottom: 4, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                            {p.title}
                          </div>
                          {p.desc && (
                            <div style={{ fontSize: "0.8rem", color: "rgba(255,255,255,0.5)", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                              {p.desc}
                            </div>
                          )}
                          {isLive && (
                            <div style={{ height: 3, background: "rgba(255,255,255,0.1)", borderRadius: 2, marginTop: 8, overflow: "hidden" }}>
                              <div style={{ height: "100%", background: "#ec1c24", width: `${pct}%` }} />
                            </div>
                          )}
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
        @media (max-width: 640px) {
          .epg-hero-responsive { padding: 80px 16px 20px !important; }
          .epg-hero-inner-responsive { flex-direction: column !important; align-items: flex-start !important; }
          .epg-body-responsive { padding: 0 16px 60px !important; }
        }
      `}</style>
    </div>
  );
}
