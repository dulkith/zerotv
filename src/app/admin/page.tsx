"use client";

import { useState, useEffect, useCallback, useRef } from "react";

type Tab = "overview" | "collections" | "import" | "config";

interface HealthData {
  server?: { uptimeSec: number; nodeVersion: string; now: string };
  counts?: { channels: number; categories: number; movies: number; series: number };
  epg?: { programCount: number; updatedAt: string | null };
  caches?: { mpd: number; pssh: number; uid: number; episodes: number };
  tokens?: { hasAccess: boolean; hasRefresh: boolean; minutesLeft: number };
}

interface ConfigData {
  cache: Record<string, number>;
}

const COLLECTIONS = [
  { key: "channels", label: "Channels", desc: "Live TV channel data", icon: "📺" },
  { key: "categories_index", label: "Categories Index", desc: "Category listing", icon: "📂" },
  { key: "categories", label: "Categories", desc: "Per-category content", icon: "🎬" },
  { key: "packages", label: "Packages", desc: "Subscription packages", icon: "📦" },
  { key: "devices", label: "Devices", desc: "Registered devices", icon: "📱" },
  { key: "tokens", label: "Tokens", desc: "Per-device Viu auth tokens", icon: "🔑" },
  { key: "config", label: "Config", desc: "System configuration", icon: "⚙️" },
];

function fmtDur(sec: number): string {
  if (!sec) return "—";
  if (sec < 60) return sec + "s";
  if (sec < 3600) return Math.floor(sec / 60) + "m " + (sec % 60) + "s";
  return Math.floor(sec / 3600) + "h " + Math.floor((sec % 3600) / 60) + "m";
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

export default function AdminPage() {
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [health, setHealth] = useState<HealthData>({});
  const [loginError, setLoginError] = useState("");
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<Tab>("overview");

  const api = useCallback(async (path: string, opts: RequestInit = {}) => {
    const headers: Record<string, string> = { "x-admin-token": token };
    if (opts.headers) Object.assign(headers, opts.headers);
    const res = await fetch(path, { ...opts, headers });
    if (res.status === 401) { setToken(""); sessionStorage.removeItem("adminToken"); }
    return res;
  }, [token]);

  const doLogin = async () => {
    if (!password) return;
    setLoading(true); setLoginError("");
    try {
      const res = await fetch("/admin/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Login failed");
      setToken(data.token); sessionStorage.setItem("adminToken", data.token); setPassword("");
    } catch (e: unknown) { setLoginError(e instanceof Error ? e.message : "Login failed"); }
    finally { setLoading(false); }
  };

  const loadHealth = useCallback(async () => {
    try { const res = await api("/admin/health"); if (res.ok) setHealth(await res.json()); } catch {}
  }, [api]);

  useEffect(() => {
    const saved = sessionStorage.getItem("adminToken");
    if (saved) { setToken(saved); fetch("/admin/verify", { headers: { "x-admin-token": saved } }).then(r => { if (r.ok) loadHealth(); }).catch(() => sessionStorage.removeItem("adminToken")); }
  }, [loadHealth]);

  useEffect(() => { if (token) { loadHealth(); const i = setInterval(loadHealth, 10000); return () => clearInterval(i); } }, [token, loadHealth]);

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-[#0a0a0a]">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-black tracking-tight">Zero<span className="text-[#ec1c24]">TV</span> <span className="text-white/40">Admin</span></h1>
            <p className="text-sm text-white/40 mt-2">Data Management</p>
          </div>
          <div className="bg-[#1c1c1e]/70 border border-white/[0.06] rounded-2xl p-5">
            <label className="block text-xs font-bold text-white/50 uppercase tracking-wider mb-2">Password</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === "Enter" && doLogin()}
              className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white outline-none focus:border-[#ec1c24] mb-4" placeholder="Enter admin password" autoFocus />
            <button onClick={doLogin} disabled={loading} className="w-full py-3 bg-[#ec1c24] text-white font-bold text-sm rounded-xl disabled:opacity-50">{loading ? "Signing in…" : "Sign In"}</button>
            {loginError && <p className="text-xs text-red-400 mt-3 text-center">{loginError}</p>}
          </div>
          <p className="text-center text-xs text-white/30 mt-6"><a href="/" className="hover:text-white/60">← Back to LankaTV</a></p>
        </div>
      </div>
    );
  }

  const TABS: { key: Tab; label: string }[] = [
    { key: "overview", label: "Overview" },
    { key: "collections", label: "Collections" },
    { key: "import", label: "Import" },
    { key: "config", label: "Config" },
  ];

  return (
    <div className="min-h-screen p-4 sm:p-8 bg-[#0a0a0a]">
      <div className="max-w-[1400px] mx-auto">
        <div className="flex items-center justify-between mb-6 flex-wrap gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-black">Admin Dashboard</h1>
            <p className="text-sm text-white/40 mt-1">Data management</p>
          </div>
          <div className="flex gap-2">
            <a href="/" className="px-4 py-2 rounded-full bg-white/5 border border-white/10 text-white font-bold text-xs">← Site</a>
            <button onClick={() => { setToken(""); sessionStorage.removeItem("adminToken"); }} className="px-4 py-2 rounded-full bg-white/5 border border-white/10 text-white font-bold text-xs">Logout</button>
          </div>
        </div>

        <div className="flex gap-1 mb-6 bg-[#1c1c1e]/50 p-1 rounded-xl w-fit">
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`px-4 py-2 rounded-lg text-xs font-bold transition ${tab === t.key ? "bg-[#ec1c24] text-white" : "text-white/50 hover:text-white/80"}`}>
              {t.label}
            </button>
          ))}
        </div>

        {tab === "overview" && <OverviewTab health={health} api={api} />}
        {tab === "collections" && <CollectionsTab api={api} />}
        {tab === "import" && <ImportTab api={api} />}
        {tab === "config" && <ConfigTab api={api} />}
      </div>
    </div>
  );
}

// ── OVERVIEW ─────────────────────────────────────────────────
function OverviewTab({ health, api }: { health: HealthData; api: (p: string, o?: RequestInit) => Promise<Response> }) {
  const [uidResult, setUidResult] = useState<string>("");
  const runRefresh = async (k: string) => { try { await api(`/admin/refresh-${k}`, { method: "POST" }); } catch {} };
  const rebuildUid = async () => {
    if (!confirm("Scan all channels + categories and assign UIDs to every item?")) return;
    try {
      const res = await api("/admin/rebuild-uid-map", { method: "POST" });
      const data = await res.json();
      if (data.ok) setUidResult(`${data.after} UIDs (${data.after > data.before ? "+" + (data.after - data.before) : "no change"}) — ${data.channels}ch ${data.categories}cat ${data.movies}m ${data.series}s ${data.series}ep`);
      else setUidResult("Failed");
    } catch { setUidResult("Error"); }
    setTimeout(() => setUidResult(""), 4000);
  };

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard title="Channels" value={health.counts?.channels ?? "—"} hint="live TV" />
        <StatCard title="Categories" value={health.counts?.categories ?? "—"} />
        <StatCard title="Total VOD" value={(health.counts?.movies || 0) + (health.counts?.series || 0)} hint="movies + series" />
        <StatCard title="EPG Programs" value={health.epg?.programCount ?? "—"} />
      </div>
      <div className="bg-[#1c1c1e]/70 border border-white/[0.06] rounded-2xl p-5 mb-8">
        <h3 className="text-xs font-bold text-white/45 uppercase tracking-wider mb-4">System Health</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
          <div><div className="text-white/40 text-xs uppercase font-bold mb-1">Uptime</div><div>{fmtDur(health.server?.uptimeSec || 0)}</div></div>
          <div><div className="text-white/40 text-xs uppercase font-bold mb-1">Token Left</div><div>{health.tokens?.minutesLeft ? `${health.tokens.minutesLeft} min` : "expired"}</div></div>
          <div><div className="text-white/40 text-xs uppercase font-bold mb-1">MPD Cache</div><div>{health.caches?.mpd ?? 0}</div></div>
          <div><div className="text-white/40 text-xs uppercase font-bold mb-1">UIDs Mapped</div><div>{health.caches?.uid ?? 0}</div></div>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 items-center">
        <button onClick={() => runRefresh("all")} className="px-4 py-2.5 rounded-full bg-[#ec1c24] text-white font-bold text-xs">Refresh All</button>
        <button onClick={() => runRefresh("channels")} className="px-4 py-2.5 rounded-full bg-white/5 border border-white/10 text-white font-bold text-xs">Channels</button>
        <button onClick={() => runRefresh("content")} className="px-4 py-2.5 rounded-full bg-white/5 border border-white/10 text-white font-bold text-xs">Content</button>
        <button onClick={() => runRefresh("epg")} className="px-4 py-2.5 rounded-full bg-white/5 border border-white/10 text-white font-bold text-xs">EPG</button>
        <div className="w-px h-5 bg-white/10 mx-1" />
        <button onClick={rebuildUid} className="px-4 py-2.5 rounded-full bg-blue-500/20 text-blue-400 font-bold text-xs hover:bg-blue-500/30">Rebuild UID Map</button>
        {uidResult && <span className="text-[11px] text-white/50 ml-1">{uidResult}</span>}
      </div>
    </>
  );
}

// ── COLLECTIONS BROWSER ─────────────────────────────────────
function CollectionsTab({ api }: { api: (p: string, o?: RequestInit) => Promise<Response> }) {
  const [selected, setSelected] = useState("channels");
  const [docs, setDocs] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<string | number | null>(null);
  const [editing, setEditing] = useState<string | number | null>(null);
  const [editJson, setEditJson] = useState("");
  const [editError, setEditError] = useState("");
  const [search, setSearch] = useState("");
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);

  const showToast = (msg: string, ok: boolean) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 2500);
  };

  const loadDocs = useCallback(async () => {
    setLoading(true); setDocs([]); setExpanded(null); setEditing(null); setSearch("");
    try {
      const res = await api(`/admin/mongo/${selected}`);
      if (res.ok) { const d = await res.json(); setDocs(d.docs || []); }
    } catch {} finally { setLoading(false); }
  }, [api, selected]);

  useEffect(() => { loadDocs(); }, [loadDocs]);

  const filteredDocs = docs.filter(doc => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    const raw = JSON.stringify(doc).toLowerCase();
    return raw.includes(q);
  });

  const toggleExpand = (id: string | number) => {
    if (editing === id) return;
    setExpanded(expanded === id ? null : id);
  };

  const startEdit = (doc: any) => {
    setEditing(doc._id);
    setEditJson(JSON.stringify(doc, null, 2));
    setEditError("");
    setExpanded(doc._id);
  };

  const cancelEdit = () => { setEditing(null); setEditError(""); };

  const saveEdit = async () => {
    setEditError("");
    try {
      const parsed = JSON.parse(editJson);
      const id = parsed._id;
      const res = await api(`/admin/mongo/${selected}/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed),
      });
      if (!res.ok) { const e = await res.json(); setEditError(e.error); return; }
      setEditing(null); loadDocs(); showToast("Saved", true);
    } catch (e) { setEditError("Invalid JSON: " + (e as Error).message); }
  };

  const deleteDoc = async (id: string | number) => {
    if (!confirm(`Delete document "${id}"?`)) return;
    try {
      const res = await api(`/admin/mongo/${selected}/${id}`, { method: "DELETE" });
      if (res.ok) { showToast("Deleted", true); loadDocs(); }
    } catch { showToast("Delete failed", false); }
  };

  const collMeta = COLLECTIONS.find(c => c.key === selected);

  return (
    <div>
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-2 rounded-xl text-sm font-bold shadow-lg transition-all ${toast.ok ? "bg-green-500/20 text-green-400 border border-green-500/30" : "bg-red-500/20 text-red-400 border border-red-500/30"}`}>
          {toast.msg}
        </div>
      )}

      {/* Collection tabs */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        {COLLECTIONS.map(c => (
          <button key={c.key} onClick={() => setSelected(c.key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${selected === c.key ? "bg-[#ec1c24] text-white" : "bg-white/5 border border-white/10 text-white/60 hover:text-white"}`}>
            {c.icon} {c.label}
          </button>
        ))}
      </div>

      {/* Search + info bar */}
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-sm">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30 text-xs">🔍</span>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search documents…"
            className="w-full pl-8 pr-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white text-xs outline-none focus:border-[#ec1c24] placeholder:text-white/25" />
          {search && <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 text-xs">✕</button>}
        </div>
        <span className="text-xs text-white/35 shrink-0">{filteredDocs.length}{search ? ` / ${docs.length}` : ""} docs</span>
        <button onClick={loadDocs} className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white text-xs font-bold shrink-0">↻ Refresh</button>
      </div>

      {/* Description */}
      <div className="text-xs text-white/40 mb-3">{collMeta?.desc}</div>

      {loading ? (
        <div className="flex items-center gap-2 text-white/40 text-sm py-8 justify-center">
          <div className="w-4 h-4 border-2 border-white/20 border-t-[#ec1c24] rounded-full animate-spin" />
          Loading…
        </div>
      ) : filteredDocs.length === 0 ? (
        <div className="text-center py-12 text-white/30 text-sm">{search ? "No matching documents" : "No documents in this collection"}</div>
      ) : (
        <div className="space-y-2">
          {filteredDocs.map((doc, i) => {
            const id = doc._id;
            const isExpanded = expanded === id;
            const isEditing = editing === id;
            const keys = Object.keys(doc).filter(k => k !== "_id");

            return (
              <div key={i} className={`bg-[#1c1c1e]/70 border rounded-xl transition-colors ${isExpanded ? "border-[#ec1c24]/30" : "border-white/[0.06] hover:border-white/[0.12]"}`}>
                {/* Header row */}
                <div className="flex items-center gap-3 px-4 py-3 cursor-pointer select-none" onClick={() => toggleExpand(id)}>
                  <span className={`text-[10px] transition-transform ${isExpanded ? "rotate-90" : ""}`}>▶</span>
                  <span className="font-mono text-xs text-[#ec1c24] font-bold">{String(id)}</span>
                  <span className="text-[10px] text-white/25 ml-1">{keys.length} fields</span>
                  <div className="flex-1" />
                  <div className="flex gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                    <button onClick={() => startEdit(doc)} className="px-2 py-1 rounded bg-blue-500/15 text-blue-400 text-[11px] font-bold hover:bg-blue-500/25">Edit</button>
                    <button onClick={() => deleteDoc(id)} className="px-2 py-1 rounded bg-red-500/15 text-red-400 text-[11px] font-bold hover:bg-red-500/25">Del</button>
                  </div>
                </div>

                {/* Expanded view */}
                {isExpanded && (
                  <div className="px-4 pb-3 border-t border-white/[0.04]">
                    {isEditing ? (
                      <div className="mt-3">
                        <textarea value={editJson} onChange={e => setEditJson(e.target.value)}
                          className="w-full h-64 px-3 py-2 bg-black/40 border border-white/10 rounded-lg text-white text-xs font-mono outline-none focus:border-[#ec1c24] resize-y" />
                        {editError && <p className="text-xs text-red-400 mt-1">{editError}</p>}
                        <div className="flex gap-2 mt-2">
                          <button onClick={saveEdit} className="px-3 py-1.5 rounded bg-[#ec1c24] text-white text-xs font-bold">Save</button>
                          <button onClick={cancelEdit} className="px-3 py-1.5 rounded bg-white/5 border border-white/10 text-white text-xs font-bold">Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <div className="mt-2 space-y-0">
                        {renderDocFields(doc)}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function renderDocFields(doc: any, prefix = "", depth = 0): React.ReactNode {
  const entries = Object.entries(doc).filter(([k]) => k !== "_id");
  return entries.map(([key, val]) => {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (val === null || val === undefined) {
      return (
        <div key={fullKey} className="flex items-baseline gap-2 py-1 text-xs" style={{ paddingLeft: depth * 16 }}>
          <span className="text-white/50 font-bold shrink-0">{key}:</span>
          <span className="text-white/25 italic">null</span>
        </div>
      );
    }
    if (typeof val === "object" && !Array.isArray(val)) {
      return (
        <div key={fullKey}>
          <div className="flex items-baseline gap-2 py-1 text-xs" style={{ paddingLeft: depth * 16 }}>
            <span className="text-white/50 font-bold shrink-0">{key}:</span>
            <span className="text-white/25 text-[10px]">{`{${Object.keys(val as object).length} keys}`}</span>
          </div>
          {depth < 2 && renderDocFields(val, fullKey, depth + 1)}
        </div>
      );
    }
    if (Array.isArray(val)) {
      return (
        <div key={fullKey} className="py-1 text-xs" style={{ paddingLeft: depth * 16 }}>
          <span className="text-white/50 font-bold">{key}:</span>
          <span className="text-white/30 ml-1">[{val.length} items]</span>
          {depth < 2 && val.length > 0 && typeof val[0] === "object" && (
            <div className="ml-2 mt-0.5">
              {val.slice(0, 3).map((item: any, idx: number) => (
                <div key={idx} className="text-[10px] text-white/25 py-0.5">
                  [{idx}] {typeof item === "object" ? `{${Object.keys(item).length} keys}` : truncate(String(item), 60)}
                </div>
              ))}
              {val.length > 3 && <div className="text-[10px] text-white/20">… +{val.length - 3} more</div>}
            </div>
          )}
        </div>
      );
    }
    const display = typeof val === "string" ? truncate(val, 80) : String(val);
    return (
      <div key={fullKey} className="flex items-baseline gap-2 py-1 text-xs" style={{ paddingLeft: depth * 16 }}>
        <span className="text-white/50 font-bold shrink-0">{key}:</span>
        <span className={`break-all ${typeof val === "string" && val.startsWith("http") ? "text-blue-400/60" : "text-white/70"}`}>{display}</span>
      </div>
    );
  });
}

// ── IMPORT ───────────────────────────────────────────────────
function ImportTab({ api }: { api: (p: string, o?: RequestInit) => Promise<Response> }) {
  const [importing, setImporting] = useState(false);
  const [lastResult, setLastResult] = useState("");
  const [resultType, setResultType] = useState<"ok" | "err">("ok");
  const [collection, setCollection] = useState("channels");
  const [jsonInput, setJsonInput] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const showResult = (msg: string, ok: boolean) => { setLastResult(msg); setResultType(ok ? "ok" : "err"); };

  const importFromFiles = async () => {
    if (!confirm("This will REPLACE all data in MongoDB with data from local JSON files. Continue?")) return;
    setImporting(true); setLastResult("");
    try {
      const res = await api("/admin/import-from-files", { method: "POST" });
      const data = await res.json();
      if (data.ok) showResult(`Imported ${data.imported} data sources from files`, true);
      else showResult(data.error || "Import failed", false);
    } catch (e) { showResult((e as Error).message, false); }
    finally { setImporting(false); }
  };

  const importCollection = async () => {
    if (!jsonInput.trim()) return;
    if (!confirm(`This will REPLACE ALL data in "${collection}" collection. Continue?`)) return;
    setImporting(true); setLastResult("");
    try {
      let parsed;
      try { parsed = JSON.parse(jsonInput); } catch { showResult("Invalid JSON", false); setImporting(false); return; }
      const res = await api(`/admin/mongo/${collection}/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed),
      });
      const data = await res.json();
      if (data.ok) showResult(`Imported ${data.count} docs into "${collection}"`, true);
      else showResult(data.error || "Import failed", false);
    } catch (e) { showResult((e as Error).message, false); }
    finally { setImporting(false); }
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setJsonInput(await file.text());
    e.target.value = "";
  };

  return (
    <div className="space-y-6">
      <div className="bg-[#1c1c1e]/70 border border-white/[0.06] rounded-2xl p-5">
        <h3 className="text-sm font-bold mb-2">Import from Local JSON Files</h3>
        <p className="text-xs text-white/40 mb-4">Reads channels.json, categories.json, categories/*.json, uid-map.json, tokens.json, pssh-cache.json from the data directory. <strong className="text-yellow-400">Replaces all MongoDB data.</strong></p>
        <button onClick={importFromFiles} disabled={importing}
          className="px-4 py-2.5 rounded-full bg-[#ec1c24] text-white font-bold text-xs disabled:opacity-50">
          {importing ? "Importing…" : "Import All from JSON Files"}
        </button>
      </div>

      <div className="bg-[#1c1c1e]/70 border border-white/[0.06] rounded-2xl p-5">
        <h3 className="text-sm font-bold mb-2">Import JSON into Collection</h3>
        <p className="text-xs text-white/40 mb-4">Paste JSON or load a file. <strong className="text-yellow-400">Replaces entire collection.</strong></p>
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <span className="text-xs font-bold text-white/50">Target:</span>
          {COLLECTIONS.map(c => (
            <button key={c.key} onClick={() => setCollection(c.key)}
              className={`px-2 py-1 rounded text-xs font-bold transition ${collection === c.key ? "bg-[#ec1c24] text-white" : "bg-white/5 text-white/50 hover:text-white"}`}>
              {c.icon} {c.label}
            </button>
          ))}
        </div>
        <textarea value={jsonInput} onChange={e => setJsonInput(e.target.value)}
          className="w-full h-48 px-3 py-2 bg-black/40 border border-white/10 rounded-lg text-white text-xs font-mono outline-none focus:border-[#ec1c24] resize-y mb-3"
          placeholder='[{"_id": "example", "name": "test"}]' />
        <div className="flex gap-2">
          <button onClick={importCollection} disabled={importing || !jsonInput.trim()}
            className="px-4 py-2 rounded-full bg-[#ec1c24] text-white font-bold text-xs disabled:opacity-50">
            {importing ? "Importing…" : `Import into ${collection}`}
          </button>
          <label className="px-4 py-2 rounded-full bg-white/5 border border-white/10 text-white font-bold text-xs cursor-pointer hover:bg-white/10">
            Load File
            <input ref={fileRef} type="file" accept=".json" onChange={handleFile} className="hidden" />
          </label>
          {jsonInput && <button onClick={() => setJsonInput("")} className="px-4 py-2 rounded-full bg-white/5 border border-white/10 text-white/50 font-bold text-xs">Clear</button>}
        </div>
      </div>

      {lastResult && (
        <div className={`px-4 py-3 rounded-xl text-sm font-bold ${resultType === "ok" ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400"}`}>
          {resultType === "ok" ? "✓ " : "✗ "}{lastResult}
        </div>
      )}
    </div>
  );
}

// ── CONFIG ───────────────────────────────────────────────────
function ConfigTab({ api }: { api: (p: string, o?: RequestInit) => Promise<Response> }) {
  const [cfg, setCfg] = useState<ConfigData | null>(null);
  const [toast, setToast] = useState("");

  const load = useCallback(async () => {
    try { const res = await api("/admin/config"); if (res.ok) setCfg(await res.json()); } catch {}
  }, [api]);

  useEffect(() => { load(); }, [load]);

  const invalidateCache = async () => {
    if (!confirm("Invalidate all caches?")) return;
    try {
      const res = await api("/admin/cache/invalidate", { method: "POST" });
      if (res.ok) { setToast("Cache invalidated"); setTimeout(() => setToast(""), 2500); load(); }
    } catch {}
  };

  return (
    <div className="space-y-6">
      {toast && (
        <div className="fixed top-4 right-4 z-50 px-4 py-2 rounded-xl text-sm font-bold bg-green-500/20 text-green-400 border border-green-500/30 shadow-lg">
          {toast}
        </div>
      )}

      {cfg?.cache && (
        <div className="bg-[#1c1c1e]/70 border border-white/[0.06] rounded-2xl p-5">
          <h3 className="text-xs font-bold text-white/45 uppercase tracking-wider mb-4">In-Memory Cache</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {Object.entries(cfg.cache).map(([k, v]) => (
              <div key={k} className="bg-white/[0.03] rounded-xl p-3">
                <div className="text-white/35 text-[10px] uppercase font-bold tracking-wider mb-1">{k}</div>
                <div className="text-xl font-extrabold text-white tabular-nums">{v}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="bg-[#1c1c1e]/70 border border-white/[0.06] rounded-2xl p-5">
        <h3 className="text-xs font-bold text-white/45 uppercase tracking-wider mb-4">Cache Management</h3>
        <p className="text-xs text-white/40 mb-4">Clear all in-memory caches. Data will be reloaded from MongoDB on next access.</p>
        <button onClick={invalidateCache} className="px-4 py-2.5 rounded-full bg-yellow-500/20 text-yellow-400 font-bold text-xs hover:bg-yellow-500/30 transition">Invalidate All Caches</button>
      </div>
    </div>
  );
}

function StatCard({ title, value, hint }: { title: string; value: string | number; hint?: string }) {
  return (
    <div className="bg-[#1c1c1e]/70 border border-white/[0.06] rounded-2xl p-4 sm:p-5 backdrop-blur-sm">
      <h3 className="text-xs font-bold text-white/45 uppercase tracking-wider mb-2">{title}</h3>
      <div className="text-2xl font-extrabold text-white tabular-nums">{value}</div>
      {hint && <div className="text-[11px] text-white/35 mt-1">{hint}</div>}
    </div>
  );
}
