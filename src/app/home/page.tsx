"use client";

import { useState, useEffect, useCallback, useRef, lazy, Suspense } from "react";
import { Search, Tv } from "lucide-react";
import { ChannelCard } from "@/components/channel-card";
import { VodCard } from "@/components/vod-card";
import { LoginDialog } from "@/components/login-dialog";
import { VideoPlayer } from "@/components/video-player";
import { AppHeader } from "@/components/app-header";
import { BottomNav } from "@/components/bottom-nav";
import { getDeviceUid, checkAutoLogin } from "@/lib/auth";
import type { Channel, Category, VodItem } from "@/types";

const VodDetail = lazy(() => import("@/components/vod-detail").then((m) => ({ default: m.VodDetail })));
const EpgSchedule = lazy(() => import("@/components/epg-schedule").then((m) => ({ default: m.EpgSchedule })));

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
  licenseWv?: string;
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

export default function HomeAppPage() {
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
    checkAutoLogin().then((d) => {
      if (ctrl.signal.aborted) return;
      setSignedIn(d.signedIn);
      setAuthChecked(true);
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

    try {
      const deviceUid = await getDeviceUid();
      if (signal.aborted) return;
      const headers = { "x-device-uid": deviceUid };

      const resolveRes = await fetch(`/api/uid/resolve/${uid}`, { headers, signal });
      if (resolveRes.status === 401) { setStreamLoading(false); setPlayReq(null); setLoginOpen(true); return; }
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
      if (streamRes.status === 401) { setStreamLoading(false); setPlayReq(null); setLoginOpen(true); return; }
      if (!streamRes.ok) { setStreamError("Stream not available"); setStreamLoading(false); return; }

      const data = await streamRes.json();
      if (type === "catchup") data.isLive = false;
      pushUrl(`/home/watch/${uid}${begin ? `?begin=${begin}&end=${end}` : ""}`);
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
    if (scheduleChannel) pushUrl(`/home/?epg=${scheduleChannel.uid}`);
    else if (selectedVod) pushUrl(`/home/?detail=${selectedVod.uid}`);
    else pushUrl("/home");
  }, [scheduleChannel, selectedVod]);

  const handleOpenSchedule = useCallback((ch: Channel) => {
    setScheduleChannel(ch);
    pushUrl(`/home/?epg=${ch.uid}`);
  }, []);

  const handleCloseSchedule = useCallback(() => {
    setScheduleChannel(null);
    pushUrl("/home");
  }, []);

  const handleOpenVod = useCallback((item: VodItem) => {
    setSelectedVod(item);
    pushUrl(`/home/?detail=${item.uid}`);
  }, []);

  const handleCloseVod = useCallback(() => {
    setSelectedVod(null);
    pushUrl("/home");
  }, []);

  const [liveCategory, setLiveCategory] = useState("All");

  const CATEGORY_ORDER = ["local", "sports", "religious", "edutainment", "english entertainment", "hindi entertainment", "kids", "music", "tamil entertainment", "educational", "news", "others"];
  const liveCategories = CATEGORY_ORDER.filter((cat) => channels.some((c) => (c.category || "others") === cat));
  const filteredChannels = search
    ? channels.filter((c) => c.name.toLowerCase().includes(search.toLowerCase()))
    : liveCategory === "All"
      ? channels
      : channels.filter((c) => (c.category || "others") === liveCategory);

  const activeCatUid = currentTab.startsWith("cat:") ? currentTab.slice(4) : null;
  const activeCat = categories.find((c) => c.uid === activeCatUid);
  const activeCatItems = activeCatUid ? categoryItems[activeCatUid] || [] : [];
  const filteredCatItems = search
    ? activeCatItems.filter((i) => i.title.toLowerCase().includes(search.toLowerCase()))
    : activeCatItems;

  return (
    <div className="min-h-screen bg-[#0a0a0c]">
      {/* Header */}
      <AppHeader activePage="home" onSignIn={() => setLoginOpen(true)} />
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

      {/* Content */}
      <main className="max-w-[1600px] mx-auto px-4 sm:px-6 py-4 sm:py-6 pb-24 sm:pb-6">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-32 gap-4 text-white/50">
            <div className="w-10 h-10 border-3 border-white/10 border-t-[#ec1c24] rounded-full animate-spin" />
            <p className="text-sm">Loading…</p>
          </div>
        ) : currentTab === "live" ? (
          filteredChannels.length === 0 ? (
            <div className="text-center py-24 text-white/40">No channels</div>
          ) : (
            <>
              <div className="flex gap-1.5 items-center mb-4 overflow-x-auto no-scrollbar pb-1">
                {["All", ...liveCategories].map((cat) => {
                  const count = cat === "All" ? channels.length : channels.filter((c) => (c.category || "others") === cat).length;
                  return (
                    <button
                      key={cat}
                      onClick={() => setLiveCategory(cat)}
                      className={`px-3 py-1.5 rounded-lg text-[11px] sm:text-xs font-semibold transition-all whitespace-nowrap ${
                        liveCategory === cat
                          ? "bg-[#ec1c24] text-white"
                          : "bg-white/[0.04] text-white/45 hover:bg-white/[0.08] hover:text-white/75"
                      }`}
                    >
                      {cat}
                      <span className="ml-1 text-[9px] opacity-60">{count}</span>
                    </button>
                  );
                })}
              </div>
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
            </>
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
              <VideoPlayer
                streamUrl={streamData.url}
                licenseUrl={streamData.licenseWv}
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
          )}
        </div>
      )}

      {/* Sign-in dialog */}
      <LoginDialog open={loginOpen} onOpenChange={setLoginOpen} />

      <BottomNav activePage="home" />
    </div>
  );
}
