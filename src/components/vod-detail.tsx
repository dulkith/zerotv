"use client";

import { useState, useEffect } from "react";
import { imgUrl } from "@/lib/viu";

function fmtDur(m: number): string {
  if (!m || m <= 0) return "—";
  if (Math.floor(m / 60)) return `${Math.floor(m / 60)}h ${m % 60}m`;
  return `${m}m`;
}

interface MovieDetails {
  title: string;
  description: string;
  poster: number | null;
  titleArt: number | null;
  year: string | null;
  country: string[];
  duration: number | null;
  resolution: string | null;
  rating: number | null;
  director: string;
  cast: string;
  hasTrailer: boolean;
}

interface SeriesDetails {
  title: string;
  description: string;
  poster: number | null;
  titleArt: number | null;
  year: string | null;
  cast: string;
  episodes: {
    uid: string;
    title: string;
    season: number;
    number: number;
    thumb: number | null;
    duration: number | null;
  }[];
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

interface VodDetailProps {
  uid: string;
  type: "movie" | "series";
  fallbackTitle?: string;
  fallbackPoster?: number | null;
  onClose: () => void;
  onPlay: (uid: string, type: string, queue?: PlayQueue, meta?: { title: string; subtitle: string; bannerId: number | null }) => void;
}

export function VodDetail({ uid, type, fallbackTitle, fallbackPoster, onClose, onPlay }: VodDetailProps) {
  const [movieData, setMovieData] = useState<MovieDetails | null>(null);
  const [seriesData, setSeriesData] = useState<SeriesDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [resolvedType, setResolvedType] = useState<"movie" | "series" | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    async function load() {
      try {
        const { getDeviceUid } = await import("@/lib/auth");
        const deviceUid = await getDeviceUid();
        const headers = { "x-device-uid": deviceUid };

        let resolved = type;
        try {
          const resolveRes = await fetch(`/api/uid/resolve/${encodeURIComponent(uid)}`, { headers, signal: ctrl.signal });
          if (resolveRes.ok) {
            const ref = await resolveRes.json();
            if (ref.type === "m" || ref.type === "k") resolved = "movie";
            else if (ref.type === "e") resolved = "series";
          }
        } catch {}

        setResolvedType(resolved);

        const endpoint = resolved === "movie"
          ? `/api/details/movie/${encodeURIComponent(uid)}`
          : `/api/details/series/${encodeURIComponent(uid)}`;
        const res = await fetch(endpoint, { headers, signal: ctrl.signal });
        if (res.ok) {
          const data = await res.json();
          if (resolved === "movie") setMovieData(data);
          else setSeriesData(data);
        } else if (resolved === "movie") {
          const fallback = await fetch(`/api/details/series/${encodeURIComponent(uid)}`, { headers, signal: ctrl.signal });
          if (fallback.ok) {
            const data = await fallback.json();
            setSeriesData(data);
            setResolvedType("series");
          }
        } else {
          const fallback = await fetch(`/api/details/movie/${encodeURIComponent(uid)}`, { headers, signal: ctrl.signal });
          if (fallback.ok) {
            const data = await fallback.json();
            setMovieData(data);
            setResolvedType("movie");
          }
        }
      } catch {}
      setLoading(false);
    }
    load();
    return () => ctrl.abort();
  }, [uid, type]);

  const effectiveType = resolvedType || type;
  const d = effectiveType === "movie" ? movieData : seriesData;
  const posterUrl = d?.poster ? imgUrl(d.poster) : fallbackPoster ? imgUrl(fallbackPoster) : "";
  const displayTitle = d?.title || fallbackTitle || "Untitled";

  const handleMoviePlay = (playUid: string, playType: string) => {
    if (movieData) {
      const meta = [
        "Movie", movieData.year, movieData.country?.join?.(", "),
        movieData.duration ? fmtDur(movieData.duration) : null, movieData.resolution,
        movieData.rating != null ? movieData.rating.toFixed(1) : null,
      ].filter(Boolean).join(" · ");
      onPlay(playUid, playType, undefined, { title: movieData.title || "Movie", subtitle: meta, bannerId: movieData.poster });
    } else {
      onPlay(playUid, playType, undefined, { title: displayTitle, subtitle: "", bannerId: fallbackPoster ?? null });
    }
  };

  return (
    <div className="fixed inset-0 z-50" onClick={onClose}>
      <div className="absolute inset-0 overflow-y-auto" onClick={(e) => e.stopPropagation()} style={{ backgroundColor: "#121212" }}>
        {/* Background — fixed behind scroll */}
        <div style={{ position: "fixed", inset: 0, backgroundImage: posterUrl ? `url('${posterUrl.replace(/'/g, "\\'")}')` : undefined, backgroundSize: "cover", backgroundPosition: "center top", pointerEvents: "none", zIndex: 0 }} />
        {/* Gradient overlays — fixed, content scrolls over */}
        <div style={{ position: "fixed", inset: 0, background: "linear-gradient(to right, rgba(0,0,0,0.93), rgba(0,0,0,0.25))", pointerEvents: "none", zIndex: 0 }} />
        <div style={{ position: "fixed", inset: 0, background: "linear-gradient(to top, rgba(0,0,0,0.97) 0%, rgba(0,0,0,0.5) 40%, transparent 70%)", pointerEvents: "none", zIndex: 0 }} />

        {/* Back button */}
        <button onClick={onClose} style={{ position: "fixed", top: 16, left: 16, width: 44, height: 44, borderRadius: "50%", background: "rgba(0,0,0,0.5)", border: "1px solid rgba(255,255,255,0.15)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#fff", zIndex: 20, padding: 0 }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 22, height: 22 }}><path d="m12 19-7-7 7-7"/><path d="M19 12H5"/></svg>
        </button>

        {/* Content */}
        <div style={{ position: "relative", zIndex: 1, padding: "80px 24px 40px", maxWidth: 1400 }} className="detail-content-responsive">
          {loading ? (
            <div style={{ maxWidth: 600 }}>
              {/* Title art skeleton */}
              <div style={{ width: 280, height: 120, borderRadius: 12, background: "rgba(255,255,255,0.06)", marginBottom: 20 }} className="detail-skeleton" />
              {/* Meta skeleton */}
              <div style={{ width: 200, height: 14, borderRadius: 6, background: "rgba(255,255,255,0.06)", marginBottom: 16 }} className="detail-skeleton" />
              {/* Text skeletons */}
              <div style={{ width: "100%", height: 12, borderRadius: 6, background: "rgba(255,255,255,0.05)", marginBottom: 8 }} className="detail-skeleton" />
              <div style={{ width: "85%", height: 12, borderRadius: 6, background: "rgba(255,255,255,0.05)", marginBottom: 8 }} className="detail-skeleton" />
              <div style={{ width: "60%", height: 12, borderRadius: 6, background: "rgba(255,255,255,0.05)", marginBottom: 24 }} className="detail-skeleton" />
              {/* Button skeleton */}
              <div style={{ width: 160, height: 44, borderRadius: 40, background: "rgba(255,255,255,0.06)" }} className="detail-skeleton" />
            </div>
          ) : !d ? (
            /* Fallback — show title + play when no detail data */
            <div style={{ maxWidth: 600 }}>
              <h1 style={{ fontSize: "1.6rem", fontWeight: 800, color: "#eee", margin: "0 0 16px" }}>
                {displayTitle}
              </h1>
              <div style={{ display: "flex", gap: 12 }}>
                <button
                  onClick={(e) => { e.stopPropagation(); onPlay(uid, effectiveType === "series" ? "series" : "movie"); }}
                  style={{ display: "inline-flex", alignItems: "center", gap: 10, padding: "12px 24px", borderRadius: 40, background: "#ec1c24", border: "none", color: "#fff", fontSize: "0.95rem", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}
                >
                  <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: 20, height: 20 }}><polygon points="6 4 20 12 6 20"/></svg>
                  Play
                </button>
              </div>
            </div>
          ) : effectiveType === "movie" && movieData ? (
            <MovieContent data={movieData} uid={uid} onPlay={handleMoviePlay} />
          ) : effectiveType === "series" && seriesData ? (
            <SeriesContent data={seriesData} uid={uid} onPlay={onPlay} />
          ) : null}
        </div>
      </div>

      <style>{`
        @keyframes shimmer { 0% { opacity: 0.4; } 50% { opacity: 0.15; } 100% { opacity: 0.4; } }
        .detail-skeleton { animation: shimmer 1.5s ease-in-out infinite; }
        @media (max-width: 768px) {
          .detail-content-responsive { padding: 70px 16px 32px !important; }
          .detail-titleart img { max-height: 120px !important; }
        }
      `}</style>
    </div>
  );
}

function MovieContent({ data, uid, onPlay }: { data: MovieDetails; uid: string; onPlay: (uid: string, type: string) => void }) {
  const meta = [
    "Movie", data.year, data.country?.join?.(", "),
    data.duration ? fmtDur(data.duration) : null, data.resolution,
    data.rating != null ? data.rating.toFixed(1) : null,
  ].filter(Boolean).join(" · ");

  return (
    <>
      {data.titleArt && (
        <div style={{ maxHeight: 160, marginBottom: 16 }} className="detail-titleart">
          <img src={imgUrl(data.titleArt)} alt="" style={{ maxHeight: 160, filter: "drop-shadow(0 6px 24px rgba(0,0,0,0.8))" }} loading="lazy" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
        </div>
      )}
      {!data.titleArt && <h1 style={{ fontSize: "1.6rem", fontWeight: 800, color: "#eee", margin: "0 0 12px" }}>{data.title}</h1>}
      <div style={{ fontSize: "0.9rem", fontWeight: 600, color: "#eee", marginBottom: 16 }}>{meta}</div>
      {data.director && (
        <div style={{ fontSize: "0.95rem", color: "#ddd", marginBottom: 4 }}>
          <b style={{ color: "rgba(255,255,255,0.55)", textTransform: "uppercase", fontSize: "0.85rem" }}>Directors</b> {data.director}
        </div>
      )}
      {data.cast && (
        <div style={{ fontSize: "0.95rem", color: "#ddd", marginBottom: 4 }}>
          <b style={{ color: "rgba(255,255,255,0.55)", textTransform: "uppercase", fontSize: "0.85rem" }}>Cast</b> {data.cast}
        </div>
      )}
      {data.description && (
        <p style={{ fontSize: "1rem", lineHeight: 1.6, color: "#eee", margin: "20px 0 24px", maxWidth: 800 }}>{data.description}</p>
      )}
      <div style={{ display: "flex", gap: 12, marginBottom: 32, flexWrap: "wrap" }}>
        <button
          onClick={(e) => { e.stopPropagation(); onPlay(uid, "movie"); }}
          style={{ display: "inline-flex", alignItems: "center", gap: 10, padding: "12px 24px", borderRadius: 40, background: "#ec1c24", border: "none", color: "#fff", fontSize: "0.95rem", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}
        >
          <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: 20, height: 20 }}><polygon points="6 4 20 12 6 20"/></svg>
          Play
        </button>
        {data.hasTrailer && (
          <button
            onClick={(e) => { e.stopPropagation(); onPlay(uid, "trailer"); }}
            style={{ display: "inline-flex", alignItems: "center", gap: 10, padding: "12px 24px", borderRadius: 40, background: "rgba(33,33,33,0.9)", border: "1px solid rgba(255,255,255,0.1)", color: "#fff", fontSize: "0.95rem", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}
          >
            ▶ Trailer
          </button>
        )}
      </div>
    </>
  );
}

function SeriesContent({ data, uid, onPlay }: { data: SeriesDetails; uid: string; onPlay: (uid: string, type: string, queue?: PlayQueue, meta?: { title: string; subtitle: string; bannerId: number | null }) => void }) {
  const eps = data.episodes || [];
  const seriesMeta = { title: data.title || "Series", subtitle: `Series · ${data.year || ""} · ${eps.length} episodes`, bannerId: data.poster };
  return (
    <>
      {data.titleArt && (
        <div style={{ maxHeight: 140, marginBottom: 16 }} className="detail-titleart">
          <img src={imgUrl(data.titleArt)} alt="" style={{ maxHeight: 140, filter: "drop-shadow(0 6px 24px rgba(0,0,0,0.8))" }} onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
        </div>
      )}
      {!data.titleArt && <h1 style={{ fontSize: "1.5rem", fontWeight: 800, color: "#eee", margin: "0 0 12px" }}>{data.title}</h1>}
      <div style={{ fontSize: "0.85rem", fontWeight: 600, color: "#eee", marginBottom: 16 }}>
        Series · {data.year || ""} · {eps.length} episodes
      </div>
      {data.cast && (
        <div style={{ fontSize: "0.95rem", color: "#ddd", marginBottom: 4 }}>
          <b style={{ color: "rgba(255,255,255,0.55)", textTransform: "uppercase", fontSize: "0.85rem" }}>Cast</b> {data.cast}
        </div>
      )}
      {data.description && (
        <p style={{ fontSize: "1rem", lineHeight: 1.6, color: "#eee", margin: "20px 0 24px", maxWidth: 800 }}>{data.description}</p>
      )}
      <div style={{ display: "flex", gap: 12, marginBottom: 32, flexWrap: "wrap" }}>
        {eps.length > 0 && (
          <button
            onClick={(e) => { e.stopPropagation(); onPlay(eps[0].uid, "episode", { kind: "series", index: 0, items: eps.map(ep => ({ uid: ep.uid, title: `S${ep.season}E${ep.number}`, thumb: ep.thumb })) }, { title: `${data.title || "Series"} — S${eps[0].season}E${eps[0].number}`, subtitle: eps[0].title, bannerId: eps[0].thumb || data.poster }); }}
            style={{ display: "inline-flex", alignItems: "center", gap: 10, padding: "12px 24px", borderRadius: 40, background: "#ec1c24", border: "none", color: "#fff", fontSize: "0.95rem", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}
          >
            <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: 20, height: 20 }}><polygon points="6 4 20 12 6 20"/></svg>
            Play S1E1
          </button>
        )}
      </div>
      <h2 style={{ fontSize: "1.3rem", fontWeight: 700, margin: "24px 0 16px" }}>Episodes ({eps.length})</h2>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {eps.map((ep, i) => (
          <button
            key={ep.uid}
            onClick={(e) => { e.stopPropagation(); onPlay(ep.uid, "episode", { kind: "series", index: i, items: eps.map(e2 => ({ uid: e2.uid, title: `S${e2.season}E${e2.number}`, thumb: e2.thumb })) }, { title: `${data.title || "Series"} — S${ep.season}E${ep.number}`, subtitle: ep.title, bannerId: ep.thumb || data.poster }); }}
            style={{
              display: "flex", alignItems: "center", gap: 12, padding: 12,
              background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.05)",
              borderRadius: 12, textAlign: "left", width: "100%", cursor: "pointer", fontFamily: "inherit", color: "#fff",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.1)"; e.currentTarget.style.borderColor = "#ec1c24"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.05)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.05)"; }}
          >
            <div style={{ width: 44, height: 44, borderRadius: 8, background: "#ec1c24", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: "bold", fontSize: 12, flexShrink: 0 }}>
              S{ep.season}E{ep.number}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ep.title}</div>
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginTop: 2 }}>
                {ep.duration ? `${ep.duration} min` : ""}
              </div>
            </div>
            <span style={{ color: "rgba(255,255,255,0.5)" }}>▶</span>
          </button>
        ))}
      </div>
    </>
  );
}
