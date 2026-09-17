"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Search } from "lucide-react";
import { ChannelCard } from "@/components/channel-card";
import { VodCard } from "@/components/vod-card";
import { VodDetail } from "@/components/vod-detail";
import { EpgSchedule } from "@/components/epg-schedule";
import { VideoPlayer } from "@/components/video-player";
import { getDeviceUid } from "@/lib/auth";
import type { Channel, Category, VodItem } from "@/types";

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
        .then((d) => { if (!ctrl.signal.aborted) setSignedIn(d.signedIn || false); })
        .catch(() => {});
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
    <div className="min-h-screen bg-[#0f0f0f]">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-[#0f0f0f]/95 backdrop-blur-sm border-b border-white/5">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between">
          <h1 className="text-xl sm:text-2xl font-black tracking-tight">
            Zero<span className="text-[#ec1c24]">TV</span>
          </h1>
          <div className="flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-2 text-xs text-white/40 uppercase tracking-widest">
              <span className="w-2 h-2 rounded-full bg-[#22c55e] animate-pulse" /> Live · VOD
            </div>
            {signedIn && (
              <a href="/m3u" className="text-xs text-white/40 hover:text-white/70 transition-colors px-3 py-1.5 rounded-full border border-white/10 hover:border-white/20">
                M3U
              </a>
            )}
            {signedIn ? (
              <span className="text-xs text-[#22c55e] px-3 py-1.5 rounded-full border border-[#22c55e]/30">
                ✓ Signed In
              </span>
            ) : (
              <a href="/login" className="text-xs text-white/50 hover:text-white/80 transition-colors px-3 py-1.5 rounded-full border border-white/10 hover:border-white/20">
                Sign In
              </a>
            )}
          </div>
        </div>
        {/* Tabs */}
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 pb-3 overflow-x-auto no-scrollbar">
          <div className="flex gap-2 items-center">
            <button
              onClick={() => handleTabChange("live")}
              className={`flex items-center gap-2 px-3 sm:px-4 py-2 rounded-full text-xs sm:text-sm font-semibold transition-all whitespace-nowrap ${
                currentTab === "live"
                  ? "bg-[#ec1c24] text-white"
                  : "bg-white/5 text-white/60 hover:bg-white/10"
              }`}
            >
              📺 Live TV
              <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${currentTab === "live" ? "bg-black/25" : "bg-white/10"}`}>
                {channels.length}
              </span>
            </button>
            <span className="text-[10px] uppercase tracking-widest text-white/25 font-bold px-1 flex-shrink-0">
              Categories
            </span>
            {categories.map((c) => (
              <button
                key={c.uid}
                onClick={() => handleTabChange(`cat:${c.uid}`)}
                className={`flex items-center gap-2 px-3 py-2 rounded-full text-[11px] sm:text-xs font-semibold transition-all whitespace-nowrap ${
                  currentTab === `cat:${c.uid}`
                    ? "bg-[#8b5cf6] text-white"
                    : "bg-white/5 text-white/60 hover:bg-white/10"
                }`}
              >
                {c.name}
                <span className={`px-1.5 py-0.5 rounded-full text-[9px] font-bold ${currentTab === `cat:${c.uid}` ? "bg-black/25" : "bg-white/10"}`}>
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
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8 gap-2 sm:gap-3">
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
                  />
                ))}
              </div>
            </>
          )
        ) : (
          <div className="text-center py-24 text-white/40">Select a tab</div>
        )}
      </main>

      {/* ── LAYER 1: EPG Schedule overlay ── */}
      {scheduleChannel && (
        <EpgSchedule
          channel={scheduleChannel}
          onClose={handleCloseSchedule}
          onPlay={handlePlayFromSchedule}
          onCatchup={handleCatchupFromSchedule}
        />
      )}

      {/* ── LAYER 1b: Movie/Series detail overlay ── */}
      {selectedVod && (
        <VodDetail
          uid={selectedVod.uid}
          type={selectedVod.type as "movie" | "series"}
          onClose={handleCloseVod}
          onPlay={(uid, type, queue, meta) => handlePlayFromDetail(uid, type, queue, meta)}
        />
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
            <VideoPlayer
              streamUrl={streamData.url}
              licenseUrl={streamData.license}
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
          )}
        </div>
      )}
    </div>
  );
}
