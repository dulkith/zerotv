"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { VideoPlayer } from "@/components/video-player";
import { getDeviceUid } from "@/lib/auth";
import type { StreamToken } from "@/types";
import { imgUrl } from "@/lib/viu";

const TYPE_MAP: Record<string, string> = { c: "live", m: "movie", e: "episode", k: "movie" };

export default function WatchPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const uid = params?.uid as string;
  const [streamData, setStreamData] = useState<StreamToken | null>(null);
  const [meta, setMeta] = useState<{ title: string; subtitle: string; bannerId: number | null }>({ title: "Loading…", subtitle: "", bannerId: null });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const loadStream = useCallback(async (signal?: AbortSignal) => {
    if (!uid) return;
    setLoading(true);
    setError("");
    try {
      const deviceUid = await getDeviceUid();
      const headers = { "x-device-uid": deviceUid };
      const begin = searchParams.get("begin");
      const end = searchParams.get("end");

      const resolveRes = await fetch(`/api/uid/resolve/${uid}`, { headers, signal });
      if (resolveRes.status === 401) { window.location.href = "/?signin=1"; return; }
      if (!resolveRes.ok) { setError("Stream not found"); setLoading(false); return; }

      const ref = await resolveRes.json();

      let streamUrl: string;
      if (begin && end) {
        streamUrl = `/api/stream/catchup/${uid}?begin=${begin}&end=${end}`;
      } else {
        const streamType = TYPE_MAP[ref.type];
        if (!streamType) { setError("Unknown content type"); setLoading(false); return; }
        streamUrl = `/api/stream/${streamType}/${uid}`;
      }

      const streamRes = await fetch(streamUrl, { headers, signal });
      if (streamRes.status === 401) { window.location.href = "/?signin=1"; return; }
      if (!streamRes.ok) { setError("Stream not available"); setLoading(false); return; }

      const data = await streamRes.json();
      if (begin && end) data.isLive = false;
      console.log("[watch] stream response keys:", Object.keys(data).join(","), "fp:", !!data.licenseFp);
      setStreamData(data);

      try {
        if (ref.type === "c") {
          const chRes = await fetch("/api/data/channels", { headers, signal });
          if (chRes.ok) {
            const chData = await chRes.json();
            const ch = (chData.channels || []).find((c: any) => c.uid === uid);
            if (ch) {
              const epgRes = await fetch("/api/epg/now", { signal });
              if (epgRes.ok) {
                const epgData = await epgRes.json();
                const now = epgData.now?.[uid]?.now;
                setMeta({
                  title: now ? `${ch.name} — ${now.title}` : ch.name,
                  subtitle: ch.resolution || "",
                  bannerId: now?.img || ch.logo,
                });
                return;
              }
              setMeta({ title: ch.name, subtitle: ch.resolution || "", bannerId: ch.logo });
              return;
            }
          }
          setMeta({ title: "Live TV", subtitle: "", bannerId: null });
        } else if (ref.type === "m" || ref.type === "k") {
          const dRes = await fetch(`/api/details/movie/${uid}`, { headers, signal });
          if (dRes.ok) {
            const d = await dRes.json();
            const parts = [d.year, d.resolution].filter(Boolean);
            setMeta({ title: d.title || "Movie", subtitle: parts.join(" · "), bannerId: d.poster });
            return;
          }
          setMeta({ title: "Movie", subtitle: "", bannerId: null });
        } else if (ref.type === "e") {
          const epRes = await fetch(`/api/details/series/${uid}`, { headers, signal });
          if (epRes.ok) {
            const d = await epRes.json();
            if (d.episodes?.length) {
              const ep = d.episodes.find((e: any) => e.uid === uid) || d.episodes[0];
              setMeta({ title: `${d.title || "Series"} — S${ep.season}E${ep.number}`, subtitle: ep.title, bannerId: ep.thumb || d.poster });
              return;
            }
          }
          setMeta({ title: "Episode", subtitle: "", bannerId: null });
        }
      } catch {
        setMeta({ title: "Loading…", subtitle: "", bannerId: null });
      }
    } catch {
      if (!signal?.aborted) setError("Failed to load stream");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [uid, searchParams]);

  useEffect(() => {
    const ctrl = new AbortController();
    loadStream(ctrl.signal);
    return () => ctrl.abort();
  }, [loadStream]);

  const handleBack = useCallback(() => {
    if (window.history.length > 1) router.back();
    else router.push("/");
  }, [router]);

  if (loading) {
    return (
      <div className="min-h-screen bg-black" style={{ padding: "60px 24px" }}>
        <div style={{ maxWidth: 400 }}>
          <div className="detail-skeleton" style={{ width: 200, height: 16, borderRadius: 6, background: "rgba(255,255,255,0.06)", marginBottom: 24 }} />
          <div className="detail-skeleton" style={{ width: 300, height: 12, borderRadius: 6, background: "rgba(255,255,255,0.05)", marginBottom: 12 }} />
          <div className="detail-skeleton" style={{ width: 240, height: 12, borderRadius: 6, background: "rgba(255,255,255,0.05)", marginBottom: 32 }} />
          <div className="detail-skeleton" style={{ width: 160, height: 44, borderRadius: 40, background: "rgba(255,255,255,0.06)" }} />
        </div>
        <style>{`@keyframes shimmer { 0%{opacity:.4} 50%{opacity:.15} 100%{opacity:.4} } .detail-skeleton { animation: shimmer 1.5s ease-in-out infinite; }`}</style>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-black flex flex-col items-center justify-center gap-4 text-white/50">
        <p className="text-red-400">{error}</p>
        <button onClick={handleBack} className="px-6 py-2 bg-[#ec1c24] rounded-full font-semibold text-sm">Go Back</button>
      </div>
    );
  }

  if (!streamData) return null;

  return (
    <VideoPlayer
      streamUrl={streamData.url}
      licenseUrl={streamData.licenseWv || streamData.license}
      licenseFp={streamData.licenseFp}
      title={meta.title}
      subtitle={meta.subtitle}
      bannerId={meta.bannerId}
      isLive={streamData.isLive}
      onBack={handleBack}
    />
  );
}
