"use client";

import { useState, useEffect, useCallback, useRef, lazy, Suspense } from "react";
import { Search, Tv, Film, Clapperboard, Monitor, Smartphone, Tablet, Laptop, LayoutGrid, Radio, Globe, Play, ChevronDown } from "lucide-react";
import { ChannelCard } from "@/components/channel-card";
import { VodCard } from "@/components/vod-card";
import { LoginDialog } from "@/components/login-dialog";
import { getDeviceUid } from "@/lib/auth";
import type { Channel, Category, VodItem } from "@/types";

const VodDetail = lazy(() => import("@/components/vod-detail").then((m) => ({ default: m.VodDetail })));
const EpgSchedule = lazy(() => import("@/components/epg-schedule").then((m) => ({ default: m.EpgSchedule })));
const VideoPlayer = lazy(() => import("@/components/video-player").then((m) => ({ default: m.VideoPlayer })));

interface EpgNow {
  now: { start: string; end: string; title: string; img: number | null } | null;
  next: { start: string; end: string; title: string } | null;
}

interface PlayQueueItem {
  uid: string;
  title: string;
  thumb?: number | null;
  begin?: string;
  end?: string;
}

interface PlayQueue {
  kind: "series" | "catchup";
  index: number;
  items: PlayQueueItem[];
}

interface PlayRequest {
  uid: string;
  type: string;
  begin?: string;
  end?: string;
  title?: string;
  programTitle?: string;
}

interface StreamData {
  url: string;
  license: string;
  licenseFp?: string;
  isLive: boolean;
}

interface PreloadedMeta {
  title: string;
  subtitle: string;
  bannerId: number | null;
}

function fmtStreamTime(iso: string) {
  const d = new Date(iso), p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
}

function pushUrl(path: string) {
  window.history.pushState(null, "", path);
}

export default function HomePage() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryItems, setCategoryItems] = useState<Record<string, VodItem[]>>({});
  const [currentTab, setCurrentTab] = useState("live");
  const [search, setSearch] = useState("");
  const [epgNow, setEpgNow] = useState<Record<string, EpgNow>>({});
  const [loading, setLoading] = useState(true);
  const [signedIn, setSignedIn] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [showLanding, setShowLanding] = useState(true);
  const [copyrightAcknowledged, setCopyrightAcknowledged] = useState(false);

  // Overlay layers
  const [scheduleChannel, setScheduleChannel] = useState<Channel | null>(null);
  const [selectedVod, setSelectedVod] = useState<VodItem | null>(null);

  // Player state (top layer)
  const [playReq, setPlayReq] = useState<PlayRequest | null>(null);
  const [streamData, setStreamData] = useState<StreamData | null>(null);
  const [streamMeta, setStreamMeta] = useState<{ title: string; subtitle: string; bannerId: number | null }>({ title: "Loading…", subtitle: "", bannerId: null });
  const [streamLoading, setStreamLoading] = useState(false);
  const [streamError, setStreamError] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const [playQueue, setPlayQueue] = useState<PlayQueue | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    async function load() {
      try {
        const [catsRes, chsRes] = await Promise.all([
          fetch("/api/data/categories", { signal: ctrl.signal }).then((r) => r.json()),
          fetch("/api/data/channels", { signal: ctrl.signal }).then((r) => r.json()),
        ]);
        if (!ctrl.signal.aborted) {
          setCategories(catsRes.categories || []);
          setChannels(chsRes.channels || []);
        }
      } catch (e) {
        if ((e as Error).name !== "AbortError") console.error("Load failed:", e);
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    }
    load();
    fetch("/api/epg/now", { signal: ctrl.signal })
      .then((r) => r.json())
      .then((d) => { if (!ctrl.signal.aborted) setEpgNow(d.now || {}); })
      .catch(() => {});
    getDeviceUid().then((uid) => {
      fetch("/api/auth/state", { headers: { "x-device-uid": uid }, signal: ctrl.signal })
        .then((r) => r.json())
        .then((d) => { if (!ctrl.signal.aborted) { setSignedIn(d.signedIn || false); setAuthChecked(true); } })
        .catch(() => { if (!ctrl.signal.aborted) setAuthChecked(true); });
    });
    const interval = setInterval(() => {
      fetch("/api/epg/now")
        .then((r) => r.json())
        .then((d) => setEpgNow(d.now || {}))
        .catch(() => {});
    }, 60000);
    return () => { ctrl.abort(); clearInterval(interval); };
  }, []);

  // Handle browser back button
  useEffect(() => {
    const handler = () => {
      const path = window.location.pathname;
      const params = new URLSearchParams(window.location.search);
      if (params.get("play")) {
        // Will be handled by useEffect below
      } else if (params.get("epg")) {
        // Will be handled by useEffect below
      } else if (params.get("detail")) {
        // Will be handled by useEffect below
      } else {
        setPlayReq(null);
        setStreamData(null);
        setScheduleChannel(null);
        setSelectedVod(null);
      }
    };
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, []);

  // Handle ?detail= on initial load
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const detailUid = params.get("detail");
    if (detailUid && !selectedVod) {
      const type = detailUid.startsWith("s") ? "series" : "movie";
      setSelectedVod({ uid: detailUid, title: "", type, poster: null, year: null, duration: null, category: null });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Handle ?epg= on initial load
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const epgUid = params.get("epg");
    if (epgUid && channels.length && !scheduleChannel) {
      const ch = channels.find((c) => c.uid === epgUid);
      if (ch) setScheduleChannel(ch);
    }
  }, [channels.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadCategory = useCallback(async (catUid: string) => {
    if (categoryItems[catUid]) return;
    try {
      const res = await fetch(`/api/data/categories/${encodeURIComponent(catUid)}`);
      if (!res.ok) return;
      const data = await res.json();
      setCategoryItems((prev) => ({ ...prev, [catUid]: data.items || [] }));
    } catch {}
  }, [categoryItems]);

  const handleTabChange = (tab: string) => {
    setCurrentTab(tab);
    if (tab.startsWith("cat:")) {
      loadCategory(tab.slice(4));
    }
  };

  // Play handler — opens player overlay on top of everything
  const handlePlay = useCallback(async (uid: string, type: string, begin?: string, end?: string, programTitle?: string, preloadedMeta?: PreloadedMeta) => {
    setPlayReq({ uid, type, begin, end, programTitle });
    setStreamData(null);
    setStreamError("");
    setStreamLoading(true);
    setStreamMeta(preloadedMeta || { title: "Loading…", subtitle: "", bannerId: null });
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    const signal = abortRef.current.signal;

    pushUrl(`/watch/${uid}${begin ? `?begin=${begin}&end=${end}` : ""}`);

    try {
      const deviceUid = await getDeviceUid();
      if (signal.aborted) return;
      const headers = { "x-device-uid": deviceUid };

      const resolveRes = await fetch(`/api/uid/resolve/${uid}`, { headers, signal });
      if (resolveRes.status === 401) { window.location.href = "/login"; return; }
      if (!resolveRes.ok) { setStreamError("Stream not found"); setStreamLoading(false); return; }
      const ref = await resolveRes.json();

      let streamUrl: string;
      if (begin && end) {
        streamUrl = `/api/stream/catchup/${uid}?begin=${begin}&end=${end}`;
      } else {
        const typeMap: Record<string, string> = { c: "live", m: "movie", e: "episode", k: "movie" };
        const endpoint = typeMap[ref.type];
        if (!endpoint) { setStreamError("Unknown content type"); setStreamLoading(false); return; }
        streamUrl = `/api/stream/${endpoint}/${uid}`;
      }

      const streamRes = await fetch(streamUrl, { headers, signal });
      if (signal.aborted) return;
      if (streamRes.status === 401) { window.location.href = "/login"; return; }
      if (!streamRes.ok) { setStreamError("Stream not available"); setStreamLoading(false); return; }

      const data = await streamRes.json();
      if (type === "catchup") data.isLive = false;
      setStreamData(data);

      // Set metadata — use preloaded or existing epgNow state instead of re-fetching
      if (preloadedMeta) {
        setStreamMeta(preloadedMeta);
      } else {
        try {
          if (ref.type === "c") {
            const ch = channels.find((c) => c.uid === uid);
            if (ch) {
              if (type === "catchup" && programTitle) {
                setStreamMeta({
                  title: `${ch.name} — ${programTitle}`,
                  subtitle: `⏪ Catchup`,
                  bannerId: ch.logo,
                });
              } else {
                // Reuse existing epgNow instead of re-fetching /api/epg/now
                const now = epgNow[uid]?.now;
                setStreamMeta({
                  title: now ? `${ch.name} — ${now.title}` : ch.name,
                  subtitle: ch.resolution || "",
                  bannerId: now?.img || ch.logo,
                });
              }
            } else {
              setStreamMeta({ title: "Live TV", subtitle: "", bannerId: null });
            }
          } else if (ref.type === "m" || ref.type === "k") {
            const dRes = await fetch(`/api/details/movie/${uid}`, { headers, signal });
            if (dRes.ok) {
              const d = await dRes.json();
              setStreamMeta({ title: d.title || "Movie", subtitle: [d.year, d.resolution].filter(Boolean).join(" · "), bannerId: d.poster });
            }
          } else if (ref.type === "e") {
            if (ref.seriesUid) {
              const dRes = await fetch(`/api/details/series/${ref.seriesUid}`, { headers, signal });
              if (dRes.ok) {
                const d = await dRes.json();
                const ep = (d.episodes || []).find((e: any) => e.uid === uid);
                setStreamMeta({
                  title: ep ? `${d.title} — S${ep.season}E${ep.number}` : d.title || "Episode",
                  subtitle: "",
                  bannerId: ep?.thumb || d.poster,
                });
              }
            }
          }
        } catch {}
      }
    } catch (e: any) {
      if (e?.name !== "AbortError") setStreamError("Failed to load stream");
    } finally {
      if (!signal.aborted) setStreamLoading(false);
    }
  }, [channels, epgNow]);

  const handlePlayFromDetail = useCallback((uid: string, type: string, queue?: PlayQueue, meta?: PreloadedMeta) => {
    if (queue) setPlayQueue(queue);
    if (type === "trailer") handlePlay(uid, "trailer");
    else handlePlay(uid, type, undefined, undefined, undefined, meta);
  }, [handlePlay]);

  const handlePlayFromSchedule = useCallback((uid: string) => {
    handlePlay(uid, "live");
  }, [handlePlay]);

  const handleCatchupFromSchedule = useCallback((chUid: string, begin: string, end: string, title: string, queue?: PlayQueue) => {
    if (queue) setPlayQueue(queue);
    handlePlay(chUid, "catchup", fmtStreamTime(begin), fmtStreamTime(end), title);
  }, [handlePlay]);

  // Auto-next handler
  const handlePlayerEnded = useCallback(() => {
    if (!playQueue) return;
    const nextIdx = playQueue.index + 1;
    if (nextIdx >= playQueue.items.length) { setPlayQueue(null); return; }
    const next = playQueue.items[nextIdx];
    setPlayQueue({ ...playQueue, index: nextIdx });
    if (playQueue.kind === "series") {
      handlePlay(next.uid, "episode", undefined, undefined, next.title);
    } else if (playQueue.kind === "catchup" && next.begin && next.end) {
      handlePlay(next.uid, "catchup", fmtStreamTime(next.begin), fmtStreamTime(next.end), next.title);
    }
  }, [playQueue, handlePlay]);

  const handlePlayerBack = useCallback(() => {
    setPlayReq(null);
    setStreamData(null);
    setStreamError("");
    setPlayQueue(null);
    if (scheduleChannel) pushUrl(`/?epg=${scheduleChannel.uid}`);
    else if (selectedVod) pushUrl(`/?detail=${selectedVod.uid}`);
    else pushUrl("/");
  }, [scheduleChannel, selectedVod]);

  const handleOpenSchedule = useCallback((ch: Channel) => {
    setScheduleChannel(ch);
    pushUrl(`/?epg=${ch.uid}`);
  }, []);

  const handleCloseSchedule = useCallback(() => {
    setScheduleChannel(null);
    pushUrl("/");
  }, []);

  const handleOpenVod = useCallback((item: VodItem) => {
    setSelectedVod(item);
    pushUrl(`/?detail=${item.uid}`);
  }, []);

  const handleCloseVod = useCallback(() => {
    setSelectedVod(null);
    pushUrl("/");
  }, []);

  const filteredChannels = search
    ? channels.filter((c) => c.name.toLowerCase().includes(search.toLowerCase()))
    : channels;

  const activeCatUid = currentTab.startsWith("cat:") ? currentTab.slice(4) : null;
  const activeCat = categories.find((c) => c.uid === activeCatUid);
  const activeCatItems = activeCatUid ? categoryItems[activeCatUid] || [] : [];
  const filteredCatItems = search
    ? activeCatItems.filter((i) => i.title.toLowerCase().includes(search.toLowerCase()))
    : activeCatItems;

  return (
    <div className="min-h-screen bg-[#0a0a0c]">
      {/* Landing page */}
      {showLanding && (
        <div className="fixed inset-0 z-[80] flex flex-col bg-[#0a0a0c] overflow-y-auto">
          {/* Hero */}
          <div className="relative min-h-[100dvh] flex flex-col">
            {/* Ambient glow */}
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[600px] bg-[#ec1c24]/8 rounded-full blur-[120px] pointer-events-none" />
            <div className="absolute bottom-0 right-0 w-[400px] h-[400px] bg-[#ec1c24]/5 rounded-full blur-[100px] pointer-events-none" />

            {/* Nav */}
            <nav className="relative z-10 flex items-center justify-between px-6 sm:px-10 py-5">
              <img src="/lanka_tv_logo.png" alt="LankaTV" className="h-8 sm:h-10" />
              <div className="flex items-center gap-3">
                <a href="#features" className="text-sm text-white/50 hover:text-white transition-colors font-medium hidden sm:block">Features</a>
                <a href="#devices" className="text-sm text-white/50 hover:text-white transition-colors font-medium hidden sm:block">Devices</a>
                {authChecked && (
                  signedIn ? (
                    <button onClick={() => setShowLanding(false)} className="text-sm text-white/80 hover:text-white px-4 py-2 rounded-xl bg-[#ec1c24] hover:bg-[#d41a20] transition-all font-bold shadow-[0_2px_10px_rgba(236,28,36,0.3)]">
                      Watch Now
                    </button>
                  ) : (
                    <button onClick={() => { setShowLanding(false); setLoginOpen(true); }} className="text-sm text-white/80 hover:text-white px-4 py-2 rounded-xl border border-white/10 hover:border-white/20 transition-all font-semibold">
                      Sign In
                    </button>
                  )
                )}
              </div>
            </nav>

            {/* Hero content */}
            <div className="relative z-10 flex-1 flex flex-col items-center justify-center text-center px-6 pb-12">
              <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-[#ec1c24]/10 border border-[#ec1c24]/20 mb-8">
                <span className="w-1.5 h-1.5 rounded-full bg-[#ec1c24] animate-pulse" />
                <span className="text-xs text-[#ec1c24] font-bold uppercase tracking-wider">Live Now</span>
              </div>

              <h1 className="text-4xl sm:text-6xl md:text-7xl lg:text-8xl font-black text-white leading-[0.95] tracking-tight mb-6">
                Stream<br />
                <span className="text-[#ec1c24]">Anything.</span><br />
                <span className="text-white/30">Anywhere.</span>
              </h1>

              <p className="text-base sm:text-lg text-white/40 max-w-md leading-relaxed mb-10 font-medium">
                Live TV, Movies & Series — on any device. Smart TV, iPhone, Laptop, TiviMate, or your browser. No app needed.
              </p>

              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full sm:w-auto">
                {authChecked && (
                  signedIn ? (
                    <>
                      <button
                        onClick={() => setShowLanding(false)}
                        className="px-8 py-3.5 rounded-xl bg-[#ec1c24] text-white font-bold text-base hover:bg-[#d41a20] transition-all shadow-[0_4px_24px_rgba(236,28,36,0.4)] active:scale-[0.97] flex items-center justify-center gap-2"
                      >
                        <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5"><polygon points="6 4 20 12 6 20"/></svg>
                        Watch Now
                      </button>
                      <a
                        href="https://t.me/+rsIXSZEUUIM2OWNl"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-8 py-3.5 rounded-xl bg-[#0088cc]/10 text-[#5ea9e8] font-bold text-base border border-[#0088cc]/30 hover:bg-[#0088cc]/20 hover:border-[#0088cc]/50 transition-all flex items-center justify-center gap-2"
                      >
                        <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5"><path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></svg>
                        Join Telegram
                      </a>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => { setShowLanding(false); setLoginOpen(true); }}
                        className="px-8 py-3.5 rounded-xl bg-[#ec1c24] text-white font-bold text-base hover:bg-[#d41a20] transition-all shadow-[0_4px_24px_rgba(236,28,36,0.4)] active:scale-[0.97] flex items-center justify-center gap-2"
                      >
                        <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5"><polygon points="6 4 20 12 6 20"/></svg>
                        Start Watching
                      </button>
                      <a
                        href="https://t.me/+rsIXSZEUUIM2OWNl"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-8 py-3.5 rounded-xl bg-[#0088cc]/10 text-[#5ea9e8] font-bold text-base border border-[#0088cc]/30 hover:bg-[#0088cc]/20 hover:border-[#0088cc]/50 transition-all flex items-center justify-center gap-2"
                      >
                        <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5"><path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></svg>
                        Join Telegram
                      </a>
                    </>
                  )
                )}
              </div>

              {/* Scroll indicator */}
              <div className="mt-16 flex flex-col items-center gap-2 text-white/20">
                <span className="text-xs font-semibold uppercase tracking-widest">Scroll to explore</span>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5 animate-bounce"><path d="m6 9 6 6 6-6"/></svg>
              </div>
            </div>
          </div>

          {/* Features */}
          <div id="features" className="relative z-10 px-6 sm:px-10 py-8 sm:py-12 border-t border-white/[0.04]">
            <div className="max-w-5xl mx-auto">
              <div className="text-center mb-8">
                <h2 className="text-3xl sm:text-4xl font-black text-white mb-2">Everything you need</h2>
                <p className="text-sm text-white/30">One subscription. All your entertainment.</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {[
                  { icon: <Radio className="w-7 h-7" />, title: "Live TV", desc: "Hundreds of live channels with real-time EPG and catchup" },
                  { icon: <Film className="w-7 h-7" />, title: "Movies", desc: "Latest movies in HD, FHD & 4K with DRM protection" },
                  { icon: <Clapperboard className="w-7 h-7" />, title: "Series", desc: "Full series with auto-play next and episode queue" },
                ].map((f) => (
                  <div key={f.title} className="group relative p-6 rounded-2xl bg-white/[0.02] border border-white/[0.06] hover:border-[#ec1c24]/30 transition-all overflow-hidden">
                    <div className="absolute inset-0 bg-gradient-to-br from-[#ec1c24]/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                    <div className="relative flex flex-col items-start text-left">
                      <div className="w-12 h-12 rounded-xl bg-[#ec1c24]/10 border border-[#ec1c24]/20 flex items-center justify-center text-[#ec1c24] mb-4">
                        {f.icon}
                      </div>
                      <h3 className="text-base font-bold text-white mb-1.5">{f.title}</h3>
                      <p className="text-xs text-white/40 leading-relaxed">{f.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Devices */}
          <div id="devices" className="relative z-10 px-6 sm:px-10 py-6 sm:py-10 border-t border-white/[0.04]">
            <div className="max-w-4xl mx-auto text-center">
              <p className="text-[10px] uppercase tracking-[0.2em] text-[#ec1c24] font-bold mb-2">Compatible Devices</p>
              <h2 className="text-2xl sm:text-3xl font-black text-white mb-5">Watch on any screen</h2>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-white/[0.04] rounded-2xl overflow-hidden">
                {[
                  { icon: <Tv className="w-6 h-6" />, name: "Smart TV" },
                  { icon: <Monitor className="w-6 h-6" />, name: "Desktop" },
                  { icon: <Smartphone className="w-6 h-6" />, name: "iPhone" },
                  { icon: <LayoutGrid className="w-6 h-6" />, name: "TiviMate" },
                  { icon: <Radio className="w-6 h-6" />, name: "OTT" },
                  { icon: <Laptop className="w-6 h-6" />, name: "MacBook" },
                  { icon: <Tablet className="w-6 h-6" />, name: "iPad" },
                  { icon: <Globe className="w-6 h-6" />, name: "Browser" },
                ].map((d) => (
                  <div key={d.name} className="flex flex-col items-center gap-2 py-6 px-3 bg-[#0a0a0c] hover:bg-white/[0.03] transition-colors">
                    <span className="text-white/50">{d.icon}</span>
                    <span className="text-xs text-white/50 font-semibold">{d.name}</span>
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-white/20 mt-4">No app needed — works in any browser or via M3U playlist</p>
            </div>
          </div>

          {/* CTA */}
          <div className="relative z-10 px-6 sm:px-10 py-8 sm:py-12 border-t border-white/[0.04]">
            <div className="max-w-2xl mx-auto text-center">
              <p className="text-[10px] uppercase tracking-[0.2em] text-[#ec1c24] font-bold mb-2">Get Started</p>
              <h2 className="text-2xl sm:text-3xl font-black text-white mb-3">Ready to stream?</h2>
              <p className="text-sm text-white/35 mb-6">{signedIn ? "You're all set. Start watching now." : "Get your M3U playlist or sign in to start watching on any device."}</p>
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-3 w-full sm:w-auto">
                {authChecked && (
                  signedIn ? (
                    <>
                      <button
                        onClick={() => setShowLanding(false)}
                        className="px-8 py-3.5 rounded-xl bg-[#ec1c24] text-white font-bold text-base hover:bg-[#d41a20] transition-all shadow-[0_4px_24px_rgba(236,28,36,0.4)] active:scale-[0.97] flex items-center justify-center gap-2"
                      >
                        <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5"><polygon points="6 4 20 12 6 20"/></svg>
                        Watch Now
                      </button>
                      <a
                        href="https://t.me/+rsIXSZEUUIM2OWNl"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-8 py-3.5 rounded-xl bg-[#0088cc]/10 text-[#5ea9e8] font-bold text-base border border-[#0088cc]/30 hover:bg-[#0088cc]/20 hover:border-[#0088cc]/50 transition-all flex items-center justify-center gap-2"
                      >
                        <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5"><path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></svg>
                        Join Telegram
                      </a>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => { setShowLanding(false); setLoginOpen(true); }}
                        className="px-8 py-3.5 rounded-xl bg-[#ec1c24] text-white font-bold text-base hover:bg-[#d41a20] transition-all shadow-[0_4px_24px_rgba(236,28,36,0.4)] active:scale-[0.97] flex items-center justify-center gap-2"
                      >
                        <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5"><polygon points="6 4 20 12 6 20"/></svg>
                        Start Watching
                      </button>
                      <a
                        href="https://t.me/+rsIXSZEUUIM2OWNl"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-8 py-3.5 rounded-xl bg-[#0088cc]/10 text-[#5ea9e8] font-bold text-base border border-[#0088cc]/30 hover:bg-[#0088cc]/20 hover:border-[#0088cc]/50 transition-all flex items-center justify-center gap-2"
                      >
                        <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5"><path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></svg>
                        Join Telegram
                      </a>
                    </>
                  )
                )}
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="relative z-10 px-6 sm:px-10 py-6 border-t border-white/[0.04]">
            <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
              <span className="text-xs font-bold text-white/30">LankaTV</span>
              <p className="text-[10px] text-white/15">Stream anywhere. Any device. Anytime.</p>
            </div>
          </div>
        </div>
      )}

      {/* Copyright Notice Overlay */}
      {showLanding && !copyrightAcknowledged && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/80 backdrop-blur-sm px-4">
          <div className="w-full max-w-lg bg-[#111113] border border-white/[0.08] rounded-2xl p-6 sm:p-8 shadow-2xl">
            <div className="text-center mb-5">
              <div className="w-12 h-12 rounded-full bg-[#ec1c24]/10 border border-[#ec1c24]/20 flex items-center justify-center mx-auto mb-4">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-6 h-6 text-[#ec1c24]"><path d="M12 9v4m0 4h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"/></svg>
              </div>
              <h3 className="text-lg font-bold text-white mb-1">Important Notice</h3>
              <p className="text-xs text-white/40">To Broadcasters & Content Owners</p>
            </div>
            <div className="space-y-3 text-sm text-white/50 leading-relaxed mb-6">
              <p>If you are a <span className="text-white/70 font-medium">copyright owner, broadcaster, or authorized representative</span> and have any concerns, issues, or takedown requests regarding any channel or content on LankaTV:</p>
              <p>Please contact me directly. <span className="text-[#ec1c24] font-medium">I will not hesitate to take down or stop the site immediately.</span> A single request from you is more than enough — I will stop it right away because I truly respect your rights and work.</p>
            </div>

            <div className="flex flex-col sm:flex-row gap-3">
                <a
                  href="https://t.me/yakalk_bot?text=hello"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 py-3 rounded-xl bg-[#22c55e]/10 text-[#22c55e] font-bold text-sm border border-[#22c55e]/30 hover:bg-[#22c55e]/20 hover:border-[#22c55e]/50 transition-all flex items-center justify-center gap-2"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                  Contact
                </a>
                <button
                  onClick={() => setCopyrightAcknowledged(true)}
                  className="flex-1 py-3 rounded-xl bg-[#ec1c24]/10 text-[#ec1c24] font-bold text-sm border border-[#ec1c24]/30 hover:bg-[#ec1c24]/20 hover:border-[#ec1c24]/50 transition-all"
                >
                  I Understand &amp; Continue
                </button>
              </div>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="sticky top-0 z-40 bg-[#0a0a0c]/95 backdrop-blur-md border-b border-white/[0.04]">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <img src="/lanka_tv_logo.png" alt="LankaTV" className="h-8 sm:h-9" />
          </div>
          <div className="flex items-center gap-2">
            <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/[0.04] border border-white/[0.06]">
              <span className="w-1.5 h-1.5 rounded-full bg-[#22c55e] animate-pulse" />
              <span className="text-[10px] text-white/40 font-semibold">LIVE</span>
            </div>
            <a
              href={signedIn ? "/m3u" : "/login"}
              className={`text-xs transition-all px-3 py-1.5 rounded-lg font-semibold border ${
                signedIn
                  ? "text-white/50 hover:text-white border-[#ec1c24]/30 hover:border-[#ec1c24]/60 hover:bg-[#ec1c24]/10"
                  : "text-white/30 border-white/[0.06] hover:border-white/[0.12]"
              }`}
            >
              M3U
            </a>
            <a
              href="https://t.me/yakalk_bot?text=hello"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-[#22c55e] hover:text-white transition-all px-3 py-1.5 rounded-lg border border-[#22c55e]/20 hover:border-[#22c55e]/50 hover:bg-[#22c55e]/10 font-semibold flex items-center gap-1.5"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
              <span className="hidden sm:inline">Contact</span>
            </a>
            {authChecked && (signedIn ? (
              <span className="text-xs text-[#22c55e] px-3 py-1.5 rounded-lg border border-[#22c55e]/20 bg-[#22c55e]/5 font-semibold">
                ✓ Signed In
              </span>
            ) : (
              <button
                onClick={() => setLoginOpen(true)}
                className="text-xs text-white/50 hover:text-white transition-all px-3 py-1.5 rounded-lg border border-white/[0.06] hover:border-white/[0.12] hover:bg-white/[0.04] font-semibold"
              >
                Sign In
              </button>
            ))}
          </div>
        </div>
        {/* Tabs */}
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 pb-3 overflow-x-auto no-scrollbar">
          <div className="flex gap-1.5 items-center">
            <button
              onClick={() => handleTabChange("live")}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs sm:text-sm font-bold transition-all whitespace-nowrap ${
                currentTab === "live"
                  ? "bg-[#ec1c24] text-white shadow-[0_2px_12px_rgba(236,28,36,0.4)]"
                  : "bg-white/[0.04] text-white/50 hover:bg-white/[0.08] hover:text-white/80"
              }`}
            >
              <Tv className="w-4 h-4" /> Live TV
              <span className={`px-1.5 py-0.5 rounded text-[9px] font-extrabold ${currentTab === "live" ? "bg-white/20" : "bg-white/[0.06]"}`}>
                {channels.length}
              </span>
            </button>
            <div className="w-px h-5 bg-white/10 mx-1 flex-shrink-0" />
            {categories.map((c) => (
              <button
                key={c.uid}
                onClick={() => handleTabChange(`cat:${c.uid}`)}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-[11px] sm:text-xs font-semibold transition-all whitespace-nowrap ${
                  currentTab === `cat:${c.uid}`
                    ? "bg-white/[0.12] text-white border border-white/[0.15] shadow-[0_2px_8px_rgba(0,0,0,0.3)]"
                    : "bg-white/[0.03] text-white/45 hover:bg-white/[0.07] hover:text-white/75 border border-transparent"
                }`}
              >
                {c.name}
                <span className={`px-1 py-0.5 rounded text-[8px] font-extrabold ${currentTab === `cat:${c.uid}` ? "bg-white/15 text-white/80" : "bg-white/[0.05] text-white/30"}`}>
                  {c.total}
                </span>
              </button>
            ))}
          </div>
        </div>
        {/* Search */}
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 pb-3 sm:pb-4">
          <div className="relative max-w-md">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
            <input
              type="text"
              placeholder="Search…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-11 pr-4 py-2.5 bg-white/5 border border-white/10 rounded-full text-sm text-white placeholder-white/30 outline-none focus:border-[#ec1c24]"
            />
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-[1600px] mx-auto px-4 sm:px-6 py-4 sm:py-6">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-32 gap-4 text-white/50">
            <div className="w-10 h-10 border-3 border-white/10 border-t-[#ec1c24] rounded-full animate-spin" />
            <p className="text-sm">Loading…</p>
          </div>
        ) : currentTab === "live" ? (
          filteredChannels.length === 0 ? (
            <div className="text-center py-24 text-white/40">No channels</div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8 gap-2 sm:gap-3">
              {filteredChannels.map((ch) => (
                <ChannelCard
                  key={ch.uid}
                  channel={ch}
                  epg={epgNow[ch.uid]}
                  onWatch={() => handlePlay(ch.uid, "live")}
                  onSchedule={() => handleOpenSchedule(ch)}
                />
              ))}
            </div>
          )
        ) : activeCatUid ? (
          filteredCatItems.length === 0 ? (
            <div className="text-center py-24 text-white/40">No content</div>
          ) : (
            <>
              <div className="mb-4 flex items-baseline gap-3">
                <h2 className="text-lg sm:text-xl font-extrabold">{activeCat?.name}</h2>
                <span className="text-[11px] text-white/40 font-semibold">{filteredCatItems.length} items</span>
              </div>
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-7 xl:grid-cols-9 2xl:grid-cols-10 gap-2 sm:gap-3">
                {filteredCatItems.map((item) => (
                  <VodCard
                    key={item.uid}
                    item={item}
                    onPlay={() => handleOpenVod(item)}
                    onDirectPlay={item.type !== "series" ? () => handlePlay(item.uid, "movie") : undefined}
                  />
                ))}
              </div>
            </>
          )
        ) : (
          <div className="text-center py-24 text-white/40">Select a tab</div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-white/[0.04] mt-6">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 py-5">
          <div className="flex flex-col sm:flex-row items-center justify-center gap-2">
            <span className="text-xs font-bold text-white/30">LankaTV</span>
            <span className="text-white/10 hidden sm:inline">·</span>
            <p className="text-[10px] text-white/15">Stream anywhere. Any device. Anytime.</p>
          </div>
        </div>
      </footer>

      {/* ── LAYER 1: EPG Schedule overlay ── */}
      {scheduleChannel && (
        <Suspense>
          <EpgSchedule
            channel={scheduleChannel}
            onClose={handleCloseSchedule}
            onPlay={handlePlayFromSchedule}
            onCatchup={handleCatchupFromSchedule}
          />
        </Suspense>
      )}

      {/* ── LAYER 1b: Movie/Series detail overlay ── */}
      {selectedVod && (
        <Suspense>
          <VodDetail
            uid={selectedVod.uid}
            type={selectedVod.type as "movie" | "series"}
            fallbackTitle={selectedVod.title}
            fallbackPoster={selectedVod.poster}
            onClose={handleCloseVod}
            onPlay={(uid, type, queue, meta) => handlePlayFromDetail(uid, type, queue, meta)}
          />
        </Suspense>
      )}

      {/* ── LAYER 2: Player overlay (on top of everything) ── */}
      {playReq && (
        <div className="fixed inset-0 z-[60]">
          {streamLoading && !streamData && (
            <div className="min-h-screen bg-black flex flex-col items-center justify-center gap-4 text-white/50">
              <div className="w-14 h-14 border-4 border-white/10 border-t-[#ec1c24] rounded-full animate-spin" />
              <p className="text-sm">Loading stream…</p>
            </div>
          )}
          {streamError && (
            <div className="min-h-screen bg-black flex flex-col items-center justify-center gap-4 text-white/50">
              <p className="text-red-400">{streamError}</p>
              <button onClick={handlePlayerBack} className="px-6 py-2 bg-[#ec1c24] rounded-full font-semibold text-sm">Go Back</button>
            </div>
          )}
          {streamData && (
            <Suspense>
              <VideoPlayer
                streamUrl={streamData.url}
                licenseUrl={streamData.license}
                licenseFp={streamData.licenseFp}
                title={streamMeta.title}
                subtitle={streamMeta.subtitle}
                bannerId={streamMeta.bannerId}
                isLive={streamData.isLive}
                onBack={handlePlayerBack}
                onEnded={handlePlayerEnded}
                nextLabel={
                  playQueue && playQueue.index < playQueue.items.length - 1
                    ? `Next · ${playQueue.items[playQueue.index + 1].title.slice(0, 30)} (${playQueue.index + 2}/${playQueue.items.length})`
                    : undefined
                }
              />
            </Suspense>
          )}
        </div>
      )}

      {/* Sign-in dialog */}
      <LoginDialog open={loginOpen} onOpenChange={setLoginOpen} />
    </div>
  );
}
