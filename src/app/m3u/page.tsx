"use client";

import { useState, useEffect, useCallback } from "react";
import { ArrowLeft, Copy, Check, ExternalLink, Music, Tv, Trophy, Film } from "lucide-react";
import { getDeviceUid } from "@/lib/auth";

export default function M3uPage() {
  const [epgToken, setEpgToken] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [counts, setCounts] = useState({ live: 0, movies: 0 });

  const fetchToken = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError("");
    try {
      const uid = await getDeviceUid();
      const res = await fetch("/api/auth/epg-token", { headers: { "x-device-uid": uid }, signal });
      if (signal?.aborted) return;
      if (res.status === 401) {
        window.location.href = "/login";
        return;
      }
      const data = await res.json();
      if (data.token) setEpgToken(data.token);
      else setError(data.error || "Failed to get token");
    } catch {
      if (!signal?.aborted) setError("Failed to fetch EPG token");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    fetchToken(ctrl.signal);
    return () => ctrl.abort();
  }, [fetchToken]);

  const getBaseUrl = () => {
    if (typeof window === "undefined") return "";
    return window.location.origin;
  };

  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopied(label);
      setTimeout(() => setCopied(null), 2000);
    }
  };

  const base = getBaseUrl();
  const uid = typeof window !== "undefined" ? localStorage.getItem("deviceUid") || "" : "";

  const playlists = [
    {
      id: "live",
      name: "Live TV",
      icon: Tv,
      url: `${base}/live.m3u?uid=${uid}`,
      description: "All live channels with catchup support",
      color: "from-blue-500 to-cyan-500",
    },
    {
      id: "movies",
      name: "Movies",
      icon: Music,
      url: `${base}/movies.m3u?uid=${uid}`,
      description: "Full movies collection with DRM",
      color: "from-purple-500 to-pink-500",
    },
    {
      id: "series",
      name: "Series",
      icon: Film,
      url: `${base}/series.m3u?uid=${uid}`,
      description: "All series episodes with DRM",
      color: "from-emerald-500 to-teal-500",
    },
    {
      id: "sports",
      name: "Sports",
      icon: Trophy,
      url: `${base}/sports.m3u?uid=${uid}`,
      description: "Sports highlights and replays",
      color: "from-orange-500 to-amber-500",
    },
  ];

  const epgUrls = epgToken ? [
    { label: "EPG XML", url: `${base}/epg.xml?token=${epgToken}` },
    { label: "EPG GZ", url: `${base}/epg.xml.gz?token=${epgToken}` },
  ] : [];

  if (loading) {
    return (
      <div className="min-h-screen bg-[#111] flex items-center justify-center">
        <div className="w-10 h-10 border-4 border-white/10 border-t-[#ec1c24] rounded-full animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-[#111] flex flex-col items-center justify-center gap-4">
        <p className="text-red-400">{error}</p>
        <button onClick={() => window.location.href = "/login"} className="px-6 py-2 bg-[#ec1c24] rounded-full font-semibold text-sm">
          Sign In
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#111]">
      <header className="border-b border-white/10 bg-[#111]/90 backdrop-blur sticky top-0 z-50">
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center gap-3">
          <a href="/" className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/10 transition-colors">
            <ArrowLeft className="w-4 h-4" />
          </a>
          <h1 className="text-lg font-black tracking-tight">
            M3U <span className="text-[#ec1c24]">Playlists</span>
          </h1>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-8">
        <p className="text-white/40 text-sm mb-8">
          Copy these links into your IPTV player (Kodi, VLC, Smart TV, etc.)
        </p>

        <div className="space-y-6">
          {playlists.map((pl) => {
            const Icon = pl.icon;
            return (
              <div key={pl.id} className="bg-[#1c1c1c] border border-white/10 rounded-xl overflow-hidden">
                <div className={`bg-gradient-to-r ${pl.color} p-4 flex items-center gap-3`}>
                  <Icon className="w-5 h-5 text-white" />
                  <div>
                    <h2 className="text-white font-bold">{pl.name}</h2>
                    <p className="text-white/70 text-xs">{pl.description}</p>
                  </div>
                </div>
                <div className="p-4">
                  <label className="block text-[10px] font-bold text-white/40 uppercase tracking-wider mb-1.5">
                    Playlist URL
                  </label>
                  <div className="flex gap-2">
                    <input
                      readOnly
                      value={pl.url}
                      className="flex-1 bg-black text-white/70 border border-white/10 rounded-lg px-3 py-2 text-xs font-mono"
                      onClick={(e) => (e.target as HTMLInputElement).select()}
                    />
                    <button
                      onClick={() => copyToClipboard(pl.url, pl.id)}
                      className="px-4 py-2 bg-white/10 hover:bg-white/20 border border-white/10 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-colors"
                    >
                      {copied === pl.id ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
                      {copied === pl.id ? "Copied" : "Copy"}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {epgToken && (
          <div className="mt-8">
            <h3 className="text-sm font-bold text-white/60 mb-3">EPG Endpoints</h3>
            <div className="space-y-2">
              {epgUrls.map((epg) => (
                <div key={epg.label} className="bg-[#1c1c1c] border border-white/10 rounded-lg p-3 flex items-center gap-2">
                  <span className="text-xs text-white/50 w-20 shrink-0">{epg.label}</span>
                  <input
                    readOnly
                    value={epg.url}
                    className="flex-1 bg-black text-white/60 border border-white/10 rounded px-2 py-1.5 text-[11px] font-mono"
                    onClick={(e) => (e.target as HTMLInputElement).select()}
                  />
                  <button
                    onClick={() => copyToClipboard(epg.url, epg.label)}
                    className="px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded text-[11px] font-bold flex items-center gap-1 transition-colors"
                  >
                    {copied === epg.label ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
