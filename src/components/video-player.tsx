"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { imgUrl } from "@/lib/viu";

interface VideoPlayerProps {
  streamUrl: string;
  licenseUrl: string;
  licenseFp?: string;
  title: string;
  subtitle?: string;
  bannerId?: number | null;
  isLive?: boolean;
  onBack: () => void;
  onEnded?: () => void;
  nextLabel?: string;
}

declare global {
  interface Window { shaka: any; }
}

export function VideoPlayer({ streamUrl, licenseUrl, licenseFp, title, subtitle, bannerId, isLive, onBack, onEnded, nextLabel }: VideoPlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null!);
  const videoRef = useRef<HTMLVideoElement>(null);
  const shakaRef = useRef<any>(null);

  const [paused, setPaused] = useState(true);
  const [buffering, setBuffering] = useState(true);
  const [idle, setIdle] = useState(false);
  const [booting, setBooting] = useState(true);
  const [bootLabel, setBootLabel] = useState(title || "Loading");
  const [error, setError] = useState("");
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [qualityTracks, setQualityTracks] = useState<any[]>([]);
  const [autoQuality, setAutoQuality] = useState(true);
  const [activeHeight, setActiveHeight] = useState(0);

  const hideTimer = useRef<any>(null);
  const progressRef = useRef<HTMLDivElement>(null);

  const showUI = useCallback(() => {
    setIdle(false);
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      if (!videoRef.current?.paused) setIdle(true);
      setMenuOpen(false);
    }, 3500);
  }, []);

  const fmtTime = (s: number) => {
    if (!isFinite(s) || s < 0) return "0:00";
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = Math.floor(s % 60);
    if (h) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
    return `${m}:${String(sec).padStart(2, "0")}`;
  };

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    v.paused ? v.play().catch(() => {}) : v.pause();
  }, []);

  const seek = useCallback((d: number) => {
    const v = videoRef.current;
    if (!v || !isFinite(v.duration)) return;
    v.currentTime = Math.max(0, Math.min(v.duration, v.currentTime + d));
    showUI();
  }, [showUI]);

  const seekTo = useCallback((pct: number) => {
    const v = videoRef.current;
    if (!v || !isFinite(v.duration)) return;
    v.currentTime = (pct / 100) * v.duration;
    showUI();
  }, [showUI]);

  const toggleFs = useCallback(() => {
    const c = containerRef.current;
    if (!c) return;
    if (!document.fullscreenElement) {
      (c.requestFullscreen || (c as any).webkitRequestFullscreen).call(c).catch(() => {});
    } else {
      (document.exitFullscreen || (document as any).webkitExitFullscreen).call(document).catch(() => {});
    }
  }, []);

  const populateQuality = useCallback(() => {
    const s = shakaRef.current;
    if (!s) return;
    try {
      const tracks = s.getVariantTracks() || [];
      const byH = new Map<number, any>();
      for (const t of tracks) {
        if (!t.height) continue;
        const ex = byH.get(t.height);
        if (!ex || t.bandwidth > ex.bandwidth) byH.set(t.height, t);
      }
      const uniq = [...byH.values()].sort((a: any, b: any) => b.height - a.height);
      setQualityTracks(uniq);
      const cfg = s.getConfiguration();
      setAutoQuality(!!(cfg.abr && cfg.abr.enabled));
      const cur = tracks.find((t: any) => t.active);
      setActiveHeight(cur?.height || 0);
    } catch {}
  }, []);

  const selectQuality = useCallback((h: number | null) => {
    const s = shakaRef.current;
    if (!s) return;
    try {
      if (h === null) {
        s.configure({ abr: { enabled: true } });
        setAutoQuality(true);
      } else {
        const tracks = s.getVariantTracks() || [];
        const t = tracks.find((x: any) => x.height === h);
        if (t) {
          s.configure({ abr: { enabled: false } });
          s.selectVariantTrack(t, true);
          setAutoQuality(false);
          setActiveHeight(h);
        }
      }
    } catch {}
    setMenuOpen(false);
  }, []);

  // Shaka init
  useEffect(() => {
    let destroyed = false;

    let capturedAssetId = "";

    function extractAssetIdFromInitData(initData: ArrayBuffer | null): string {
      if (!initData) return "";
      const bytes = new Uint8Array(initData);
      const candidates: string[] = [];
      const tryDecode = (enc: string) => {
        try { candidates.push(new TextDecoder(enc, { fatal: false }).decode(bytes)); } catch (_) {}
      };
      tryDecode("utf-8");
      tryDecode("utf-16be");
      tryDecode("utf-16le");
      if (bytes.byteLength > 4) {
        const tryDecode4 = (enc: string) => {
          try { candidates.push(new TextDecoder(enc, { fatal: false }).decode(bytes.subarray(4))); } catch (_) {}
        };
        tryDecode4("utf-8");
        tryDecode4("utf-16be");
      }
      for (const text of candidates) {
        let m = text.match(/URI\s*=\s*"skd:\/\/([^"?#\s]+)/i);
        if (!m) m = text.match(/URI\s*=\s*skd:\/\/([^"?#\s]+)/i);
        if (!m) m = text.match(/skd:\/\/([^\s"'?#]+)/i);
        if (m) return m[1];
      }
      if (bytes.byteLength === 16 || bytes.byteLength === 20) {
        const uuidBytes = bytes.byteLength === 20 ? bytes.subarray(4) : bytes;
        const hex = Array.from(uuidBytes.slice(0, 16)).map(b => b.toString(16).padStart(2, "0")).join("");
        return (hex.slice(0, 8) + "-" + hex.slice(8, 12) + "-" + hex.slice(12, 16) + "-" + hex.slice(16, 20) + "-" + hex.slice(20, 32)).toUpperCase();
      }
      return "";
    }

    async function init() {
      try {
        if (!window.shaka) {
          const script = document.createElement("script");
          script.src = "https://cdn.jsdelivr.net/npm/shaka-player@4.16.6/dist/shaka-player.compiled.debug.js";
          await new Promise<void>((res, rej) => { script.onload = () => res(); script.onerror = rej; document.head.appendChild(script); });
        }
      } catch { setError("Failed to load player library"); return; }
      if (destroyed || !videoRef.current) return;

      (window as any).shaka.polyfill.installAll();

      const video = videoRef.current;

      video.addEventListener("encrypted", (e: any) => {
        const id = extractAssetIdFromInitData(e.initData);
        if (id) {
          capturedAssetId = id;
          console.log("[player] captured assetId:", id);
        }
      }, { capture: true, once: true });

      const player = new window.shaka.Player();
      await player.attach(video);
      shakaRef.current = player;

      player.addEventListener("error", (e: any) => {
        const d = e?.detail || e;
        console.error("[shaka]", d?.code, d?.message);
        setBooting(false);
        setError(d?.message || `Error ${d?.code}`);
      });

      const isSafari = /Safari/i.test(navigator.userAgent) && !/Chrome|Chromium|Edg|CriOS|FxiOS/i.test(navigator.userAgent);
      const drmType = (licenseFp && isSafari) ? "fairplay" : "widevine";
      console.log("[shaka] DRM type:", drmType, "safari:", isSafari, "fp:", !!licenseFp, "licenseFp:", licenseFp, "licenseWv:", licenseUrl, "stream:", streamUrl);

      const config: Record<string, unknown> = {
        drm: { retryParameters: { maxAttempts: 3, baseDelay: 500, backoffFactor: 2, timeout: 30000 } },
      };

      if (drmType === "fairplay" && licenseFp) {
        (config.drm as Record<string, unknown>).servers = {
          "com.apple.fps": licenseFp,
          "com.apple.fps.1_0": licenseFp,
        };
        (config.drm as Record<string, unknown>).advanced = {
          "com.apple.fps": { serverCertificateUri: "/cert" },
          "com.apple.fps.1_0": { serverCertificateUri: "/cert" },
        };
      } else if (licenseUrl) {
        (config.drm as Record<string, unknown>).servers = { "com.widevine.alpha": licenseUrl };
      }
      player.configure(config);

      const uid = localStorage.getItem("deviceUid") || "";
      const net = player.getNetworkingEngine();

      net.registerRequestFilter((type: any, request: any) => {
        if (request?.headers) request.headers["x-device-uid"] = uid;
        else if (request?.getHeader) request.setHeader("x-device-uid", uid);

        if (drmType === "fairplay" && type === (window as any).shaka?.net?.NetworkingEngine?.RequestType?.LICENSE) {
          if (request?.headers) request.headers["x-asset-id"] = capturedAssetId || "";
          else if (request?.setHeader) request.setHeader("x-asset-id", capturedAssetId || "");
        }
      });

      try {
        setBootLabel(title || "Loading");
        await player.load(streamUrl);
        if (isLive && player.goToLive) player.goToLive();
        populateQuality();
        video.muted = true;
        video.addEventListener("playing", () => { setTimeout(() => { if (video.muted) video.muted = false; }, 300); }, { once: true });
        try { await video.play(); } catch {
          setBooting(false);
        }
        let hintEl: HTMLDivElement | null = null;
        if (!isLive && video.paused) {
          hintEl = document.createElement("div");
          hintEl.style.cssText = "position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);background:rgba(0,0,0,0.75);padding:20px 32px;border-radius:16px;font-size:20px;font-weight:700;color:#fff;cursor:pointer;z-index:9";
          hintEl.textContent = "▶ Tap to play";
          hintEl.onclick = () => { video.play(); hintEl?.remove(); };
          containerRef.current?.appendChild(hintEl);
        }
        const reveal = () => { if (video.readyState >= 2 && video.currentTime > 0) { setBooting(false); video.removeEventListener("timeupdate", reveal); } };
        video.addEventListener("timeupdate", reveal);
        const bootTimer = setTimeout(() => setBooting(false), 15000);
      } catch (e: any) {
        setBooting(false);
        setError(e?.message || "Load failed");
      }
    }

    init();
    return () => {
      destroyed = true;
      if (shakaRef.current) { try { shakaRef.current.destroy(); } catch {} shakaRef.current = null; }
    };
  }, [streamUrl, licenseUrl, licenseFp]);

  // Video events
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onPlay = () => setPaused(false);
    const onPause = () => setPaused(true);
    const onWaiting = () => setBuffering(true);
    const onPlaying = () => setBuffering(false);
    let lastQualityCheck = 0;
    const onTimeUpdate = () => { setCurrentTime(v.currentTime); const now = Date.now(); if (shakaRef.current && now - lastQualityCheck > 5000) { lastQualityCheck = now; populateQuality(); } };
    const onDurationChange = () => setDuration(v.duration);
    const onProgress = () => { if (v.buffered.length > 0 && isFinite(v.duration) && v.duration > 0) setBuffered((v.buffered.end(v.buffered.length - 1) / v.duration) * 100); };
    const onEndedEvent = () => { if (!isLive) onEnded?.(); };
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    v.addEventListener("waiting", onWaiting);
    v.addEventListener("playing", onPlaying);
    v.addEventListener("timeupdate", onTimeUpdate);
    v.addEventListener("durationchange", onDurationChange);
    v.addEventListener("progress", onProgress);
    v.addEventListener("ended", onEndedEvent);
    return () => {
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
      v.removeEventListener("waiting", onWaiting);
      v.removeEventListener("playing", onPlaying);
      v.removeEventListener("timeupdate", onTimeUpdate);
      v.removeEventListener("durationchange", onDurationChange);
      v.removeEventListener("progress", onProgress);
      v.removeEventListener("ended", onEndedEvent);
    };
  }, [populateQuality, isLive, onEnded]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea") return;
      switch (e.key) {
        case " ": case "k": case "Enter": e.preventDefault(); togglePlay(); break;
        case "ArrowLeft": e.preventDefault(); seek(-10); break;
        case "ArrowRight": e.preventDefault(); seek(10); break;
        case "ArrowUp": e.preventDefault(); seek(60); break;
        case "ArrowDown": e.preventDefault(); seek(-60); break;
        case "m": case "M": e.preventDefault(); if (videoRef.current) videoRef.current.muted = !videoRef.current.muted; break;
        case "f": case "F": e.preventDefault(); toggleFs(); break;
        case "Escape": e.preventDefault(); onBack(); break;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [togglePlay, seek, toggleFs, onBack]);

  const progressPct = isLive || !duration ? 0 : (currentTime / duration) * 100;
  const banner = bannerId ? imgUrl(bannerId) : "";

  const handleProgressClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    const rect = progressRef.current?.getBoundingClientRect();
    if (!rect) return;
    const pct = ((e.clientX - rect.left) / rect.width) * 100;
    seekTo(Math.max(0, Math.min(100, pct)));
  };

  return (
    <div
      ref={containerRef}
      className={`fixed inset-0 bg-black z-50 select-none ${idle ? "cursor-none" : ""}`}
      onMouseMove={showUI}
      onClick={togglePlay}
    >
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeBoot { 0%{opacity:1} 100%{opacity:0;pointer-events:none} }
        .vp-spinner { width: 40px; height: 40px; border: 3px solid rgba(255,255,255,0.1); border-top-color: #ec1c24; border-radius: 50%; animation: spin 0.8s linear infinite; }
        .vp-boot { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; background: #000; z-index: 50; transition: opacity 0.35s; }
        .vp-boot.hide { animation: fadeBoot 0.35s forwards; pointer-events: none; }
        .vp-progress { position: relative; height: 20px; display: flex; align-items: center; cursor: pointer; padding: 0 4px; }
        .vp-progress-bg { position: absolute; left: 4px; right: 4px; height: 4px; background: rgba(255,255,255,0.25); border-radius: 2px; overflow: hidden; }
        .vp-progress-buffered { position: absolute; inset: 0; background: rgba(255,255,255,0.4); }
        .vp-progress-current { position: absolute; inset: 0; background: #ec1c24; }
        .vp-thumb { position: absolute; left: 0; top: 50%; width: 14px; height: 14px; background: #ec1c24; border-radius: 50%; transform: translate(-50%, -50%) scale(0); transition: transform 0.15s; pointer-events: none; }
        .vp-progress:hover .vp-thumb { transform: translate(-50%, -50%) scale(1); }
        .vp-quality-menu { position: absolute; bottom: 90px; right: 16px; min-width: 180px; max-height: 320px; overflow-y: auto; background: rgba(20,20,20,0.96); border: 1px solid rgba(255,255,255,0.12); border-radius: 14px; padding: 6px; z-index: 30; -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px); box-shadow: 0 10px 30px rgba(0,0,0,0.6); }
        .vp-qitem { padding: 10px 14px; border-radius: 8px; cursor: pointer; font-size: 14px; color: #fff; display: flex; justify-content: space-between; align-items: center; user-select: none; }
        .vp-qitem:hover { background: rgba(255,255,255,0.08); }
        .vp-qitem.active { color: #ec1c24; font-weight: 700; }
        @media (max-width: 767px) { .vp-banner-landscape { width: 88px; height: 50px; } .vp-banner-portrait { width: 44px; height: 66px; } .vp-title { font-size: 1.15rem !important; } }
        @media (min-width: 768px) { .vp-banner-landscape { width: 120px; height: 68px; } .vp-banner-portrait { width: 52px; height: 76px; } .vp-title { font-size: 1.75rem !important; } }
      `}</style>

      <video ref={videoRef} className="absolute inset-0 w-full h-full object-contain" playsInline preload="auto" />

      {/* Boot screen */}
      <div className={`vp-boot ${!booting ? "hide" : ""}`}>
        <div className="vp-spinner" style={{ width: 54, height: 54 }} />
        <div style={{ fontSize: 14, color: "rgba(255,255,255,0.6)", maxWidth: "80%", textAlign: "center" }}>{bootLabel}…</div>
      </div>

      {/* Error */}
      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/90 z-[100] text-center p-6" onClick={(e) => e.stopPropagation()}>
          <h4 className="text-white text-lg font-bold mb-2">Playback Error</h4>
          <p className="text-red-300 text-sm">{error}</p>
          <button onClick={onBack} className="mt-4 px-6 py-2 bg-[#ec1c24] rounded-full text-white font-semibold text-sm">Go Back</button>
        </div>
      )}

      {/* Top bar */}
      <div className={`absolute top-0 left-0 right-0 z-10 transition-opacity duration-300 ${idle ? "opacity-0 pointer-events-none" : ""}`} style={{ padding: "20px 24px 80px", background: "linear-gradient(to bottom, rgba(0,0,0,0.9), transparent)" }}>
        <div className="flex gap-4 items-start">
          <button onClick={(e) => { e.stopPropagation(); onBack(); }} className="w-11 h-11 rounded-full flex items-center justify-center shrink-0" style={{ background: "rgba(0,0,0,0.5)", border: "1px solid rgba(255,255,255,0.15)" }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-[22px] h-[22px] text-white"><path d="m12 19-7-7 7-7"/><path d="M19 12H5"/></svg>
          </button>
          {banner && (
            <div className={`${isLive ? "vp-banner-landscape" : "vp-banner-portrait"} rounded-[8px] overflow-hidden bg-[#1a1a1a] flex-shrink-0`}>
              <img src={banner} className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
            </div>
          )}
          <div className="flex-1 min-w-0 pt-1">
            <h1 className="vp-title text-white font-extrabold m-0 mb-2" style={{ fontSize: "1.15rem" }}>{title}</h1>
            <div className="flex items-center gap-2 text-xs" style={{ color: "rgba(255,255,255,0.75)" }}>
              {isLive && (
                <span className="inline-flex items-center gap-1.5 bg-[#ec1c24] text-white font-extrabold px-2 py-0.5 rounded text-[10px]" style={{ animation: "pulse 1.2s infinite" }}>
                  <span className="w-1.5 h-1.5 rounded-full bg-white" /> LIVE
                </span>
              )}
              {subtitle && <span>{subtitle}</span>}
            </div>
          </div>
        </div>
      </div>

      {/* Big play button */}
      {paused && !buffering && !booting && !error && (
        <div className="absolute inset-0 flex items-center justify-center z-[5] cursor-pointer" onClick={(e) => { e.stopPropagation(); togglePlay(); }}>
          <svg viewBox="0 0 24 24" className="w-20 h-20 fill-white" style={{ filter: "drop-shadow(0 4px 20px rgba(0,0,0,0.8))" }}><polygon points="6 4 20 12 6 20"/></svg>
        </div>
      )}

      {/* Buffering spinner */}
      {buffering && !booting && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[8]" style={{ width: 60, height: 60, border: "4px solid rgba(255,255,255,0.15)", borderTopColor: "#ec1c24", borderRadius: "50%", animation: "spin 0.9s linear infinite" }} />
      )}

      {/* Live badge */}
      {isLive && !idle && !booting && (
        <div className="absolute bottom-[90px] right-4 z-[25]" onClick={(e) => e.stopPropagation()}>
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-[#ec1c24] text-white text-[11px] font-extrabold rounded" style={{ animation: "pulse 1.2s infinite" }}>
            <span className="w-1.5 h-1.5 rounded-full bg-white" /> LIVE
          </span>
        </div>
      )}

      {/* Quality menu */}
      {menuOpen && qualityTracks.length > 0 && (
        <div className="vp-quality-menu" onClick={(e) => e.stopPropagation()}>
          <div className={`vp-qitem ${autoQuality ? "active" : ""}`} onClick={() => selectQuality(null)}>
            <span>Auto</span>{autoQuality && <span>✓</span>}
          </div>
          {qualityTracks.map((t: any) => (
            <div key={t.height} className={`vp-qitem ${!autoQuality && activeHeight === t.height ? "active" : ""}`} onClick={() => selectQuality(t.height)}>
              <span>{t.height}p</span>{!autoQuality && activeHeight === t.height && <span>✓</span>}
            </div>
          ))}
        </div>
      )}

      {/* Next button */}
      {nextLabel && !idle && !booting && (
        <div className="absolute bottom-[90px] right-4 z-[25]" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={() => onEnded?.()}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-black/70 border border-white/20 text-white font-bold text-xs hover:bg-white/10"
            style={{ fontFamily: "inherit" }}
          >
            ▶ <span className="max-w-[200px] truncate">{nextLabel}</span>
          </button>
        </div>
      )}

      {/* Controls */}
      <div className={`absolute left-0 right-0 bottom-0 z-[9] transition-opacity duration-300 ${idle ? "opacity-0 pointer-events-none" : ""}`} style={{ padding: "70px 20px 20px", background: "linear-gradient(to top, rgba(0,0,0,0.95), transparent)" }}>
        {/* Progress bar */}
        {!isLive && (
          <div ref={progressRef} className="vp-progress" onClick={handleProgressClick}>
            <div className="vp-progress-bg">
              <div className="vp-progress-buffered" style={{ width: `${buffered}%` }} />
              <div className="vp-progress-current" style={{ width: `${progressPct}%` }} />
            </div>
            <div className="vp-thumb" style={{ left: `${progressPct}%` }} />
          </div>
        )}

        {/* Button row */}
        <div className="flex items-center gap-1 text-white">
          <button className="w-[42px] h-[42px] rounded-full flex items-center justify-center hover:bg-white/15" onClick={(e) => { e.stopPropagation(); togglePlay(); }}>
            {paused ? (
              <svg viewBox="0 0 24 24" className="w-6 h-6 fill-white"><polygon points="6 4 20 12 6 20"/></svg>
            ) : (
              <svg viewBox="0 0 24 24" className="w-6 h-6 fill-white"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
            )}
          </button>
          <button className="w-[42px] h-[42px] rounded-full flex items-center justify-center hover:bg-white/15" onClick={(e) => { e.stopPropagation(); seek(-10); }}>
            <svg viewBox="0 0 24 24" className="w-6 h-6 fill-white"><path d="M11 18V6l-8.5 6 8.5 6zm.5-6l8.5 6V6l-8.5 6z"/></svg>
          </button>
          <button className="w-[42px] h-[42px] rounded-full flex items-center justify-center hover:bg-white/15" onClick={(e) => { e.stopPropagation(); seek(10); }}>
            <svg viewBox="0 0 24 24" className="w-6 h-6 fill-white" style={{ transform: "scaleX(-1)" }}><path d="M11 18V6l-8.5 6 8.5 6zm.5-6l8.5 6V6l-8.5 6z"/></svg>
          </button>

          {/* Time */}
          {!isLive && (
            <div className="text-xs px-1.5">{fmtTime(currentTime)} / {fmtTime(duration)}</div>
          )}

          <div className="flex-1" />

          {/* Quality button */}
          {qualityTracks.length > 0 && (
            <button className="w-[42px] h-[42px] rounded-full flex items-center justify-center hover:bg-white/15 text-white text-[10px] font-bold" onClick={(e) => { e.stopPropagation(); setMenuOpen(!menuOpen); }}>
              {autoQuality ? "AUTO" : `${activeHeight}p`}
            </button>
          )}

          {/* Fullscreen */}
          <button className="w-[42px] h-[42px] rounded-full flex items-center justify-center hover:bg-white/15" onClick={(e) => { e.stopPropagation(); toggleFs(); }}>
            <svg viewBox="0 0 24 24" className="w-6 h-6 fill-white"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg>
          </button>
        </div>
      </div>
    </div>
  );
}
