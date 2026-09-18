/**
 * LankaTV Next.js Custom Server
 * Merges dplay/server.js + play-login/server.js into one process
 */
import dotenv from "dotenv";
dotenv.config();

import express from "express";
import next from "next";
import { createServer } from "http";
import https from "https";
import http from "http";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import zlib from "zlib";
import { Server as SocketIOServer } from "socket.io";
import { URL } from "url";
import {
  encryptStreamPath,
  decryptStreamPath,
  createAdminSession,
  verifyAdminSession,
  signDrmToken,
  verifyDrmToken,
  verifySessionToken,
  createSessionToken,
  parseSessionPayload,
  makeUid,
  normalizeMobile,
  maskMobile,
  timingSafePassword,
} from "./src/lib/crypto";
import {
  buildViuHeaders,
  httpsRequest,
  httpsRequestFollow,
  applyCdn,
  extractChannelId,
  fetchChannelsFromViu,
  fetchMovieDetail,
  fetchSeriesDetail,
  sendOtp as viuSendOtp,
  fetchOtpLogin,
  imgUrl,
  listViuDevices,
  registerViuDevice,
  deleteViuDevice,
  startRegistration,
  registerDeviceV2,
  fetchWvLicenseProxyUrlLive,
  fetchWvLicenseProxyUrlVod,
  fetchFairPlayLicenseUrlLive,
  fetchFairPlayLicenseUrlVod,
  fetchViuDevices,
  refreshDeviceTokens,
} from "./src/lib/viu";
import {
  loadChannels,
  loadCategoriesIndex,
  loadCategoryFile,
  loadEpgJson,
  loadUidMap,
  saveUidMap,
  loadTokensFile,
  saveTokensFile,
  loadTokensStore,
  saveTokensStore,
  loadDevice,
  saveDevice,
  getTvLicenseUrl,
  getMoviesLicenseUrl,
  saveChannelsSync,
  saveCategoriesIndexSync,
  saveCategoryFileSync,
  getAllDevices,
  getAllTokens,
  deleteDevice,
  deleteToken,
  reloadFromMongo,
  getCacheSizes,
} from "./src/lib/data";
import { connectMongo, closeMongo } from "./src/lib/mongo";
import { initFromMongo } from "./src/lib/data";
import { VIU_ORIGIN, VIU_REFERER, USER_AGENT, DRM_USER_AGENT, FP_DRM_USER_AGENT, FP_CERT_URL, UPSTREAM_CATEGORY_IDS, VOD_PACKAGES } from "./src/lib/constants";

const dev = process.env.NODE_ENV !== "production";
const PORT = parseInt(process.env.PORT || "3009", 10);
const app = next({ dev });
const handle = app.getRequestHandler();

// ================================================================
// CONFIG
// ================================================================
const MPD_PROXY = (process.env.MPD_PROXY || "false").toLowerCase() === "true";
const SERVER_FALLBACK_RESOLVE = (process.env.SERVER_FALLBACK_RESOLVE || "true").toLowerCase() === "true";
const LIVE_REDIRECT = (process.env.LIVE_REDIRECT || "true").toLowerCase() === "true";
const ALLOW_LEGACY_STREAMS = (process.env.ALLOW_LEGACY_STREAMS || "false").toLowerCase() === "true";
const AUTO_REFRESH_MINUTES = parseInt(process.env.AUTO_REFRESH_MINUTES || "0", 10);
const EPG_REFRESH_MINUTES = parseInt(process.env.EPG_REFRESH_MINUTES || "30", 10);

const DATA_DIR = path.join(process.cwd(), "data");
const CATEGORIES_DIR = path.join(DATA_DIR, "categories");
const CATEGORIES_INDEX = path.join(DATA_DIR, "categories.json");
const CHANNELS_FILE = path.join(DATA_DIR, "channels.json");
const EPG_XML_FILE = path.join(DATA_DIR, "epg.xml");
const EPG_GZ_FILE = path.join(DATA_DIR, "epg.xml.gz");
const EPG_JSON_FILE = path.join(DATA_DIR, "epg.json");
const PSSH_CACHE_FILE = path.join(DATA_DIR, "pssh-cache.json");
const UID_FILE = path.join(DATA_DIR, "uid-map.json");
const TOKENS_FILE = path.join(process.cwd(), "tokens.json");
const DRM_TOKENS_FILE = path.join(process.cwd(), "..", "tokens.json");
const DEVICES_DIR = path.join(process.cwd(), "devices");
const STREAM_ENCRYPTION_KEY = process.env.STREAM_ENCRYPTION_KEY || "";
const STREAM_TOKEN_TTL_MS = parseInt(process.env.STREAM_TOKEN_TTL_MS || "86400000", 10);
const DRM_LICENSE_TTL_MS = parseInt(process.env.DRM_LICENSE_TTL_MS || "86400000", 10);
const DRM_ALLOWED_ORIGIN = process.env.DRM_ALLOWED_ORIGIN || "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const SOCKET_SECRET = process.env.SOCKET_SECRET || "";
const LIVE_MPD_CACHE_TTL_MS = 4000;
const VOD_MPD_CACHE_TTL_MS = 60000;
const MAX_SOCKETS_PER_HOST = 20;
const SOCKET_RESOLVE_TIMEOUT_MS = 15000;
const CONCURRENT_EPG_BATCH = 6;

// ── Rate limiting (simple in-memory) ────────────────────────────
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
function rateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(key);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (entry.count >= max) return false;
  entry.count++;
  return true;
}
// Cleanup every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of rateLimitMap) { if (now > v.resetAt) rateLimitMap.delete(k); }
}, 5 * 60 * 1000);

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(CATEGORIES_DIR)) fs.mkdirSync(CATEGORIES_DIR, { recursive: true });
if (!fs.existsSync(DEVICES_DIR)) fs.mkdirSync(DEVICES_DIR, { recursive: true, mode: 0o700 });

// ================================================================
// LOGGING
// ================================================================
function log(...args: unknown[]) {
  console.log(
    `[${new Date().toISOString().slice(11, 19)}]`,
    args.map((a) => (typeof a === "string" ? a : String(a))).join(" ")
  );
}

// ================================================================
// UID MAP (local state)
// ================================================================
const UID_SECRET = STREAM_ENCRYPTION_KEY + ":uid";
let UID_MAP = loadUidMap();

function makeUidLocal(type: string, realId: string | number): string {
  const key = `${type}:${realId}`;
  if (UID_MAP.reverse[key]) return UID_MAP.reverse[key];
  const h = crypto.createHmac("sha256", UID_SECRET).update(key).digest();
  const uid = h.slice(0, 12).toString("base64url");
  UID_MAP.forward[uid] = { type, realId: String(realId) };
  UID_MAP.reverse[key] = uid;
  scheduleUidSave();
  return uid;
}

function resolveUid(uid: string) {
  return UID_MAP.forward[uid] || null;
}

let uidSaveTimer: NodeJS.Timeout | null = null;
function scheduleUidSave() {
  if (uidSaveTimer) return;
  uidSaveTimer = setTimeout(() => {
    uidSaveTimer = null;
    saveUidMap(UID_MAP);
  }, 3000);
}

// ================================================================
// EPISODE → CM_EPISODE INDEX
// ================================================================
const EPISODE_CM_CACHE = new Map<string, string>();
const EPISODE_CM_CACHE_MAX = 5000;

function indexSeriesEpisodes(seriesData: { seasons?: Array<{ episodes?: Array<{ id?: string | number; cm_episode?: string }> }> }): number {
  if (!seriesData || !Array.isArray(seriesData.seasons)) return 0;
  let n = 0;
  for (const season of seriesData.seasons) {
    for (const ep of season.episodes || []) {
      if (!ep || ep.id == null || !ep.cm_episode) continue;
      if (EPISODE_CM_CACHE.size >= EPISODE_CM_CACHE_MAX) {
        const first = EPISODE_CM_CACHE.keys().next().value;
        if (first) EPISODE_CM_CACHE.delete(first);
      }
      EPISODE_CM_CACHE.set(String(ep.id), String(ep.cm_episode));
      n++;
    }
  }
  return n;
}

function indexAllEpisodesFromDisk(): number {
  const idx = loadCategoriesIndex();
  if (!idx || !Array.isArray(idx.data)) return 0;
  let n = 0;
  for (const cat of idx.data) {
    const file = loadCategoryFile(cat.id);
    if (!file || !Array.isArray(file.content)) continue;
    for (const item of file.content) {
      if (!item || item.type !== "series") continue;
      if (Array.isArray(item.seasons)) {
        n += indexSeriesEpisodes({ seasons: item.seasons as { episodes: { id: string; cm_episode: string }[] }[] });
      }
      if (Array.isArray(item.episodes)) {
        for (const ep of item.episodes) {
          if (ep && ep.id != null && ep.cm_episode) {
            if (EPISODE_CM_CACHE.size >= EPISODE_CM_CACHE_MAX) {
              const first = EPISODE_CM_CACHE.keys().next().value;
              if (first) EPISODE_CM_CACHE.delete(first);
            }
            EPISODE_CM_CACHE.set(String(ep.id), String(ep.cm_episode));
            n++;
          }
        }
      }
    }
  }
  return n;
}

// ================================================================
// HTTP AGENT
// ================================================================
const httpsAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 30000,
  maxSockets: MAX_SOCKETS_PER_HOST,
  maxFreeSockets: 10,
  timeout: 60000,
  scheduling: "fifo",
});

// ================================================================
// TOKEN STORE (Viu API auth)
// ================================================================
let tokens = { access: "", refresh: "", expiresAt: 0 };
let refreshing: Promise<string> | null = null;

function decodeJwtExp(jwt: string): number {
  try {
    const p = JSON.parse(
      Buffer.from(jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString()
    );
    return p.exp ? p.exp * 1000 : 0;
  } catch {
    return 0;
  }
}

function loadTokens() {
  try {
    const store = loadTokensStore();
    const deviceUids = Object.keys(store);
    if (deviceUids.length > 0) {
      let latest: Record<string, unknown> | null = null;
      for (const uid of deviceUids) {
        const entries = store[uid];
        if (Array.isArray(entries) && entries.length > 0) {
          const entry = entries[entries.length - 1] as Record<string, unknown>;
          if (!latest || String(entry.captured_at || "") > String(latest.captured_at || "")) {
            latest = entry;
          }
        }
      }
      if (latest && latest.access_token) {
        tokens.access = String(latest.access_token || "");
        tokens.refresh = String(latest.refresh_token || "");
        tokens.expiresAt = decodeJwtExp(tokens.access);
        log(`[tokens] Loaded from device store — expires in ${Math.round((tokens.expiresAt - Date.now()) / 60000)} min`);
        return;
      }
    }
  } catch {}
  for (const f of [DRM_TOKENS_FILE, TOKENS_FILE]) {
    try {
      const d = JSON.parse(fs.readFileSync(f, "utf8")) as Record<string, string>;
      if (d.access) {
        tokens.access = d.access || "";
        tokens.refresh = d.refresh || "";
        tokens.expiresAt = decodeJwtExp(tokens.access);
        log(`[tokens] Loaded from ${path.basename(f)} — expires in ${Math.round((tokens.expiresAt - Date.now()) / 60000)} min`);
        return;
      }
    } catch {}
  }
  log("[tokens] No tokens found");
}

function saveTokensExtra(extra: Record<string, unknown> = {}) {
  try {
    const rootPath = path.join(process.cwd(), "..", "tokens.json");
    if (fs.existsSync(rootPath)) {
      const root = JSON.parse(fs.readFileSync(rootPath, "utf8"));
      root.access = tokens.access;
      root.refresh = tokens.refresh;
      Object.assign(root, extra);
      fs.writeFileSync(rootPath, JSON.stringify(root, null, 2), { mode: 0o600 });
    }
  } catch {}
  // Also save to MongoDB
  try {
    saveTokensFile({ access: tokens.access, refresh: tokens.refresh, ...extra });
  } catch {}
}

async function refreshToken(): Promise<string> {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    log("[auth] Refreshing…");
    const res = await fetch("https://api.viu.lk/api/client/v2/global/refresh", {
      method: "POST",
      headers: {
        accept: "application/json, text/plain, */*",
        "accept-language": "en-GB,en;q=0.9",
        authorization: `Bearer ${tokens.access}`,
        "content-type": "application/json",
        origin: VIU_ORIGIN,
        referer: VIU_REFERER,
        "user-agent": USER_AGENT,
      },
      body: JSON.stringify({ refresh_token: tokens.refresh }),
    });
    if (!res.ok) throw new Error(`Refresh HTTP ${res.status}`);
    const j = await res.json();
    tokens.access = j.data.access_token;
    tokens.refresh = j.data.refresh_token;
    tokens.expiresAt = decodeJwtExp(tokens.access);
    saveTokensExtra();
    log(`[auth] ✅ Refreshed — valid ${Math.round((tokens.expiresAt - Date.now()) / 60000)} min`);
    return tokens.access;
  })();
  try {
    return await refreshing;
  } finally {
    refreshing = null;
  }
}

async function getToken(): Promise<string> {
  try {
    if (!tokens.access || Date.now() > tokens.expiresAt - 5 * 60 * 1000) await refreshToken();
    return tokens.access;
  } catch {
    const store = loadTokensStore();
    const uid = Object.keys(store)[0];
    if (uid) {
      const latest = loadLatestTokens(uid);
      if (latest?.access_token) return latest.access_token as string;
    }
    throw new Error("no token available");
  }
}

// ================================================================
// TTL CACHE
// ================================================================
class TTLCache {
  private map = new Map<string, { val: string; exp: number }>();
  constructor(private maxSize = 200) {}
  get(key: string): string | null {
    const v = this.map.get(key);
    if (!v) return null;
    if (Date.now() > v.exp) { this.map.delete(key); return null; }
    return v.val;
  }
  set(key: string, val: string, ttlMs: number) {
    if (this.map.size >= this.maxSize) {
      const firstKey = this.map.keys().next().value;
      if (firstKey) this.map.delete(firstKey);
    }
    this.map.set(key, { val, exp: Date.now() + ttlMs });
  }
  get size() {
    return this.map.size;
  }
}
const mpdCache = new TTLCache(200);
const m3u8Cache = new TTLCache(200);

// ================================================================
// PSSH CACHE
// ================================================================
let psshCache: Record<string, { pssh: string; ts: number }> = {};
try {
  if (fs.existsSync(PSSH_CACHE_FILE)) {
    psshCache = JSON.parse(fs.readFileSync(PSSH_CACHE_FILE, "utf8"));
    log(`[pssh-cache] Loaded ${Object.keys(psshCache).length} entries`);
  }
} catch {}
let psshSaveTimer: NodeJS.Timeout | null = null;

function psshCacheSet(key: string, value: string) {
  psshCache[key] = { pssh: value, ts: Date.now() };
  if (psshSaveTimer) clearTimeout(psshSaveTimer);
  psshSaveTimer = setTimeout(() => {
    try {
      fs.writeFileSync(PSSH_CACHE_FILE, JSON.stringify(psshCache, null, 2));
    } catch {}
  }, 2000);
}

function psshCacheGet(key: string): string | null {
  const v = psshCache[key];
  if (!v) return null;
  if (Date.now() - v.ts > 24 * 3600 * 1000) {
    delete psshCache[key];
    return null;
  }
  return v.pssh;
}

function cleanupPsshCache() {
  const now = Date.now();
  let removed = 0;
  for (const [k, v] of Object.entries(psshCache)) {
    if (now - v.ts > 24 * 3600 * 1000) { delete psshCache[k]; removed++; }
  }
  if (removed > 0) {
    log(`[pssh-cache] Cleaned ${removed} expired entries`);
    try { fs.writeFileSync(PSSH_CACHE_FILE, JSON.stringify(psshCache, null, 2)); } catch {}
  }
}

// ================================================================
// PSSH EXTRACTION
// ================================================================
function extractPsshFromMp4(buffer: Buffer): string | null {
  if (!buffer || buffer.length < 8) return null;
  try {
    const WID = Buffer.from("edef8ba979d64acea3c827dcd51d21ed", "hex");
    let offset = 0;
    const end = buffer.length;
    while (offset < end - 8) {
      const pos = buffer.indexOf("pssh", offset);
      if (pos === -1) break;
      const start = pos - 4;
      if (start < 0) {
        offset = pos + 4;
        continue;
      }
      try {
        const size = buffer.readUInt32BE(start);
        if (size < 28 || start + size > end) {
          offset = pos + 4;
          continue;
        }
        const box = buffer.slice(start, start + size);
        if (box.length >= 28 && box.slice(12, 28).equals(WID)) return box.toString("base64");
        offset = start + size;
      } catch {
        offset = pos + 4;
      }
    }
  } catch {}
  return null;
}

async function fetchPsshFromAudio(mpdUrl: string, mpdBody: Buffer): Promise<string | null> {
  try {
    const xml = mpdBody.toString("utf8");
    const baseUrlMatch = xml.match(/<BaseURL>([^<]+)<\/BaseURL>/);
    let segBase: string;
    if (baseUrlMatch) {
      let base = baseUrlMatch[1].trim();
      if (!/^https?:\/\//i.test(base)) base = new URL(base, mpdUrl).toString();
      if (!base.endsWith("/")) base += "/";
      segBase = base;
    } else {
      const p = new URL(mpdUrl);
      const dirPath = p.pathname.replace(/\/[^/]*$/, "/");
      segBase = `${p.protocol}//${p.hostname}${dirPath}dash/`;
    }
    const aMatch = xml.match(
      /<AdaptationSet[^>]*(?:contentType="audio"|mimeType="[^"]*audio[^"]*")[^>]*>([\s\S]*?)<\/AdaptationSet>/
    );
    if (!aMatch) return null;
    const audio = aMatch[1];
    const tplMatch = audio.match(/<SegmentTemplate\b[^>]*>/);
    if (!tplMatch) return null;
    const mediaAttr = (tplMatch[0].match(/media="([^"]+)"/) || [])[1];
    if (!mediaAttr) return null;
    const reps: Array<{ id: string; bw: number }> = [];
    const repRe = /<Representation\b[^>]*>/g;
    let m;
    while ((m = repRe.exec(audio))) {
      const tag = m[0];
      const id = (tag.match(/id="([^"]+)"/) || [])[1];
      const bw = parseInt((tag.match(/bandwidth="(\d+)"/) || [])[1] || "999999999", 10);
      if (id) reps.push({ id, bw });
    }
    if (!reps.length) return null;
    reps.sort((a, b) => a.bw - b.bw);
    const tlMatch = audio.match(/<SegmentTimeline>([\s\S]*?)<\/SegmentTimeline>/);
    if (!tlMatch) return null;
    const sRe = /<S\b[^>]*\/?>/g;
    const segments: Array<{ t: number; d: number; r: number }> = [];
    while ((m = sRe.exec(tlMatch[1]))) {
      const tag = m[0];
      const t = parseInt((tag.match(/t="(-?\d+)"/) || [])[1] || "0", 10);
      const d = parseInt((tag.match(/d="(\d+)"/) || [])[1] || "0", 10);
      const r = parseInt((tag.match(/r="(-?\d+)"/) || [])[1] || "0", 10);
      segments.push({ t, d, r });
    }
    if (!segments.length) return null;
    const first = segments[0];
    const last = segments[segments.length - 1];
    const times: number[] = [];
    if (segments.length >= 2 || first.r >= 1) times.push(first.t + first.d);
    if (segments.length >= 3) times.push(segments[2].t);
    times.push(first.t);
    if (last.t !== first.t) times.push(last.t);
    const attempts: string[] = [];
    for (const rep of reps.slice(0, 2)) {
      for (const t of times.slice(0, 2)) {
        const segName = mediaAttr
          .replace(/\$RepresentationID\$/g, rep.id)
          .replace(/\$Time\$/g, String(t))
          .replace(/\$Number\$/g, "1");
        attempts.push(segBase + segName);
      }
    }
    const results = await Promise.allSettled(
      attempts.map(async (segUrl) => {
        try {
          const u = new URL(segUrl);
          const segRes = await httpsRequestFollow({
            method: "GET",
            hostname: u.hostname,
            path: u.pathname + u.search,
            headers: { "user-agent": USER_AGENT, accept: "*/*", origin: VIU_ORIGIN, referer: VIU_REFERER },
          });
          if (segRes.statusCode !== 200 || !segRes.body) return null;
          return extractPsshFromMp4(segRes.body);
        } catch {
          return null;
        }
      })
    );
    for (const r of results) if (r.status === "fulfilled" && r.value) return r.value;
    return null;
  } catch {
    return null;
  }
}

function injectPssh(xml: string, psshB64: string): string {
  if (!psshB64) return xml;
  let out = xml;
  if (!out.includes("xmlns:cenc=")) out = out.replace(/<MPD\b/, '<MPD xmlns:cenc="urn:mpeg:cenc:2013"');
  out = out.replace(/<cenc:pssh>[\s\S]*?<\/cenc:pssh>/g, "");
  const el = `<cenc:pssh>${psshB64}</cenc:pssh>`;
  const uri = "urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed";
  const sc = new RegExp(`(<ContentProtection\\b[^>]*schemeIdUri="${uri}"[^>]*?)\\/>`, "i");
  if (sc.test(out)) return out.replace(sc, (m, pre) => `${pre}>${el}</ContentProtection>`);
  const pr = new RegExp(`(<ContentProtection\\b[^>]*schemeIdUri="${uri}"[^>]*>)([\\s\\S]*?)(<\\/ContentProtection>)`, "i");
  if (pr.test(out)) return out.replace(pr, (m, o, i, c) => `${o}${i}${el}${c}`);
  return out;
}

function rewriteBaseUrl(xml: string, newBase: string): string {
  if (!newBase) return xml;
  if (/<BaseURL>/.test(xml)) return xml.replace(/<BaseURL>[\s\S]*?<\/BaseURL>/, `<BaseURL>${newBase}</BaseURL>`);
  return xml.replace(/<MPD\b[^>]*>/, (m) => m + `<BaseURL>${newBase}</BaseURL>`);
}

function rewriteM3u8Urls(m3u8: string, cdnBase: string): string {
  const lines = m3u8.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith("#")) continue;
    if (/^https?:\/\//i.test(line)) continue;
    const resolved = new URL(line, cdnBase).toString();
    lines[i] = applyCdn(resolved);
  }
  return lines.join("\n");
}

function extractBeginFromUrl(url: string): string | null {
  const m = url.match(/begin=(\d{8}T\d{6})/);
  return m ? m[1] : null;
}

function extractEndFromUrl(url: string): string | null {
  const m = url.match(/end=(\d{8}T\d{6})/);
  return m ? m[1] : null;
}

// ================================================================
// SOCKET.IO STATE
// ================================================================
const SOCKET_STATS = {
  totalConnections: 0,
  totalResolves: 0,
  totalDelegateResolves: 0,
  io: null as SocketIOServer | null,
  connectedAt: new Map<string, { ip: string; ua: string; ts: number }>(),
  rrIndex: 0,
};
const PENDING_RESOLVES = new Map<string, { resolve: Function; reject: Function; timer: NodeJS.Timeout; socketId: string }>();

function pickClient() {
  const io = SOCKET_STATS.io;
  if (!io) return null;
  const sockets = [...io.sockets.sockets.values()];
  if (!sockets.length) return null;
  return sockets[SOCKET_STATS.rrIndex++ % sockets.length];
}

function delegateResolve(url: string, timeoutMs = SOCKET_RESOLVE_TIMEOUT_MS): Promise<{ finalUrl: string; httpStatus: number; hops: number; contentType: string }> {
  return new Promise((resolve, reject) => {
    const socket = pickClient();
    if (!socket) return reject(new Error("No socket client connected"));
    const id = crypto.randomBytes(8).toString("hex");
    const timer = setTimeout(() => {
      PENDING_RESOLVES.delete(id);
      reject(new Error("Client resolve timeout"));
    }, timeoutMs);
    PENDING_RESOLVES.set(id, { resolve, reject, timer, socketId: socket.id });
    socket.emit("get_stream_data", { url, id }, (response: Record<string, unknown>) => {
      const pending = PENDING_RESOLVES.get(id);
      if (!pending) return;
      clearTimeout(pending.timer);
      PENDING_RESOLVES.delete(id);
      if (!response || response.status !== "ok") return reject(new Error(String(response?.message || "unknown error")));
      resolve({
        finalUrl: String(response.manifest || ""),
        httpStatus: Number(response.httpStatus || 200),
        hops: Number(response.hops || 1),
        contentType: String(response.contentType || ""),
      });
    });
  });
}

// ================================================================
// FLATTEN CHANNELS
// ================================================================
function flattenChannels(cj: unknown): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();
  const push = (c: Record<string, unknown>) => {
    if (!c || typeof c !== "object") return;
    if (!c.cm_channel && !c.uid) return;
    const k = String(c.uid || c.cm_channel);
    if (seen.has(k)) return;
    seen.add(k);
    out.push(c);
  };
  if (Array.isArray(cj)) cj.forEach((c) => push(c as Record<string, unknown>));
  else if (cj && typeof cj === "object") {
    const obj = cj as Record<string, unknown>;
    if (Array.isArray(obj.data)) {
      (obj.data as unknown[]).forEach((n) => {
        const node = n as Record<string, unknown>;
        if (Array.isArray(node.content)) node.content.forEach((c) => push(c as Record<string, unknown>));
        else push(node);
      });
    }
  }
  return out;
}

function pickLogo(logos: Record<string, unknown> | null): number | null {
  if (!logos || typeof logos !== "object") return null;
  return (logos.CARD || logos.NORMAL || logos.LEGACY) as number | null;
}

function projectChannel(ch: Record<string, unknown>) {
  if (!ch || typeof ch !== "object") return null;
  const realId = ch.id || ch.channel_id || ch.uid;
  if (!realId) return null;
  const uid = makeUidLocal("c", realId);
  scheduleUidSave();
  return {
    uid,
    name: String(ch.name || ch.title || "").trim() || "Channel",
    number: ch.epg_channel || null,
    logo: pickLogo(ch.logos as Record<string, unknown> | null),
    normalLogo: (ch.logos as Record<string, unknown> | null)?.NORMAL as number || null,
    resolution: ch.resolution || null,
    catchup: !!ch.timeshiftable,
    catchupHours: ch.ts_rec_duration || ch.rec_duration || null,
  };
}

function projectCategory(cat: { id: number; name?: string; desc?: string; uid?: string }, itemCount: number) {
  if (!cat || cat.id == null) return null;
  const uid = makeUidLocal("k", cat.id);
  scheduleUidSave();
  return {
    uid,
    name: String(cat.name || `Category ${cat.id}`),
    desc: cat.desc ? String(cat.desc) : "",
    total: itemCount || 0,
  };
}

function projectVodItem(item: Record<string, unknown>, categoryUid: string | null) {
  if (!item || item.id == null) return null;
  const isSeries = item.type === "series";
  const uid = makeUidLocal(isSeries ? "s" : "m", item.id as string | number);
  scheduleUidSave();
  return {
    uid,
    title: String(item.title || "Untitled"),
    type: isSeries ? "series" : "movie",
    year: item.year ? Number(item.year) : null,
    duration: item.duration ? Number(item.duration) : null,
    poster: item.image_id || item.preview_image_id || null,
    category: categoryUid || null,
  };
}

function projectProgram(p: { start: string; end: string; title: string; desc: string; img: number | null }) {
  return { start: p.start, end: p.end, title: p.title || "", desc: p.desc || "", img: p.img || null };
}

// ================================================================
// VIU CATEGORY FETCHERS
// ================================================================
async function fetchCategoryFromViu(catId: number): Promise<unknown> {
  const token = await getToken();
  const up = await httpsRequest({
    method: "GET",
    hostname: "api2.viu.lk",
    path: `/api/client/v1/default/categories/vod/content?translation=en&limit=5000&categories=${catId}&packages=${VOD_PACKAGES}`,
    headers: buildViuHeaders(token),
  });
  if (up.statusCode !== 200) throw new Error(`Category ${catId} HTTP ${up.statusCode}`);
  return JSON.parse(up.body.toString("utf8"));
}

async function fetchCategoriesListFromViu(): Promise<Array<Record<string, unknown>>> {
  const token = await getToken();
  const up = await httpsRequest({
    method: "GET",
    hostname: "api3.viu.lk",
    path: `/api/client/v3/default/categories/vod?translation=en&parent_category_id=top&empty=false&packages=${VOD_PACKAGES}`,
    headers: buildViuHeaders(token),
  });
  if (up.statusCode !== 200) throw new Error(`Categories list HTTP ${up.statusCode}`);
  const j = JSON.parse(up.body.toString("utf8"));
  if (!Array.isArray(j.data)) throw new Error("Categories list: no data");
  return j.data;
}

async function rebuildCategoryFile(catId: number) {
  const raw = (await fetchCategoryFromViu(catId)) as Record<string, unknown>;
  const items: unknown[] = [];
  const seen = new Set<string>();
  const data = raw.data as Array<Record<string, unknown>> | undefined;
  (data || []).forEach((c) => {
    (c.content || []).forEach((i: unknown) => {
      const item = i as Record<string, unknown>;
      if (item.id && !seen.has(String(item.id))) {
        seen.add(String(item.id));
        items.push(item);
      }
    });
  });
  const upstreamMeta =
    Array.isArray(data) && data[0]
      ? {
          id: data[0].id,
          uid: data[0].uid,
          name: data[0].name,
          desc: data[0].desc,
          movies_count: data[0].movies_count,
          series_count: data[0].series_count,
        }
      : { id: catId };
  const payload = {
    status: "ok",
    id: catId,
    updatedAt: new Date().toISOString(),
    meta: upstreamMeta,
    content: items,
  };
  fs.writeFileSync(path.join(CATEGORIES_DIR, `${catId}.json`), JSON.stringify(payload, null, 2), "utf8");
  saveCategoryFileSync(catId, payload);
  log(`[cat] ${catId} → ${items.length} items`);
  return payload;
}

async function rebuildCategoriesIndex() {
  const cats = await fetchCategoriesListFromViu();
  const data = cats.map((c) => ({
    id: c.id,
    uid: c.uid || `cat_${c.id}`,
    name: c.name || `Category ${c.id}`,
    desc: c.desc || "",
    movies_count: c.movies_count || 0,
    series_count: c.series_count || 0,
    updatedAt: new Date().toISOString(),
  }));
  const payload = { status: "ok", updatedAt: new Date().toISOString(), data };
  fs.writeFileSync(CATEGORIES_INDEX, JSON.stringify(payload, null, 2), "utf8");
  saveCategoriesIndexSync(payload);
  log(`[cat-index] Saved ${data.length} categories from v3 API`);
  return payload;
}

async function rebuildAllCategories() {
  // Fetch category list from v3 API
  const cats = await fetchCategoriesListFromViu();
  const catIds = cats.map((c) => Number(c.id)).filter(Boolean);
  log(`[cat] Rebuilding ${catIds.length} categories from v3 API…`);
  const PARALLEL = 4;
  const results = { ok: 0, failed: 0, errors: [] as unknown[] };
  for (let i = 0; i < catIds.length; i += PARALLEL) {
    const group = catIds.slice(i, i + PARALLEL);
    const settled = await Promise.allSettled(group.map((id) => rebuildCategoryFile(id)));
    settled.forEach((r, idx) => {
      if (r.status === "fulfilled") results.ok++;
      else {
        results.failed++;
        results.errors.push({ id: group[idx], error: (r.reason as Error)?.message });
      }
    });
  }
  await rebuildCategoriesIndex();
  indexAllEpisodesFromDisk();
  return results;
}

async function refreshChannelsFile() {
  const token = await getToken();
  const j = await fetchChannelsFromViu(token);
  fs.writeFileSync(CHANNELS_FILE, JSON.stringify(j, null, 2), "utf8");
  saveChannelsSync(j as unknown as Record<string, unknown>);
  const n = Array.isArray((j as Record<string, unknown>).data) ? ((j as Record<string, unknown>).data as unknown[]).length : 0;
  log(`[refresh] channels.json — ${n}`);
  return { count: n, updatedAt: new Date().toISOString() };
}

// ================================================================
// EPG
// ================================================================
async function fetchEpgFromViu(channels: Array<Record<string, unknown>>): Promise<unknown> {
  const token = await getToken();
  const now = new Date();
  const s = new Date(now.getTime() - 4 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const e = new Date(now.getTime() + 4 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const ids = channels.map((c) => c.id || c.channel_id).filter(Boolean);
  if (!ids.length) throw new Error("No IDs");
  const CHUNK = 40;
  const chunks: (string | number)[][] = [];
  for (let i = 0; i < ids.length; i += CHUNK) chunks.push(ids.slice(i, i + CHUNK));
  const merged: { data: unknown[] } = { data: [] };
  for (let i = 0; i < chunks.length; i += CONCURRENT_EPG_BATCH) {
    const group = chunks.slice(i, i + CONCURRENT_EPG_BATCH);
    const results = await Promise.allSettled(
      group.map(async (chunk) => {
        try {
          const up = await httpsRequest({
            method: "GET",
            hostname: "api1.viu.lk",
            path: `/api/client/v2/default/shows/grid?start_date=${s}&end_date=${e}&channels=${chunk.join(",")}&limit=500`,
            headers: buildViuHeaders(token),
          });
          if (up.statusCode !== 200) return null;
          const j = JSON.parse(up.body.toString("utf8"));
          return Array.isArray(j.data) ? j.data : null;
        } catch {
          return null;
        }
      })
    );
    for (const r of results) if (r.status === "fulfilled" && Array.isArray(r.value)) merged.data.push(...r.value);
  }
  if (!merged.data.length) throw new Error("EPG 0");
  return merged;
}

async function fetchEpgPerChannel(channels: Array<Record<string, unknown>>, s: string, e: string): Promise<unknown> {
  const token = await getToken();
  const merged: { data: unknown[] } = { data: [] };
  const PARALLEL = 8;
  for (let i = 0; i < channels.length; i += PARALLEL) {
    const group = channels.slice(i, i + PARALLEL);
    const results = await Promise.allSettled(
      group.map(async (ch) => {
        const id = ch.id || ch.channel_id;
        if (!id) return null;
        try {
          const up = await httpsRequest({
            method: "GET",
            hostname: "api1.viu.lk",
            path: `/api/client/v2/default/channels/${id}/shows?start_date=${s}&end_date=${e}&limit=500`,
            headers: buildViuHeaders(token),
          });
          if (up.statusCode !== 200) return null;
          const j = JSON.parse(up.body.toString("utf8"));
          const shows = j.data?.shows || j.data || [];
          return Array.isArray(shows) ? { id, shows } : null;
        } catch {
          return null;
        }
      })
    );
    for (const r of results) if (r.status === "fulfilled" && r.value) merged.data.push(r.value);
  }
  if (!merged.data.length) throw new Error("EPG pc 0");
  return merged;
}

function parseEpgPrograms(data: Record<string, unknown>) {
  const out: Array<Record<string, unknown>> = [];
  for (const entry of (data.data || []) as Array<Record<string, unknown>>) {
    const ch = entry.id;
    if (!ch) continue;
    for (const s of (entry.shows || []) as Array<Record<string, unknown>>) {
      if (!s.start || !s.end) continue;
      let sd: Date, ed: Date;
      try {
        sd = new Date(String(s.start));
        ed = new Date(String(s.end));
      } catch {
        continue;
      }
      if (isNaN(sd.getTime()) || isNaN(ed.getTime())) continue;
      out.push({
        pid: s.id || "",
        ch,
        start: sd.toISOString(),
        end: ed.toISOString(),
        title: s.title || "",
        desc: s.description || "",
        img: s.image_id || null,
      });
    }
  }
  out.sort((a, b) =>
    a.ch === b.ch ? String(a.start).localeCompare(String(b.start)) : String(a.ch).localeCompare(String(b.ch))
  );
  return out;
}

function xmlEsc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function xmltvTime(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    d.getUTCFullYear() +
    p(d.getUTCMonth() + 1) +
    p(d.getUTCDate()) +
    p(d.getUTCHours()) +
    p(d.getUTCMinutes()) +
    p(d.getUTCSeconds()) +
    " +0000"
  );
}

function buildXmltv(channels: Array<Record<string, unknown>>, programs: Array<Record<string, unknown>>): string {
  const L: string[] = [];
  L.push('<?xml version="1.0" encoding="UTF-8"?>');
  L.push("<!DOCTYPE tv SYSTEM \"xmltv.dtd\">");
  L.push('<tv generator-info-name="LankaTV">');
  for (const c of channels) {
    const id = c.id || c.channel_id;
    if (!id) continue;
    L.push(`  <channel id="${xmlEsc(id)}"><display-name>${xmlEsc(c.name || "")}</display-name></channel>`);
  }
  for (const p of programs) {
    L.push(`  <programme start="${xmltvTime(String(p.start))}" stop="${xmltvTime(String(p.end))}" channel="${xmlEsc(p.ch)}">`);
    L.push(`    <title lang="en">${xmlEsc(p.title)}</title>`);
    if (p.desc) L.push(`    <desc lang="en">${xmlEsc(p.desc)}</desc>`);
    L.push("  </programme>");
  }
  L.push("</tv>");
  return L.join("\n");
}

function saveEpgArtifacts(channels: Array<Record<string, unknown>>, programs: Array<Record<string, unknown>>) {
  const xml = buildXmltv(channels, programs);
  fs.writeFileSync(EPG_XML_FILE, xml, "utf8");
  fs.writeFileSync(EPG_GZ_FILE, zlib.gzipSync(Buffer.from(xml, "utf8"), { level: 6 }));
  fs.writeFileSync(
    EPG_JSON_FILE,
    JSON.stringify(
      {
        updatedAt: new Date().toISOString(),
        channels: channels.map((c) => ({ id: c.id, name: c.name, logos: c.logos, epg_channel: c.epg_channel })),
        programs,
      },
      null,
      2
    ),
    "utf8"
  );
}

let epgRefreshInFlight: Promise<unknown> | null = null;
let epgRefreshQueued = false;

async function refreshEpgFile() {
  if (epgRefreshInFlight) {
    epgRefreshQueued = true;
    return epgRefreshInFlight;
  }
  epgRefreshInFlight = (async () => {
    try {
      const cj = loadChannels();
      if (!cj) throw new Error("channels.json missing");
      const channels = flattenChannels(cj);
      if (!channels.length) throw new Error("no channels");
      let raw: unknown;
      try {
        raw = await fetchEpgFromViu(channels);
      } catch {
        const now = new Date();
        const s = new Date(now.getTime() - 4 * 24 * 3600 * 1000).toISOString().slice(0, 10);
        const e = new Date(now.getTime() + 4 * 24 * 3600 * 1000).toISOString().slice(0, 10);
        raw = await fetchEpgPerChannel(channels, s, e);
      }
      const programs = parseEpgPrograms(raw as Record<string, unknown>);
      saveEpgArtifacts(channels, programs);
      log(`[epg] Saved ${programs.length}`);
      return { count: programs.length, channels: channels.length, updatedAt: new Date().toISOString() };
    } finally {
      epgRefreshInFlight = null;
      if (epgRefreshQueued) {
        epgRefreshQueued = false;
        setImmediate(refreshEpgFile);
      }
    }
  })();
  return epgRefreshInFlight;
}

// ================================================================
// STREAM RESPONSE HELPER
// ================================================================
function extractAssetId(realPath: string): string {
  const match = realPath.match(/\/bpk-tv\/([^/]+)\/out\//);
  if (match) return match[1];
  const vodMatch = realPath.match(/\/bpk-vod\/[^/]+\/output\/([^/]+)\//);
  if (vodMatch) return vodMatch[1];
  return "";
}

function issueStreamResponse(kind: string, licenseKind: string, realPath: string, deviceUid?: string, contentUid?: string) {
  const streamToken = encryptStreamPath(realPath, STREAM_TOKEN_TTL_MS);
  const wvToken = signDrmToken(licenseKind, DRM_LICENSE_TTL_MS, deviceUid, "wv");
  const assetId = extractAssetId(realPath);
  const fpToken = signDrmToken(licenseKind, DRM_LICENSE_TTL_MS, deviceUid, "fp", assetId, contentUid);
  return {
    url: `/api/stream/t/${streamToken}`,
    license: `/api/drm/${wvToken}`,
    licenseWv: `/api/drm/${wvToken}`,
    licenseFp: `/api/drm/${fpToken}`,
    licenseExpires: Date.now() + DRM_LICENSE_TTL_MS,
    streamExpires: Date.now() + STREAM_TOKEN_TTL_MS,
    isLive: kind === "live" || kind === "catchup",
  };
}

// ================================================================
// OTP LOGIN (from play-login)
// ================================================================
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

interface LoginDevice {
  deviceUid: string;
  deviceClass: string;
  deviceOS: string;
  loginType: string;
  deviceType: string;
  createdAt: string;
  lastUsedAt: string;
}

function getOrCreateDevice(uuid: string): LoginDevice {
  const existing = loadDevice(uuid) as LoginDevice | null;
  if (existing) return existing;
  const now = new Date().toISOString();
  const d: LoginDevice = {
    deviceUid: uuid,
    deviceClass: "SMART_TV",
    deviceOS: "WEBOS",
    loginType: "WebOS",
    deviceType: "LG SmartTV",
    createdAt: now,
    lastUsedAt: now,
  };
  saveDevice(d as unknown as Record<string, unknown>);
  return d;
}

function isAccessTokenValid(token: Record<string, unknown>): boolean {
  if (!token?.expires_at) return false;
  return Date.now() < (Number(token.expires_at) - REFRESH_BUFFER_MS);
}

function isRefreshTokenValid(token: Record<string, unknown>): boolean {
  if (!token?.refresh_expires_at) return false;
  return Date.now() < (Number(token.refresh_expires_at) - REFRESH_BUFFER_MS);
}

function tokenStatus(token: Record<string, unknown> | null): string {
  if (!token) return "none";
  if (isAccessTokenValid(token)) return "access_valid";
  if (isRefreshTokenValid(token)) return "refresh_valid";
  return "expired";
}

function loadLatestTokens(uuid: string): Record<string, unknown> | null {
  const store = loadTokensStore();
  const arr = store[uuid] as Array<Record<string, unknown>> | undefined;
  const raw = arr?.length ? arr[arr.length - 1] : null;
  if (!raw) return null;

  const t = raw.tokens as Record<string, unknown> | undefined;
  if (t) return { ...raw, ...t };

  const wv = raw.widevine as Record<string, unknown> | undefined;
  if (wv) return { ...raw, ...wv };

  return raw;
}

const _deviceRefreshLocks = new Map<string, Promise<string>>();

async function ensureDeviceAccessToken(deviceUid: string): Promise<string | null> {
  const latest = loadLatestTokens(deviceUid);
  if (!latest?.access_token) return null;
  const accessValid = isAccessTokenValid(latest);
  if (accessValid) return latest.access_token as string;
  const refreshValid = isRefreshTokenValid(latest);
  if (!refreshValid) return null;

  const existing = _deviceRefreshLocks.get(deviceUid);
  if (existing) return existing;

  const promise = (async () => {
    try {
      const result = await refreshDeviceTokens(
        latest.access_token as string,
        latest.refresh_token as string
      );
      if (!result) return latest.access_token as string;
      const now = Date.now();
      const expiresAt = now + result.expires_in;
      let refreshExpiresAt: number | null = null;
      try {
        const payload = JSON.parse(Buffer.from(String(result.refresh_token).split(".")[1], "base64").toString());
        if (payload.exp) refreshExpiresAt = payload.exp * 1000;
      } catch {}
      const store = loadTokensStore();
      const arr = store[deviceUid] as Array<Record<string, unknown>> | undefined;
      if (arr && arr.length > 0) {
        const last = arr[arr.length - 1];
        const t = (last.tokens || last.widevine || last) as Record<string, unknown>;
        t.access_token = result.access_token;
        t.refresh_token = result.refresh_token;
        t.expires_at = expiresAt;
        t.refresh_expires_at = refreshExpiresAt;
        last.captured_at = new Date().toISOString();
        saveTokensStore(store);
        log(`[auth] Token refreshed for ${deviceUid.slice(0, 8)}… valid ${Math.round((expiresAt - now) / 60000)}min`);
      }
      return result.access_token;
    } catch (e) {
      log(`[auth] Refresh failed for ${deviceUid.slice(0, 8)}: ${(e as Error).message}`);
      return latest.access_token as string;
    } finally {
      _deviceRefreshLocks.delete(deviceUid);
    }
  })();
  _deviceRefreshLocks.set(deviceUid, promise);
  return promise;
}

async function refreshDeviceLicenseUrls(deviceUid: string): Promise<void> {
  const latest = loadLatestTokens(deviceUid);
  if (!latest?.access_token) return;
  const accessToken = latest.access_token as string;
  const userId = String(latest.user_id || "918558");
  try {
    const [liveUrl, vodUrl] = await Promise.all([
      fetchWvLicenseProxyUrlLive(accessToken, userId),
      fetchWvLicenseProxyUrlVod(accessToken, "23145", userId),
    ]);
    if (liveUrl || vodUrl) {
      const store = loadTokensStore();
      const arr = store[deviceUid] as Array<Record<string, unknown>> | undefined;
      if (arr && arr.length > 0) {
        const last = arr[arr.length - 1];
        const t = (last.tokens || last.widevine || last) as Record<string, unknown>;
        if (liveUrl) t.wv_license_proxy_url_live = liveUrl;
        if (vodUrl) t.wv_license_proxy_url_vod = vodUrl;
        if (liveUrl) t.fp_license_proxy_url_live = liveUrl.replace("/wv/license", "/fp/license");
        if (vodUrl) t.fp_license_proxy_url_vod = vodUrl.replace("/wv/license", "/fp/license");
        last.captured_at = new Date().toISOString();
        saveTokensStore(store);
      }
    }
  } catch {}
}

function ensureFairPlayAccessToken(deviceUid: string): Promise<string | null> {
  return ensureDeviceAccessToken(deviceUid);
}

function saveLoginTokens(device: LoginDevice, loginData: Record<string, unknown>, mobileNumber: string | null, prefetchedWv?: { live: string | null; vod: string | null }) {
  const d = (loginData.data || loginData) as Record<string, unknown>;
  if (!d?.access_token) return null;

  let resolvedMobile = mobileNumber;
  if (!resolvedMobile) {
    const prev = loadLatestTokens(device.deviceUid);
    resolvedMobile = (prev?.mobileNumber as string) || null;
  }

  const now = Date.now();
  const expiresInMs = parseInt(String(d.expires_in || 0), 10);

  let refreshExpiresAt: number | null = null;
  try {
    if (d.refresh_token) {
      const payload = JSON.parse(
        Buffer.from(String(d.refresh_token).split(".")[1], "base64").toString()
      );
      if (payload.exp) refreshExpiresAt = payload.exp * 1000;
    }
  } catch {}

  const wvLive = prefetchedWv?.live || null;
  const wvVod = prefetchedWv?.vod || null;

  const tokenData: Record<string, unknown> = {
    access_token: d.access_token,
    refresh_token: d.refresh_token || "",
    token_type: d.token_type || "Bearer",
    expires_in: d.expires_in || 0,
    expires_at: now + expiresInMs,
    refresh_expires_at: refreshExpiresAt,
    user_id: d.user_id || 0,
    device_id: d.device_id || 0,
    operator_name: d.operator_name || "",
    operator_uid: d.operator_uid || "",
    is_blocked: !!d.is_blocked,
    is_multicast_network: !!d.is_multicast_network,
    subscriber_tags: d.subscriber_tags || [],
    wv_license_proxy_url_live: wvLive,
    wv_license_proxy_url_vod: wvVod,
    fp_license_proxy_url_live: wvLive ? wvLive.replace("/wv/license", "/fp/license") : null,
    fp_license_proxy_url_vod: wvVod ? wvVod.replace("/wv/license", "/fp/license") : null,
    fp_certificate_url: FP_CERT_URL,
  };

  const record: Record<string, unknown> = {
    _id: device.deviceUid,
    deviceUid: device.deviceUid,
    mobileNumber: resolvedMobile,
    tokens: tokenData,
    captured_at: new Date().toISOString(),
  };

  const store = loadTokensStore();
  store[device.deviceUid] = [record];
  saveTokensStore(store);

  log(`[auth] tokens saved (wv=${!!wvLive}/${!!wvVod} fp=${!!wvLive}/${!!wvVod}) for ${device.deviceUid.slice(0, 8)}…`);

  const accessTokenStr = String(d.access_token);
  const userIdStr = String(d.user_id || "918558");

  // Also save user devices
  fetchViuDevices(accessTokenStr, userIdStr).then((devices) => {
    if (devices) {
      try {
        const { col } = require("./src/lib/mongo");
        col("user_devices").updateOne({ _id: device.deviceUid }, { $set: { _id: device.deviceUid, devices, updatedAt: new Date().toISOString() } }, { upsert: true });
      } catch {}
    }
  }).catch(() => {});

  return record;
}

async function finalLogin(device: LoginDevice): Promise<{ status: number; data: Record<string, unknown>; wv_license_live?: string | null; wv_license_vod?: string | null }> {
  const wvBody = {
    login_type: "Mac",
    device: device.deviceUid,
    device_class: "SMART_TV",
    device_type: "LG SmartTV",
    device_os: "WEBOS",
  };
  const wvRes = await fetchOtpLogin(wvBody);
  if (wvRes.status < 200 || wvRes.status >= 300) {
    return { status: wvRes.status, data: wvRes.data };
  }
  const wvToken = (wvRes.data?.data || wvRes.data)?.access_token as string | undefined;
  const wvUserId = String((wvRes.data?.data || wvRes.data)?.user_id || "918558");
  let wv_license_live: string | null = null;
  let wv_license_vod: string | null = null;
  if (wvToken) {
    const [liveUrl, vodUrl] = await Promise.all([
      fetchWvLicenseProxyUrlLive(wvToken, wvUserId, device.channelUid || "channelone").then(r => r?.wv_license_proxy_url || null).catch(() => null),
      fetchWvLicenseProxyUrlVod(wvToken, wvUserId, device.viuUid || "23145").then(r => r?.wv_license_proxy_url || null).catch(() => null),
    ]);
    wv_license_live = liveUrl;
    wv_license_vod = vodUrl;
  }
  return { status: wvRes.status, data: wvRes.data, wv_license_live, wv_license_vod };
}

async function otpLoginViu(params: {
  mobile: string;
  otpCode: string;
  device: LoginDevice;
}): Promise<{ status: number; data: Record<string, unknown>; fpData?: Record<string, unknown> }> {
  const wvBody = {
    login_type: "OTP_LOGIN",
    username: params.mobile,
    otp_code: params.otpCode,
    device: params.device.deviceUid,
    device_class: params.device.deviceClass || "SMART_TV",
    device_type: params.device.deviceType || "SMART_TV",
    device_os: params.device.deviceOS || "WEBOS",
  };
  const wvRes = await fetchOtpLogin(wvBody);
  return { status: wvRes.status, data: wvRes.data, fpData: undefined };
}

// ================================================================
// DRM LICENSE PROXY
// ================================================================
function proxyDrm(req: express.Request, res: express.Response, targetUrl: string) {
  if (!targetUrl) return res.status(500).json({ error: "no license" });
  let parsed: URL;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return res.status(500).json({ error: "bad url" });
  }
  getToken().then((token) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      const opts: https.RequestOptions = {
        method: "POST",
        hostname: parsed.hostname,
        port: 443,
        path: parsed.pathname + parsed.search,
        headers: {
          "user-agent": DRM_USER_AGENT,
          "content-type": "application/octet-stream",
          accept: "*/*",
          authorization: `Bearer ${token}`,
          connection: "close",
          "content-length": body.length,
        },
      };
      const pr = https.request(opts, (pres) => {
        res.writeHead(pres.statusCode || 500, {
          ...pres.headers,
          "access-control-allow-origin": "*",
          "access-control-allow-headers": "*",
          "access-control-expose-headers": "*",
        });
        pres.pipe(res);
      });
      pr.on("error", () => {
        if (!res.headersSent) res.status(502).json({ error: "drm fail" });
      });
      pr.end(body);
    });
  }).catch((err) => {
    console.error("[drm] token refresh failed:", err?.message || err);
    if (!res.headersSent) res.status(502).json({ error: "token refresh failed" });
  });
}

// ================================================================
// STREAM PROXY
// ================================================================
async function serverResolve(originalUrl: string, maxHops = 6): Promise<{ url: string; statusCode: number; headers: Record<string, string> }> {
  let currentUrl = originalUrl;
  const deadline = Date.now() + 10000;
  for (let hop = 1; hop <= maxHops; hop++) {
    if (Date.now() > deadline) throw new Error("resolve timeout");
    const u = new URL(currentUrl);
    const headers = { "user-agent": USER_AGENT, accept: "*/*", origin: VIU_ORIGIN, referer: VIU_REFERER };
    let res = await httpsRequestFollow({
      method: "HEAD",
      hostname: u.hostname,
      path: u.pathname + u.search,
      headers,
      maxRedirects: 0,
      collectBody: false,
    });
    if (res.statusCode === 405 || res.statusCode === 400 || res.statusCode === 501) {
      if (res.stream) res.stream.resume();
      res = await httpsRequestFollow({
        method: "GET",
        hostname: u.hostname,
        path: u.pathname + u.search,
        headers,
        maxRedirects: 0,
        collectBody: false,
      });
    }
    if (res.statusCode >= 300 && res.statusCode < 400) {
      const loc = res.headers["location"];
      if (res.stream) res.stream.resume();
      if (!loc) throw new Error("no location");
      currentUrl = new URL(loc, currentUrl).toString();
      continue;
    }
    if (res.statusCode >= 200 && res.statusCode < 300) {
      if (res.stream) res.stream.resume();
      return { url: currentUrl, statusCode: res.statusCode, headers: res.headers };
    }
    if (res.stream) res.stream.resume();
    throw new Error(`upstream ${res.statusCode}`);
  }
  throw new Error("too many redirects");
}

// ================================================================
// M3U
// ================================================================
function escapeM3U(s: string): string {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\r?\n/g, " ")
    .trim();
}

function getBaseUrl(req: express.Request): string {
  const proto = req.headers["x-forwarded-proto"] || req.protocol || "http";
  const host = req.headers["x-forwarded-host"] || req.headers.host || `localhost:${PORT}`;
  return `${proto}://${host}`;
}

function buildMovieEntry(item: Record<string, unknown>, base: string, deviceUid?: string): string {
  const uid = makeUidLocal("m", item.id as string | number);
  const realPath = `bpcdn.dialog.lk/bpk-vod/vodprod/output/0-${item.uid}/0-${item.uid}/index.mpd`;
  const streamToken = encryptStreamPath(realPath, STREAM_TOKEN_TTL_MS);
  const drmToken = signDrmToken("content", DRM_LICENSE_TTL_MS, deviceUid);
  const mpdUrl = `${base}/api/stream/t/${streamToken}`;
  const logo = item.image_id ? `${base}/api/img/${item.image_id}` : "";
  const title = escapeM3U(String(item.title || ""));
  return (
    `#EXTINF:-1 tvg-id="${uid}" tvg-name="${title}" tvg-logo="${logo}" group-title="Movies",${title}\n` +
    `#KODIPROP:inputstream=inputstream.adaptive\n` +
    `#KODIPROP:inputstream.adaptive.manifest_type=mpd\n` +
    `#KODIPROP:inputstream.adaptive.license_type=com.widevine.alpha\n` +
    `#KODIPROP:inputstream.adaptive.license_key=${base}/api/drm/${drmToken}\n` +
    `${mpdUrl}\n`
  );
}

function buildLiveEntry(ch: Record<string, unknown>, base: string, deviceUid?: string): string | null {
  const id = extractChannelId(ch.cm_channel as string | null);
  if (!id) return null;
  const realId = ch.id || ch.channel_id || ch.uid;
  const uid = makeUidLocal("c", realId as string | number);
  const realPath = `bpcdn.dialog.lk/bpk-tv/${id}/out/index.mpd`;
  const streamToken = encryptStreamPath(realPath, STREAM_TOKEN_TTL_MS);
  const drmToken = signDrmToken("tv", DRM_LICENSE_TTL_MS, deviceUid);
  const stream = `${base}/api/stream/t/${streamToken}`;
  const logoId = pickLogo(ch.logos as Record<string, unknown> | null);
  const logo = logoId ? `${base}/api/img/${logoId}` : "";
  const title = escapeM3U(String(ch.name || ""));
  const isCatchup = !!ch.timeshiftable;
  const days = ch.ts_rec_duration || ch.rec_duration || 72;

  let e = `#EXTINF:-1 tvg-id="${uid}" tvg-name="${title}" tvg-logo="${logo}"`;
  if (ch.epg_channel) e += ` tvg-chno="${escapeM3U(String(ch.epg_channel))}"`;
  e += ` group-title="Live TV",${title}\n`;
  e += `#EXTGRP:Live TV\n`;
  if (isCatchup) {
    e += `#EXT-X-PLAYLIST-TYPE:catchup\n`;
    e += `#KODIPROP:catchup-source=${stream}?begin=\${start}&end=\${end}\n`;
    e += `#KODIPROP:catchup-days=${days}\n`;
    e += `#KODIPROP:catchup-correction=0\n`;
    e += `#EXTVLCOPT:catchup=default\n`;
    e += `#EXTVLCOPT:timeshift=default\n`;
  }
  e += `#KODIPROP:inputstream=inputstream.adaptive\n`;
  e += `#KODIPROP:inputstream.adaptive.manifest_type=mpd\n`;
  e += `#KODIPROP:inputstream.adaptive.license_type=com.widevine.alpha\n`;
  e += `#KODIPROP:inputstream.adaptive.license_key=${base}/api/drm/${drmToken}\n`;
  e += `${stream}\n`;
  return e;
}

// ================================================================
// AUTH MIDDLEWARE
// ================================================================
function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  const cookie = req.headers.cookie || "";
  const match = cookie.match(/session=([^;]+)/);
  if (!match) return res.status(401).json({ error: "Login required" });
  const session = verifySessionToken(match[1]);
  if (session && session.signedIn) {
    (req as Record<string, unknown>).session = session;
    return next();
  }
  const payload = parseSessionPayload(match[1]);
  if (payload && payload.signedIn && payload.deviceUid) {
    const latest = loadLatestTokens(payload.deviceUid);
    if (latest && isRefreshTokenValid(latest)) {
      const newToken = createSessionToken(payload);
      res.setHeader("Set-Cookie", `session=${newToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 24 * 3600}`);
      (req as Record<string, unknown>).session = payload;
      return next();
    }
  }
  return res.status(401).json({ error: "Login required" });
}

function adminAuthMiddleware(req: express.Request, res: express.Response, next: express.NextFunction) {
  const auth = (req.headers["x-admin-token"] as string) || (req.query.admin_token as string);
  if (auth && verifyAdminSession(auth)) return next();
  return res.status(401).json({ error: "Unauthorized" });
}

// ── Device auth for M3U/EPG (header or query param) ─────────
function requireDeviceAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  const deviceUid = (req.headers["x-device-uid"] as string) || (req.query.uid as string);
  if (!deviceUid || deviceUid.length < 20 || deviceUid.length > 64) {
    return res.status(401).json({ error: "Device auth required" });
  }
  const latest = loadLatestTokens(deviceUid);
  const status = tokenStatus(latest);
  if (status !== "access_valid" && status !== "refresh_valid") {
    return res.status(401).json({ error: "Login required" });
  }
  (req as Record<string, unknown>).deviceUid = deviceUid;
  next();
}

// ── EPG random token store ─────────────────────────────────
const epgTokens = new Map<string, { deviceUid: string; expiresAt: number }>();

function issueEpgToken(deviceUid: string): string {
  const token = crypto.randomBytes(24).toString("base64url");
  epgTokens.set(token, { deviceUid, expiresAt: Date.now() + 24 * 3600 * 1000 });
  return token;
}

function verifyEpgToken(token: string): string | null {
  const entry = epgTokens.get(token);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { epgTokens.delete(token); return null; }
  return entry.deviceUid;
}

// Cleanup expired EPG tokens every 10 min
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of epgTokens) { if (now > v.expiresAt) epgTokens.delete(k); }
}, 600000);

// ================================================================
// EXPRESS APP + ROUTES
// ================================================================
const expressApp = express();

// CORS
const CORS_ORIGIN = process.env.CORS_ORIGIN || "";
expressApp.use((req, res, next) => {
  const origin = CORS_ORIGIN || req.headers.origin || "*";
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, HEAD");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-device-uid, x-asset-id");
  res.setHeader("Access-Control-Expose-Headers", "*");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// Security headers
expressApp.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  if (req.headers.accept && req.headers.accept.includes("text/html")) {
    res.setHeader(
      "Content-Security-Policy",
      [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob: https://api2.viu.lk https://*.viu.lk",
        "media-src 'self' blob: https://bpcdn.dialog.lk https://*.dialog.lk https://*.viu.lk",
        "font-src 'self' data:",
        "connect-src 'self' https://api2.viu.lk https://*.viu.lk https://bpcdn.dialog.lk https://*.dialog.lk wss: ws:",
        "frame-ancestors 'self'",
        "base-uri 'self'",
      ].join("; ")
    );
  }
  res.removeHeader("X-Powered-By");
  next();
});

// Capture raw DRM body BEFORE any body parser — Express 5 body-parser consumes the stream
// Removed: DRM body is now captured at HTTP server level (see createServer below)
expressApp.use(express.json({ limit: "10mb" }));

// Gzip
expressApp.use((req, res, next) => {
  const accept = req.headers["accept-encoding"] || "";
  if (!/\bgzip\b/i.test(accept)) return next();
  const origSend = res.send.bind(res);
  res.send = function (body: string | Buffer) {
    if (typeof body === "string" && body.length > 1024) {
      const ct = res.getHeader("Content-Type") || "";
      if (/json|xml|mpegurl|text/.test(String(ct))) {
        const buf = Buffer.from(body, "utf8");
        zlib.gzip(buf, { level: 6 }, (err, gz) => {
          if (err || !gz || gz.length >= buf.length) return origSend(body);
          res.setHeader("Content-Encoding", "gzip");
          res.setHeader("Content-Length", gz.length);
          return origSend(gz as unknown as string);
        });
        return;
      }
    }
    return origSend(body);
  };
  next();
});

// ── HEALTH CHECK ────────────────────────────────────────────
expressApp.get("/api/health", (_req, res) => { res.json({ ok: true, uptime: Math.round(process.uptime()) }); });

// FairPlay SPC certificate
let _fpCertCache: Buffer | null = null;
let _fpCertCacheTs = 0;
const FP_CERT_CACHE_TTL = 24 * 60 * 60 * 1000;

expressApp.get("/cert", (_req, res) => {
  if (_fpCertCache && Date.now() - _fpCertCacheTs < FP_CERT_CACHE_TTL) {
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Cache-Control", "public, max-age=86400");
    return res.send(_fpCertCache);
  }
  const certUrl = "https://api.viu.lk/drmproxy/bp/fp/cert";
  https.get(certUrl, { headers: { "user-agent": FP_DRM_USER_AGENT } }, (upRes) => {
    const chunks: Buffer[] = [];
    upRes.on("data", (c: Buffer) => chunks.push(c));
    upRes.on("end", () => {
      const buf = Buffer.concat(chunks);
      _fpCertCache = buf;
      _fpCertCacheTs = Date.now();
      log(`[cert] fetched from Viu: ${buf.length}b`);
      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader("Cache-Control", "public, max-age=86400");
      res.send(buf);
    });
  }).on("error", () => {
    const fallback = path.join(process.cwd(), "public", "cert");
    res.sendFile(fallback);
  });
});

// ── AUTH ROUTES ───────────────────────────────────────────────
expressApp.get("/api/auth/state", (req, res) => {
  const deviceUid = req.headers["x-device-uid"] as string;
  if (!deviceUid) return res.json({ signedIn: false, mobileNumber: null, tokenStatus: "none" });
  const latest = loadLatestTokens(deviceUid);
  const status = tokenStatus(latest);
  const isSignedIn = status === "access_valid" || status === "refresh_valid";
  res.json({
    signedIn: isSignedIn,
    mobileNumber: latest?.mobileNumber ? maskMobile(latest.mobileNumber as string) : null,
    tokenStatus: status,
  });
});

expressApp.get("/api/auth/epg-token", (req, res) => {
  const deviceUid = req.headers["x-device-uid"] as string;
  if (!deviceUid || deviceUid.length < 20 || deviceUid.length > 64) {
    return res.status(400).json({ error: "Invalid device" });
  }
  const latest = loadLatestTokens(deviceUid);
  const status = tokenStatus(latest);
  if (status !== "access_valid" && status !== "refresh_valid") {
    return res.status(401).json({ error: "Login required" });
  }
  const token = issueEpgToken(deviceUid);
  res.json({ ok: true, token, expiresIn: 4 * 3600 });
});

expressApp.post("/api/auth/auto-login", async (req, res) => {
  const deviceUid = req.headers["x-device-uid"] as string;
  if (!deviceUid || deviceUid.length < 20 || deviceUid.length > 64) {
    return res.status(400).json({ error: "Invalid device identifier" });
  }
  const device = getOrCreateDevice(deviceUid);

  const saved = loadLatestTokens(deviceUid);
  const status = tokenStatus(saved);
  const maskedMobile = saved?.mobileNumber ? maskMobile(saved.mobileNumber as string) : null;

  if (status === "access_valid") {
    return res.json({ ok: true, signedIn: true, mobileNumber: maskedMobile, cached: true });
  }

  if (status === "refresh_valid") {
    finalLogin(device)
      .then((r) => {
        const d = (r.data?.data || r.data) as Record<string, unknown> | undefined;
        if (r.status >= 200 && r.status < 300 && d?.access_token) {
saveLoginTokens(device, r.data, saved?.mobileNumber as string | null, { live: r.wv_license_live ?? null, vod: r.wv_license_vod ?? null });
          return res.json({ ok: true, signedIn: true, mobileNumber: maskedMobile, refreshed: true });
        }
        return res.status(401).json({ ok: false, reason: "refresh_failed" });
      })
      .catch(() => res.status(401).json({ ok: false, reason: "refresh_failed" }));
    return;
  }

  try {
    log(`[auth] auto-login trying finalLogin for device ${deviceUid.slice(0, 8)}…`);
    const r = await finalLogin(device);
    const d = (r.data?.data || r.data) as Record<string, unknown> | undefined;
    log(`[auth] auto-login finalLogin → status=${r.status} hasAccessToken=${!!d?.access_token} wvLive=${!!r.wv_license_live} wvVod=${!!r.wv_license_vod}`);
    if (r.status >= 200 && r.status < 300 && d?.access_token) {
      saveLoginTokens(device, r.data, saved?.mobileNumber as string | null, { live: r.wv_license_live ?? null, vod: r.wv_license_vod ?? null });
      const mobile = d.user?.mobile || saved?.mobileNumber || null;
      return res.json({ ok: true, signedIn: true, mobileNumber: mobile ? maskMobile(mobile as string) : null, refreshed: true });
    }
    return res.status(401).json({ ok: false, reason: "tokens_expired" });
  } catch (e) {
    log(`[auth] auto-login finalLogin error:`, (e as Error).message);
    return res.status(401).json({ ok: false, reason: "tokens_expired" });
  }
});

expressApp.post("/api/auth/send-otp", (req, res) => {
  const deviceUid = req.headers["x-device-uid"] as string;
  if (!deviceUid) return res.status(400).json({ error: "Missing device" });
  if (!rateLimit(`otp:${deviceUid}`, 5, 60000)) return res.status(429).json({ error: "Too many requests. Wait a minute." });
  const rawMobile = (req.body || {}).mobileNumber;
  const check = normalizeMobile(rawMobile);
  if (!check.ok) return res.status(400).json({ error: check.error });

  viuSendOtp(check.number!)
    .then((r) => {
      if (r.status === 200 && r.data?.status === "ok") {
        res.json({ ok: true, maskedMobile: maskMobile(check.number!) });
      } else {
        res.status(502).json({ error: (r.data?.data as Record<string, unknown>)?.message || "Could not send code" });
      }
    })
    .catch(() => res.status(500).json({ error: "Send OTP failed" }));
});

expressApp.post("/api/auth/verify-otp", async (req, res) => {
  const deviceUid = req.headers["x-device-uid"] as string;
  if (!deviceUid) return res.status(400).json({ error: "Missing device" });
  if (!rateLimit(`verify:${deviceUid}`, 10, 300000)) return res.status(429).json({ error: "Too many attempts. Try again later." });
  const device = getOrCreateDevice(deviceUid);
  const { mobileNumber: rawMobile, otpCode } = req.body || {};
  const check = normalizeMobile(rawMobile);
  if (!check.ok) return res.status(400).json({ error: check.error });
  if (!/^\d{6}$/.test(otpCode)) return res.status(400).json({ error: "Code must be 6 digits" });

  try {
    let r = await otpLoginViu({ mobile: check.number!, otpCode, device });

    // 4062 = device not registered → register device via registration.viu.lk flow, then retry
    const errCode = r.data?.code;
    const errMsg = (r.data?.data as Record<string, unknown>)?.message || "";
    if (errCode === 4062 || String(errMsg).includes("Device not found")) {
      log(`[auth] Device ${deviceUid.slice(0, 8)}… not found — registering via Viu registration API`);
      try {
        // Step 1: Start registration session → get registration JWT + trace_id
        const startRes = await startRegistration();
        log(`[auth] Registration start → HTTP ${startRes.status} body: ${JSON.stringify(startRes.data).slice(0, 500)}`);

        if (startRes.status >= 200 && startRes.status < 300) {
          // Extract registration token from data.access_token
          const regToken = startRes.data?.data?.access_token
            || startRes.data?.data?.token
            || startRes.data?.access_token
            || startRes.data?.token;

          log(`[auth] Registration token found: ${regToken ? "yes (" + String(regToken).slice(0, 30) + "...)" : "no"}`);

          if (regToken && typeof regToken === "string") {
            // Extract trace_id: prefer from response body, fallback to JWT decode
            let traceId = (startRes.data?.data?.trace_id as string)
              || (startRes.data?.trace_id as string)
              || "";
            if (!traceId) {
              try {
                const payload = JSON.parse(Buffer.from(regToken.split(".")[1], "base64url").toString("utf8"));
                traceId = payload.trace_id || "";
              } catch (e) {
                log(`[auth] JWT decode failed: ${(e as Error).message}`);
              }
            }
            log(`[auth] Registration trace_id: ${traceId}`);

            if (traceId) {
              // Step 2: Register device with the registration JWT
              const regResult = await registerDeviceV2(regToken, {
                mobileNumber: check.number!,
                deviceUid: device.deviceUid,
                deviceClass: device.deviceClass || "SMART_TV",
                deviceType: device.deviceType || "SMART_TV",
                deviceOS: device.deviceOS || "WEBOS",
                traceId,
              });
              log(`[auth] Device register → HTTP ${regResult.status} body: ${JSON.stringify(regResult.data).slice(0, 500)}`);

              if (regResult.status >= 200 && regResult.status < 300) {
                log(`[auth] Device registered — retrying login with Mac type (no OTP needed)`);
                r = await finalLogin(device);
                log(`[auth] Post-registration login → HTTP ${r.status} code=${r.data?.code} hasToken=${!!(r.data?.data as Record<string, unknown>)?.access_token}`);
              }
            }
          } else {
            log(`[auth] Full registration response: ${JSON.stringify(startRes.data).slice(0, 1000)}`);
          }
        }
      } catch (regErr) {
        log(`[auth] Device registration failed: ${(regErr as Error).message}`);
      }
    }

    if (r.status === 200 && (r.data?.data as Record<string, unknown>)?.access_token) {
      saveLoginTokens(device, r.data, check.number!, { live: r.wv_license_live ?? null, vod: r.wv_license_vod ?? null });
      device.lastUsedAt = new Date().toISOString();
      saveDevice(device as unknown as Record<string, unknown>);

      const sessionToken = createSessionToken({
        deviceUid: device.deviceUid,
        mobileNumber: check.number!,
        signedIn: true,
      });
      res.setHeader("Set-Cookie", `session=${sessionToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 24 * 3600}${process.env.COOKIE_SECURE ? "; Secure" : ""}`);
      return res.json({ ok: true, signedIn: true, mobileNumber: maskMobile(check.number!) });
    }

    const finalErrMsg = (r.data?.data as Record<string, unknown>)?.message || "";
    res.status(r.status || 500).json({ error: String(finalErrMsg || "Verification failed") });
  } catch (e: Error) {
    res.status(500).json({ error: e.message || "Verification failed" });
  }
});

expressApp.post("/api/auth/logout", async (req, res) => {
  try {
    const deviceUid = req.headers["x-device-uid"] as string;
    if (deviceUid) {
      // Soft-delete device + token from MongoDB
      deleteDevice(deviceUid);
      deleteToken(deviceUid);
      log(`[auth] Logged out device ${deviceUid.slice(0, 8)}… — soft-deleted`);
    }
  } catch { }
  res.setHeader("Set-Cookie", "session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
  res.json({ ok: true });
});

// ── IMAGE PROXY ───────────────────────────────────────────────
expressApp.get("/api/img/:id", async (req, res) => {
  const id = String(req.params.id).replace(/[^a-zA-Z0-9_\-]/g, "");
  if (!id) return res.status(400).end();
  const target = `https://api2.viu.lk/api/client/v1/global/images/${id}?accessKey=${"WkVjNWNscFhORDBLCg=="}`;
  try {
    const u = new URL(target);
    const up = await httpsRequestFollow({
      method: "GET",
      hostname: u.hostname,
      path: u.pathname + u.search,
      headers: { "user-agent": USER_AGENT, accept: "image/*,*/*", origin: VIU_ORIGIN, referer: VIU_REFERER },
    });
    res.status(up.statusCode);
    for (const [k, v] of Object.entries(up.headers)) {
      const lk = k.toLowerCase();
      if (["transfer-encoding", "connection", "content-encoding"].includes(lk)) continue;
      try {
        res.setHeader(k, v);
      } catch {}
    }
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "public, max-age=86400");
    return res.send(up.body);
  } catch {
    if (!res.headersSent) res.status(502).end();
  }
});

// ── DATA ROUTES ───────────────────────────────────────────────
expressApp.get("/api/data/categories", (req, res) => {
  const idx = loadCategoriesIndex();
  if (!idx || !Array.isArray(idx.data)) return res.status(503).json({ error: "not ready" });

  const out: unknown[] = [];
  for (const cat of idx.data) {
    const file = loadCategoryFile(cat.id);
    const items = file && Array.isArray(file.content) ? file.content.filter((i) => i && i.id) : [];
    const projected = items.map((i) => projectVodItem(i, makeUidLocal("k", cat.id))).filter(Boolean);
    if (!projected.length) continue;
    const catP = projectCategory(cat, projected.length);
    if (catP) out.push(catP);
  }
  res.setHeader("Cache-Control", "public, max-age=15");
  res.json({ updatedAt: idx.updatedAt || null, categories: out });
});

expressApp.get("/api/data/categories/:uid", (req, res) => {
  const ref = resolveUid(req.params.uid);
  if (!ref || ref.type !== "k") return res.status(404).json({ error: "not found" });
  const file = loadCategoryFile(parseInt(ref.realId, 10));
  if (!file) return res.status(404).json({ error: "not found" });

  const categoryUid = req.params.uid;
  const items = (file.content || []).filter((i) => i && i.id);
  const projected = items.map((i) => projectVodItem(i, categoryUid)).filter(Boolean);

  res.setHeader("Cache-Control", "public, max-age=15");
  res.json({
    uid: categoryUid,
    name: file.meta?.name || `Category ${ref.realId}`,
    desc: file.meta?.desc || "",
    movies: projected.filter((i) => i.type === "movie").length,
    series: projected.filter((i) => i.type === "series").length,
    items: projected,
  });
});

// ── UID RESOLVE ──────────────────────────────────────────────
expressApp.get("/api/uid/resolve/:uid", requireStreamAuth, (req, res) => {
  const ref = resolveUid(req.params.uid);
  if (!ref) return res.status(404).json({ error: "unknown uid" });
  if (ref.type === "e") {
    const idx = loadCategoriesIndex();
    if (idx && Array.isArray(idx.data)) {
      for (const cat of idx.data) {
        const file = loadCategoryFile(cat.id);
        if (!file || !Array.isArray(file.content)) continue;
        for (const item of file.content) {
          if (!item || item.type !== "series") continue;
          const allEps = [...(item.seasons || []).flatMap((s: any) => s.episodes || []), ...(item.episodes || [])];
          if (allEps.some((ep: any) => String(ep.id) === String(ref.realId))) {
            ref.seriesUid = makeUidLocal("s", item.id as string | number);
            scheduleUidSave();
            res.json(ref);
            return;
          }
        }
      }
    }
  }
  res.json(ref);
});

expressApp.get("/api/data/channels", (req, res) => {
  const cj = loadChannels();
  if (!cj) return res.status(503).json({ error: "not ready" });
  const chs = flattenChannels(cj);
  const out: unknown[] = [];
  for (const ch of chs) {
    const p = projectChannel(ch);
    if (p) out.push(p);
  }
  saveUidMap(UID_MAP);
  res.setHeader("Cache-Control", "public, max-age=15");
  res.json({ channels: out });
});

// ── EPG ROUTES ───────────────────────────────────────────────
expressApp.get("/api/epg/now", (req, res) => {
  const epg = loadEpgJson();
  if (!epg || !Array.isArray(epg.programs)) return res.json({ updatedAt: null, now: {} });
  const cj = loadChannels();
  if (!cj) return res.json({ updatedAt: epg.updatedAt, now: {} });
  const chs = flattenChannels(cj);
  const idToUid = new Map<string, string>();
  for (const ch of chs) {
    const realId = ch.id || ch.channel_id || ch.uid;
    if (!realId) continue;
    idToUid.set(String(realId), makeUidLocal("c", realId as string | number));
  }
  scheduleUidSave();
  const now = Date.now();
  const out: Record<string, { now: Record<string, unknown> | null; next: Record<string, unknown> | null }> = {};
  for (const p of epg.programs) {
    const chUid = idToUid.get(String(p.ch));
    if (!chUid) continue;
    const s = new Date(p.start).getTime(),
      e = new Date(p.end).getTime();
    if (!out[chUid]) out[chUid] = { now: null, next: null };
    const slot = out[chUid];
    if (s <= now && now < e) slot.now = { start: p.start, end: p.end, title: p.title, img: p.img || null };
    else if (s > now && !slot.next) slot.next = { start: p.start, end: p.end, title: p.title };
  }
  res.setHeader("Cache-Control", "public, max-age=30");
  res.json({ updatedAt: epg.updatedAt || null, now: out });
});

expressApp.get("/api/epg/channel/:uid", (req, res) => {
  const ref = resolveUid(req.params.uid);
  if (!ref || ref.type !== "c") return res.status(404).json({ error: "not found" });
  const epg = loadEpgJson();
  if (!epg || !Array.isArray(epg.programs)) return res.status(404).json({ error: "not ready" });
  const days = Math.max(1, Math.min(14, parseInt(req.query.days as string || "4", 10)));
  const now = Date.now();
  const from = now - 3 * 24 * 3600 * 1000;
  const to = now + days * 24 * 3600 * 1000;
  const programs = epg.programs
    .filter((p) => String(p.ch) === String(ref.realId))
    .filter((p) => {
      const s = new Date(p.start).getTime();
      return s >= from && s <= to;
    })
    .map(projectProgram);
  res.setHeader("Cache-Control", "public, max-age=60");
  res.json({ channel: req.params.uid, updatedAt: epg.updatedAt || null, total: programs.length, programs });
});

// ── DETAILS ROUTES ───────────────────────────────────────────
expressApp.get("/api/details/movie/:uid", async (req, res) => {
  const ref = resolveUid(req.params.uid);
  if (!ref || ref.type !== "m") return res.status(404).json({ error: "not found" });
  try {
    const deviceUid = req.headers["x-device-uid"] as string || "";
    let token = "";
    if (deviceUid) {
      const latest = loadLatestTokens(deviceUid);
      if (latest?.access_token) token = latest.access_token as string;
    }
    if (!token) token = await getToken();
    const raw = (await fetchMovieDetail(token, ref.realId)) as Record<string, unknown>;
    const d = (raw.data || {}) as Record<string, unknown>;

    let poster: number | null = null;
    let catUid: string | null = null;
    const idx = loadCategoriesIndex();
    if (idx && Array.isArray(idx.data)) {
      for (const cat of idx.data) {
        const file = loadCategoryFile(cat.id);
        if (!file || !Array.isArray(file.content)) continue;
        const found = file.content.find((x) => String(x.id) === String(ref.realId));
        if (found) {
          poster = (found.image_id || found.preview_image_id) as number | null;
          catUid = makeUidLocal("k", cat.id);
          break;
        }
      }
    }
    scheduleUidSave();

    let artId: number | null = null;
    if (d.title_art_image_id) artId = d.title_art_image_id as number;
    else if (Array.isArray(d.movie_image_stores)) {
      const stores = d.movie_image_stores as Array<Record<string, unknown>>;
      const t = stores.find((s) => s.type === "TITLE_ART") || stores.find((s) => s.type === "PREVIEW");
      if (t) artId = t.image_store_id as number;
    }

    res.setHeader("Cache-Control", "public, max-age=30");
    res.json({
      uid: req.params.uid,
      title: String(d.title || ""),
      year: d.year ? Number(d.year) : null,
      duration: d.duration ? Number(d.duration) : null,
      rating: d.user_rating ? Number(d.user_rating) : null,
      resolution: d.resolution || null,
      country: Array.isArray(d.country) ? d.country.slice(0, 4).map(String) : [],
      description: d.description || "",
      director: d.director || null,
      cast: d.cast || null,
      poster,
      titleArt: artId,
      hasTrailer: !!d.cm_trailer,
      category: catUid,
    });
  } catch (e) {
    log("[api/details/movie] error:", (e as Error).message);
    if (!res.headersSent) res.status(502).json({ error: "upstream" });
  }
});

expressApp.get("/api/details/series/:uid", async (req, res) => {
  const ref = resolveUid(req.params.uid);
  if (!ref || ref.type !== "s") return res.status(404).json({ error: "not found" });
  try {
    const deviceUid = req.headers["x-device-uid"] as string || "";
    let token = "";
    if (deviceUid) {
      const latest = loadLatestTokens(deviceUid);
      if (latest?.access_token) token = latest.access_token as string;
    }
    if (!token) token = await getToken();
    const raw = (await fetchSeriesDetail(token, ref.realId)) as Record<string, unknown>;
    const d = (raw.data || {}) as Record<string, unknown>;
    indexSeriesEpisodes(d as Parameters<typeof indexSeriesEpisodes>[0]);

    let poster: number | null = null;
    let catUid: string | null = null;
    const idx = loadCategoriesIndex();
    if (idx && Array.isArray(idx.data)) {
      for (const cat of idx.data) {
        const file = loadCategoryFile(cat.id);
        if (!file || !Array.isArray(file.content)) continue;
        const found = file.content.find((x) => String(x.id) === String(ref.realId));
        if (found) {
          poster = (found.image_id || found.preview_image_id) as number | null;
          catUid = makeUidLocal("k", cat.id);
          break;
        }
      }
    }

    const episodes: unknown[] = [];
    for (const season of (d.seasons || []) as Array<Record<string, unknown>>) {
      for (const ep of (season.episodes || []) as Array<Record<string, unknown>>) {
        if (!ep.id) continue;
        const epUid = makeUidLocal("e", ep.id as string | number);
        episodes.push({
          uid: epUid,
          season: season.number,
          number: ep.number,
          title: ep.title || `Episode ${ep.number}`,
          duration: ep.duration || null,
          thumb: (ep.image_store as Array<Record<string, unknown>>)?.[0]?.image_store_id || null,
        });
      }
    }
    episodes.sort((a: Record<string, unknown>, b: Record<string, unknown>) => (Number(a.season) - Number(b.season)) || (Number(a.number) - Number(b.number)));
    scheduleUidSave();

    res.setHeader("Cache-Control", "public, max-age=30");
    res.json({
      uid: req.params.uid,
      title: String(d.title || ""),
      year: d.year ? Number(d.year) : null,
      description: d.description || "",
      cast: d.cast || null,
      poster,
      category: catUid,
      total: episodes.length,
      episodes,
    });
  } catch (e) {
    log("[api/details/series] error:", (e as Error).message);
    if (!res.headersSent) res.status(502).json({ error: "upstream" });
  }
});

// ── STREAM TOKEN ROUTES (AUTH REQUIRED) ─────────────────────
expressApp.get("/api/stream/live/:chUid", requireStreamAuth, (req, res) => {
  const ref = resolveUid(req.params.chUid);
  if (!ref || ref.type !== "c") return res.status(404).json({ error: "not found" });
  const cj = loadChannels();
  if (!cj) return res.status(503).json({ error: "not ready" });
  const ch = flattenChannels(cj).find((c) => String(c.id || c.channel_id || c.uid) === String(ref.realId));
  if (!ch) return res.status(404).json({ error: "not found" });
  const realChId = extractChannelId(ch.cm_channel as string | null);
  if (!realChId) return res.status(404).json({ error: "no channel" });
  const realPath = `bpcdn.dialog.lk/bpk-tv/${realChId}/out/index.mpd`;
  res.setHeader("Cache-Control", "no-store");
  const contentUid = req.params.chUid;
  const resp = issueStreamResponse("live", "tv", realPath, (req as Record<string, unknown>).deviceUid as string, contentUid);
  log("[stream-live] response keys:", Object.keys(resp).join(","), "fp:", resp.licenseFp ? "yes" : "no");
  res.json(resp);
});

expressApp.get("/api/stream/movie/:uid", requireStreamAuth, (req, res) => {
  const ref = resolveUid(req.params.uid);
  if (!ref || ref.type !== "m") return res.status(404).json({ error: "not found" });
  const idx = loadCategoriesIndex();
  let viuUid: string | null = null;
  if (idx && Array.isArray(idx.data)) {
    for (const cat of idx.data) {
      const file = loadCategoryFile(cat.id);
      if (!file || !Array.isArray(file.content)) continue;
      const found = file.content.find((x) => String(x.id) === String(ref.realId));
      if (found && found.uid) {
        viuUid = String(found.uid);
        break;
      }
    }
  }
  if (!viuUid) return res.status(404).json({ error: "no stream" });
  const cm = "0-" + viuUid;
  const realPath = `bpcdn.dialog.lk/bpk-vod/vodprod/output/${cm}/${cm}/index.mpd`;
  res.setHeader("Cache-Control", "no-store");
  res.json(issueStreamResponse("movie", "content", realPath, (req as Record<string, unknown>).deviceUid as string, viuUid));
});

expressApp.get("/api/stream/episode/:uid", requireStreamAuth, (req, res) => {
  const ref = resolveUid(req.params.uid);
  if (!ref || ref.type !== "e") return res.status(404).json({ error: "not found" });
  const cm = EPISODE_CM_CACHE.get(String(ref.realId));
  if (!cm) return res.status(404).json({ error: "episode not indexed — reload the series page" });
  const realPath = `bpcdn.dialog.lk/bpk-vod/vodprod/output/${cm}/${cm}/index.mpd`;
  res.setHeader("Cache-Control", "no-store");
  res.json(issueStreamResponse("episode", "content", realPath, (req as Record<string, unknown>).deviceUid as string, ref.realId as string));
});

expressApp.get("/api/stream/catchup/:chUid", requireStreamAuth, (req, res) => {
  const { begin, end } = req.query;
  if (!begin || !end) return res.status(400).json({ error: "begin & end required" });
  const ref = resolveUid(req.params.chUid);
  if (!ref || ref.type !== "c") return res.status(404).json({ error: "not found" });
  const cj = loadChannels();
  if (!cj) return res.status(503).json({ error: "not ready" });
  const ch = flattenChannels(cj).find((c) => String(c.id || c.channel_id || c.uid) === String(ref.realId));
  if (!ch) return res.status(404).json({ error: "not found" });
  const realChId = extractChannelId(ch.cm_channel as string | null);
  if (!realChId) return res.status(404).json({ error: "no channel" });
  const realPath = `bpcdn.dialog.lk/bpk-tv/${realChId}/out/index.mpd?begin=${encodeURIComponent(String(begin))}&end=${encodeURIComponent(String(end))}`;
  res.setHeader("Cache-Control", "no-store");
  res.json(issueStreamResponse("catchup", "tv", realPath, (req as Record<string, unknown>).deviceUid as string, req.params.chUid));
});

expressApp.get("/api/stream/trailer/:uid", requireStreamAuth, async (req, res) => {
  const ref = resolveUid(req.params.uid);
  if (!ref || ref.type !== "m") return res.status(404).json({ error: "not found" });
  try {
    const token = await getToken();
    const raw = (await fetchMovieDetail(token, ref.realId)) as Record<string, unknown>;
    const d = (raw.data || {}) as Record<string, unknown>;
    if (!d.cm_trailer) return res.status(404).json({ error: "no trailer" });
    const cm = String(d.cm_trailer);
    const realPath = `bpcdn.dialog.lk/bpk-vod/vodprod/output/${cm}/${cm}/index.mpd`;
    res.setHeader("Cache-Control", "no-store");
    res.json(issueStreamResponse("trailer", "content", realPath, (req as Record<string, unknown>).deviceUid as string));
  } catch {
    if (!res.headersSent) res.status(502).json({ error: "upstream" });
  }
});

// ── STREAM PROXY (AUTH REQUIRED) ────────────────────────────
expressApp.all("/api/stream/t/:token", async (req, res) => {
  let host = "bpcdn.dialog.lk";
  let rest = "/";
  try {
    const tokenPart = req.params.token;
    let decrypted: string;
    try {
      decrypted = decryptStreamPath(tokenPart);
    } catch (e) {
      return res.status(403).json({ error: (e as Error).message });
    }
    const [pathOnly, innerQs] = decrypted.split("?");
    const reqQs = req.url.includes("?") ? req.url.split("?").slice(1).join("?") : "";
    const mergedQs = [innerQs, reqQs].filter(Boolean).join("&");

    const stripped = pathOnly.replace(/^\//, "");
    const first = stripped.split("/")[0];
    host = "bpcdn.dialog.lk";
    rest = "/" + stripped;
    if (first && first.includes(".dialog.lk")) {
      host = first;
      rest = "/" + stripped.split("/").slice(1).join("/");
    }
    if (mergedQs) rest += "?" + mergedQs;

    const restPath = rest.split("?")[0];
    const isMpdRequest = restPath.endsWith(".mpd");
    const isVod = rest.includes("/bpk-vod/");
    const isCatchup = !!(extractBeginFromUrl(rest) || extractEndFromUrl(rest));
    const isLive = !isCatchup && !isVod;
    const isBpkToken = rest.includes("/bpk-token/");

    const ua = (req.headers["user-agent"] || "") as string;
    const isSafariUA = /Safari/i.test(ua) && !/Chrome|Chromium|Edg|CriOS|FxiOS/i.test(ua);

    if (isMpdRequest && isSafariUA) {
      const hlsRest = rest.replace(/\.mpd(\?.*)?$/i, ".m3u8$1");
      const hlsKey = `hls:${host}${hlsRest}`;
      const cachedHls = m3u8Cache.get(hlsKey);
      if (cachedHls) {
        res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Cache-Control", "no-cache");
        return res.send(cachedHls);
      }
      const originalUrl = `https://${host}${hlsRest}`;
      let resolved: { finalUrl: string; httpStatus: number; hops: number; contentType: string } | null = null;
      if (pickClient()) {
        try {
          SOCKET_STATS.totalDelegateResolves++;
          resolved = await delegateResolve(originalUrl, SOCKET_RESOLVE_TIMEOUT_MS);
        } catch {}
      }
      if (!resolved && SERVER_FALLBACK_RESOLVE) {
        try {
          const r = await serverResolve(originalUrl);
          resolved = { finalUrl: r.url, httpStatus: r.statusCode, hops: 1, contentType: "" };
        } catch (e) { log(`[stream-hls] serverResolve failed: ${(e as Error).message}`); }
      }
      if (!resolved) {
        log(`[stream-hls] resolve failed, redirecting to CDN`);
        res.setHeader("Access-Control-Allow-Origin", "*");
        return res.redirect(302, `https://${applyCdn(host)}${hlsRest}`);
      }
      const cdnUrl = applyCdn(resolved.finalUrl);
      const u2 = new URL(cdnUrl);
      const up = await httpsRequestFollow({
        method: "GET",
        hostname: u2.hostname,
        path: u2.pathname + u2.search,
        headers: { origin: VIU_ORIGIN, referer: VIU_REFERER, "user-agent": USER_AGENT, accept: "*/*" },
      });
      if (up.statusCode !== 200) {
        res.status(up.statusCode);
        return res.send(up.body);
      }
      let m3u8 = (up.body || Buffer.from("")).toString("utf8");
      const cdnBase = cdnUrl.replace(/\/[^/]*$/, "/");
      m3u8 = rewriteM3u8Urls(m3u8, cdnBase);
      const ttl = isCatchup ? LIVE_MPD_CACHE_TTL_MS : VOD_MPD_CACHE_TTL_MS;
      m3u8Cache.set(hlsKey, m3u8, ttl);
      res.status(200).setHeader("Content-Type", "application/vnd.apple.mpegurl");
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Cache-Control", "no-cache");
      return res.send(m3u8);
    }

    if (!isMpdRequest) {
      if (isBpkToken || !MPD_PROXY) {
        return res.redirect(302, `https://${applyCdn(host)}${rest}`);
      }
      const u = new URL(`https://${host}${rest}`);
      const upstream = await httpsRequestFollow({
        method: req.method,
        hostname: u.hostname,
        path: u.pathname + u.search,
        headers: {
          origin: VIU_ORIGIN,
          referer: VIU_REFERER,
          "user-agent": USER_AGENT,
          accept: "*/*",
          ...(req.headers.range ? { range: req.headers.range as string } : {}),
        },
        collectBody: false,
      });
      res.status(upstream.statusCode);
      for (const [k, v] of Object.entries(upstream.headers)) {
        const lk = k.toLowerCase();
        if (["transfer-encoding", "connection", "content-encoding"].includes(lk)) continue;
        try {
          res.setHeader(k, v);
        } catch {}
      }
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges, Location");
      return upstream.stream?.pipe(res);
    }

    // MPD handling
    const cachedMpd = mpdCache.get(req.url);
    if (cachedMpd) {
      res.setHeader("Content-Type", "application/dash+xml");
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Cache-Control", "no-cache");
      return res.send(cachedMpd);
    }
    const originalUrl = `https://${host}${rest}`;
    let resolved: { finalUrl: string; httpStatus: number; hops: number; contentType: string } | null = null;

    if (pickClient()) {
      try {
        SOCKET_STATS.totalDelegateResolves++;
        resolved = await delegateResolve(originalUrl, SOCKET_RESOLVE_TIMEOUT_MS);
      } catch {}
    }
    if (!resolved && SERVER_FALLBACK_RESOLVE) {
      try {
        const r = await serverResolve(originalUrl);
        resolved = { finalUrl: r.url, httpStatus: r.statusCode, hops: 1, contentType: "" };
      } catch (e) { log(`[stream] serverResolve failed for ${host}${rest.substring(0, 60)}: ${(e as Error).message}`); }
    } else if (!resolved && !SERVER_FALLBACK_RESOLVE) {
      log(`[stream] no resolver available, redirecting to CDN for ${host}${rest.substring(0, 60)}`);
      res.setHeader("Access-Control-Allow-Origin", "*");
      return res.redirect(302, `https://${applyCdn(host)}${rest}`);
    }
    if (!resolved) {
      log(`[stream] resolve failed, redirecting to CDN for ${host}${rest.substring(0, 60)}`);
      res.setHeader("Access-Control-Allow-Origin", "*");
      return res.redirect(302, `https://${applyCdn(host)}${rest}`);
    }

    if (LIVE_REDIRECT && isLive) {
      const target = applyCdn(resolved.finalUrl);
      res.setHeader("Access-Control-Allow-Origin", "*");
      return res.redirect(302, target);
    }

    const cdnUrl = applyCdn(resolved.finalUrl);
    let u2: URL;
    try {
      u2 = new URL(cdnUrl);
    } catch (e) {
      log(`[stream] bad CDN URL: ${cdnUrl}`);
      res.setHeader("Access-Control-Allow-Origin", "*");
      return res.redirect(302, `https://${applyCdn(host)}${rest}`);
    }
    const up = await httpsRequestFollow({
      method: "GET",
      hostname: u2.hostname,
      path: u2.pathname + u2.search,
      headers: {
        origin: VIU_ORIGIN,
        referer: VIU_REFERER,
        "user-agent": USER_AGENT,
        accept: "*/*",
        ...(req.headers.range ? { range: req.headers.range as string } : {}),
      },
    });
    if (up.statusCode !== 200 && up.statusCode !== 206) {
      log(`[stream] upstream ${up.statusCode} for ${cdnUrl.substring(0, 80)}, redirecting to CDN`);
      res.setHeader("Access-Control-Allow-Origin", "*");
      return res.redirect(302, cdnUrl);
    }
    let xml = (up.body || Buffer.from("")).toString("utf8");
    if (!/^\s*<\?xml|<MPD/i.test(xml)) {
      log(`[stream] non-MPD response (${xml.substring(0, 80)}), redirecting to CDN`);
      res.setHeader("Access-Control-Allow-Origin", "*");
      return res.redirect(302, cdnUrl);
    }

    const baseMatch = xml.match(/<BaseURL>([^<]+)<\/BaseURL>/);
    let segBase: string;
    if (baseMatch) {
      let b = baseMatch[1].trim();
      if (!/^https?:\/\//i.test(b)) b = new URL(b, cdnUrl).toString();
      if (!b.endsWith("/")) b += "/";
      segBase = applyCdn(b);
    } else {
      const p = new URL(cdnUrl);
      const dir = p.pathname.replace(/\/[^/]*$/, "/");
      segBase = isVod ? `${p.protocol}//${p.hostname}${dir}` : `${p.protocol}//${p.hostname}${dir}dash/`;
    }
    let newBaseFinal = segBase;
    if (MPD_PROXY) {
      const ps = new URL(segBase);
      const proto = req.headers["x-forwarded-proto"] || req.protocol || "http";
      const hostHdr = req.headers["x-forwarded-host"] || req.headers.host || `localhost:${PORT}`;
      const segRealPath = `${ps.hostname}${ps.pathname}${ps.search}`;
      const segToken = encryptStreamPath(segRealPath, STREAM_TOKEN_TTL_MS);
      newBaseFinal = `${proto}://${hostHdr}/api/stream/t/${segToken}`;
    }

    const needsPssh = isCatchup || isVod;
    let pssh: string | null = null;
    if (needsPssh) {
      const cm = rest.match(/\/bpk-tv\/([^/]+)\//) || rest.match(/\/bpk-vod\/[^/]+\/[^/]+\/output\/([^/]+)\//);
      const channelKey = cm ? cm[1] : "unknown";
      const psshKey = isCatchup ? `${channelKey}:${extractBeginFromUrl(rest) || ""}:${extractEndFromUrl(rest) || ""}` : `vod:${channelKey}`;
      pssh = psshCacheGet(psshKey);
      if (!pssh) {
        pssh = await fetchPsshFromAudio(cdnUrl, Buffer.from(xml, "utf8"));
        if (pssh) psshCacheSet(psshKey, pssh);
      }
    }
    xml = rewriteBaseUrl(xml, newBaseFinal);
    if (pssh) xml = injectPssh(xml, pssh);

    const ttl = isCatchup ? LIVE_MPD_CACHE_TTL_MS : VOD_MPD_CACHE_TTL_MS;
    mpdCache.set(req.url, xml, ttl);

    res.status(200).setHeader("Content-Type", "application/dash+xml");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "no-cache");
    res.send(xml);
  } catch (err) {
    log(`[stream] error: ${(err as Error)?.message || err}`);
    if (!res.headersSent) {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.redirect(302, `https://${applyCdn(host)}${rest}`);
    }
  }
});

// ── DRM LICENSE PROXY (AUTH REQUIRED) ──────────────────────
function requireStreamAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  const cookie = req.headers.cookie || "";
  const match = cookie.match(/session=([^;]+)/);
  if (match) {
    const session = verifySessionToken(match[1]);
    if (session && session.signedIn) {
      (req as Record<string, unknown>).session = session;
      (req as Record<string, unknown>).deviceUid = session.deviceUid;
      return next();
    }
    const payload = parseSessionPayload(match[1]);
    if (payload && payload.signedIn && payload.deviceUid) {
      const latest = loadLatestTokens(payload.deviceUid);
      if (latest && isRefreshTokenValid(latest)) {
        const newToken = createSessionToken(payload);
      res.setHeader("Set-Cookie", `session=${newToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 24 * 3600}${process.env.COOKIE_SECURE ? "; Secure" : ""}`);

        (req as Record<string, unknown>).session = payload;
        (req as Record<string, unknown>).deviceUid = payload.deviceUid;
        return next();
      }
    }
  }
  const deviceUid = req.headers["x-device-uid"] as string;
  if (deviceUid && deviceUid.length >= 20 && deviceUid.length <= 64) {
    const latest = loadLatestTokens(deviceUid);
    const status = tokenStatus(latest);
    if (status === "access_valid" || status === "refresh_valid") {
      (req as Record<string, unknown>).deviceUid = deviceUid;
      return next();
    }
  }
  return res.status(401).json({ error: "Login required" });
}

expressApp.all("/api/drm/:token", (req, res) => {
  try {
    if (DRM_ALLOWED_ORIGIN) {
      const origin = req.headers["origin"] || req.headers["referer"] || "";
      if (!origin.startsWith(DRM_ALLOWED_ORIGIN)) {
        return res.status(403).json({ error: "forbidden" });
      }
    }
    const info = verifyDrmToken(req.params.token);
    if (!info) return res.status(403).json({ error: "invalid or expired drm token" });

    const body = Buffer.isBuffer((req as any)._rawDrmBody)
      ? (req as any)._rawDrmBody
      : Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);

    const isFairPlay = info.drmType === "fp";
    const deviceUid = info.deviceUid || "";
    const latest = loadLatestTokens(deviceUid);

    // For FairPlay: client sends raw SPC binary + x-asset-id header
    const fpAssetId = (req.headers["x-asset-id"] as string) || info.assetId || "";

    // Helper: proxy FairPlay license request
    function proxyFairPlay(licenseUrl: string, accessToken: string) {
      const spcB64 = body.toString("base64");
      const jsonBody = JSON.stringify({ spc: spcB64, assetId: fpAssetId });
      const parsed = new URL(licenseUrl);
      log(`[drm-fp] proxying to ${parsed.hostname} kind=${info.kind} assetId=${fpAssetId} body=${body.length}b`);
      const opts: https.RequestOptions = {
        method: "POST", hostname: parsed.hostname, port: 443,
        path: parsed.pathname + parsed.search,
        headers: {
          "user-agent": FP_DRM_USER_AGENT, "content-type": "application/json",
          accept: "*/*", authorization: `Bearer ${accessToken}`,
          connection: "close", "content-length": Buffer.byteLength(jsonBody),
        },
      };
      const pr = https.request(opts, (pres) => {
        const chunks: Buffer[] = [];
        pres.on("data", (c: Buffer) => chunks.push(c));
        pres.on("end", () => {
          log(`[drm-fp] upstream → ${pres.statusCode} ${chunks.length}b`);
          if (pres.statusCode && pres.statusCode >= 200 && pres.statusCode < 300) {
            const raw = Buffer.concat(chunks);
            let ckcBytes = raw;
            try {
              const text = raw.toString("utf8");
              if (text.trimStart().startsWith("{")) {
                const parsed = JSON.parse(text);
                const ckcField = parsed.ckc || parsed.CKC || parsed.license || parsed.License || parsed.contentKeyContext || parsed.payload;
                if (typeof ckcField === "string" && ckcField.length > 0) {
                  ckcBytes = Buffer.from(ckcField, "base64");
                  log(`[drm-fp] extracted CKC: ${ckcBytes.length}b from JSON field`);
                } else {
                  for (const [k, v] of Object.entries(parsed)) {
                    if (typeof v === "string" && v.length > 100) {
                      ckcBytes = Buffer.from(v, "base64");
                      log(`[drm-fp] extracted CKC: ${ckcBytes.length}b from field "${k}"`);
                      break;
                    }
                  }
                }
              }
            } catch {}
            res.writeHead(200, {
              "content-type": "application/octet-stream",
              "content-length": ckcBytes.length,
              "access-control-allow-origin": "*",
              "access-control-allow-headers": "*",
              "access-control-expose-headers": "*",
            });
            res.end(ckcBytes);
          } else {
            res.writeHead(pres.statusCode || 502, {
              ...pres.headers,
              "access-control-allow-origin": "*",
              "access-control-allow-headers": "*",
              "access-control-expose-headers": "*",
            });
            pres.pipe(res);
          }
        });
      });
      pr.on("error", (e) => { log("[drm-fp] upstream error:", e.message); if (!res.headersSent) res.status(502).json({ error: "drm fail" }); });
      pr.end(jsonBody);
    }

    // Helper: proxy Widevine license request
    function proxyWidevine(licenseUrl: string, accessToken: string) {
      const parsed = new URL(licenseUrl);
      log(`[drm-wv] proxying to ${parsed.hostname} kind=${info.kind} body=${body.length}b`);
      const opts: https.RequestOptions = {
        method: "POST", hostname: parsed.hostname, port: 443,
        path: parsed.pathname + parsed.search,
        headers: {
          "user-agent": DRM_USER_AGENT, "content-type": "application/octet-stream",
          accept: "*/*", authorization: `Bearer ${accessToken}`,
          connection: "close", "content-length": body.length,
        },
      };
      const pr = https.request(opts, (pres) => {
        log(`[drm-wv] upstream → ${pres.statusCode}`);
        res.writeHead(pres.statusCode || 500, {
          ...pres.headers,
          "access-control-allow-origin": "*",
          "access-control-allow-headers": "*",
          "access-control-expose-headers": "*",
        });
        pres.pipe(res);
      });
      pr.on("error", (e) => { log("[drm-wv] upstream error:", e.message); if (!res.headersSent) res.status(502).json({ error: "drm fail" }); });
      pr.end(body);
    }

    // Determine license URL based on DRM type
    if (isFairPlay) {
      let storedLicenseUrl = info.kind === "tv"
        ? (latest?.fp_license_proxy_url_live as string) || null
        : (latest?.fp_license_proxy_url_vod as string) || null;

      // Derive from WV if missing
      if (!storedLicenseUrl) {
        const wvUrl = info.kind === "tv"
          ? (latest?.wv_license_proxy_url_live as string) || null
          : (latest?.wv_license_proxy_url_vod as string) || null;
        if (wvUrl) storedLicenseUrl = wvUrl.replace("/wv/license", "/fp/license");
      }

      const accessToken = latest?.access_token as string | undefined;

      if (storedLicenseUrl && accessToken && isAccessTokenValid(latest!)) {
        proxyFairPlay(storedLicenseUrl, accessToken);
        return;
      }

      if (!deviceUid) return res.status(403).json({ error: "no device" });

      ensureDeviceAccessToken(deviceUid).then(async (token) => {
        if (!token) return res.status(502).json({ error: "no access token" });
        const updated = loadLatestTokens(deviceUid);

        let licenseUrl = info.kind === "tv"
          ? (updated?.fp_license_proxy_url_live as string) || null
          : (updated?.fp_license_proxy_url_vod as string) || null;

        if (!licenseUrl) {
          const wvUrl = info.kind === "tv"
            ? (updated?.wv_license_proxy_url_live as string) || null
            : (updated?.wv_license_proxy_url_vod as string) || null;
          if (wvUrl) licenseUrl = wvUrl.replace("/wv/license", "/fp/license");
        }

        if (!licenseUrl) return res.status(502).json({ error: "no fp license url" });
        proxyFairPlay(licenseUrl, token);
      }).catch((err) => {
        log("[drm-fp] error:", err?.message || err);
        if (!res.headersSent) res.status(502).json({ error: "drm error" });
      });
      return;
    }

    // Widevine path (existing logic)
    const storedLicenseUrl = info.kind === "tv"
      ? (latest?.wv_license_proxy_url_live as string) || null
      : (latest?.wv_license_proxy_url_vod as string) || null;
    log(`[drm-wv] storedLicenseUrl=${storedLicenseUrl ? "yes" : "null"} hasToken=${!!latest?.access_token} accessValid=${latest ? isAccessTokenValid(latest) : false} deviceUid=${deviceUid?.slice(0, 8)}`);

    if (storedLicenseUrl && latest?.access_token && isAccessTokenValid(latest)) {
      proxyWidevine(storedLicenseUrl, latest.access_token as string);
      return;
    }

    if (!deviceUid) return res.status(403).json({ error: "no device" });

    ensureDeviceAccessToken(deviceUid).then(async (accessToken) => {
      if (!accessToken) return res.status(502).json({ error: "no access token" });
      const updated = loadLatestTokens(deviceUid);
      const userId = String(updated?.user_id || "918558");

      const contentUid = info.kind === "tv" ? "channelone" : (info.contentUid || "23145");
      log(`[drm] WV fetch-on-demand: userId=${userId} kind=${info.kind} contentUid=${contentUid} accessToken=${accessToken ? "present" : "null"}`);
      let licenseUrl = info.kind === "tv"
        ? await fetchWvLicenseProxyUrlLive(accessToken, userId, contentUid)
        : await fetchWvLicenseProxyUrlVod(accessToken, contentUid, userId);
      log(`[drm] WV licenseUrl=${licenseUrl ? licenseUrl.substring(0, 60) + "..." : "null"}`);
      if (!licenseUrl) {
        const fallbackFn = info.kind === "tv" ? fetchWvLicenseProxyUrlVod : fetchWvLicenseProxyUrlLive;
        licenseUrl = await fallbackFn(accessToken, "23145", userId);
      }

      if (licenseUrl && updated) {
        const store = loadTokensStore();
        const arr = store[deviceUid] as Array<Record<string, unknown>> | undefined;
        if (arr && arr.length > 0) {
          const last = arr[arr.length - 1];
          const t = (last.tokens || last.widevine || last) as Record<string, unknown>;
          if (info.kind === "tv") t.wv_license_proxy_url_live = licenseUrl;
          else t.wv_license_proxy_url_vod = licenseUrl;
          saveTokensStore(store);
        }
      }

      if (!licenseUrl) return res.status(502).json({ error: "no license url" });
      proxyWidevine(licenseUrl, accessToken);
    }).catch((err) => {
      log("[drm] error:", err?.message || err);
      if (!res.headersSent) res.status(502).json({ error: "drm error" });
    });
  } catch (e) {
    log("[drm] handler error:", (e as Error).message);
    if (!res.headersSent) res.status(500).json({ error: "drm handler error" });
  }
});

// ── M3U ─────────────────────────────────────────────────────
const SPORTS_CATEGORY_UIDS = ["paparevod", "goldenmemories", "iccworldcup", "fifa26highlights", "fifa2026full", "iplvod"];

expressApp.get("/movies.m3u", requireDeviceAuth, (req, res) => {
  const base = getBaseUrl(req);
  const deviceUid = (req as Record<string, unknown>).deviceUid as string;
  const epgToken = issueEpgToken(deviceUid);
  const idx = loadCategoriesIndex();
  if (!idx || !Array.isArray(idx.data)) return res.status(503).type("text/plain").send("#EXTM3U\n# not ready\n");
  const sportsSet = new Set(SPORTS_CATEGORY_UIDS.map((s) => s.toLowerCase()));
  const seen = new Set<string>();
  const items: unknown[] = [];
  for (const cat of idx.data) {
    if (sportsSet.has(String(cat.uid || "").toLowerCase())) continue;
    const file = loadCategoryFile(cat.id);
    if (!file || !Array.isArray(file.content)) continue;
    for (const item of file.content) {
      if (!item || !item.id || !item.uid) continue;
      if (item.type !== "movie") continue;
      if (seen.has(String(item.id))) continue;
      seen.add(String(item.id));
      items.push(item);
    }
  }
  res.setHeader("Content-Type", "audio/x-mpegurl; charset=utf-8");
  res.setHeader("Content-Disposition", 'inline; filename="movies.m3u"');
  res.send(
    `#EXTM3U\n# LankaTV Movies — ${items.length}\n# ${new Date().toISOString()}\n` +
      (items as Array<Record<string, unknown>>).map((i) => buildMovieEntry(i, base, deviceUid)).join("")
  );
});

expressApp.get("/live.m3u", requireDeviceAuth, (req, res) => {
  const cj = loadChannels();
  if (!cj) return res.status(500).type("text/plain").send("#EXTM3U\n# not ready\n");
  const base = getBaseUrl(req);
  const deviceUid = (req as Record<string, unknown>).deviceUid as string;
  const epgToken = issueEpgToken(deviceUid);
  const channels = flattenChannels(cj);
  const epg = `${base}/epg.xml.gz?token=${epgToken}`;
  const parts = [`#EXTM3U x-tvg-url="${epg}" url-tvg="${epg}"\n# LankaTV Live\n# ${new Date().toISOString()}\n`];
  for (const ch of channels) {
    const e = buildLiveEntry(ch, base, deviceUid);
    if (e) parts.push(e);
  }
  res.setHeader("Content-Type", "audio/x-mpegurl; charset=utf-8");
  res.setHeader("Content-Disposition", 'inline; filename="live.m3u"');
  res.send(parts.join(""));
});

expressApp.get("/sports.m3u", requireDeviceAuth, (req, res) => {
  const base = getBaseUrl(req);
  const idx = loadCategoriesIndex();
  if (!idx || !Array.isArray(idx.data)) return res.status(503).type("text/plain").send("#EXTM3U\n# not ready\n");
  const sportsSet = new Set(SPORTS_CATEGORY_UIDS.map((s) => s.toLowerCase()));
  const seen = new Set<string>();
  const items: unknown[] = [];
  for (const cat of idx.data) {
    if (!sportsSet.has(String(cat.uid || "").toLowerCase())) continue;
    const file = loadCategoryFile(cat.id);
    if (!file || !Array.isArray(file.content)) continue;
    for (const item of file.content) {
      if (!item || !item.id || !item.uid) continue;
      if (item.type !== "movie") continue;
      if (seen.has(String(item.id))) continue;
      seen.add(String(item.id));
      items.push(item);
    }
  }
  res.setHeader("Content-Type", "audio/x-mpegurl; charset=utf-8");
  res.setHeader("Content-Disposition", 'inline; filename="sports.m3u"');
  res.send(
    `#EXTM3U\n# LankaTV Sports — ${items.length}\n# ${new Date().toISOString()}\n` +
      (items as Array<Record<string, unknown>>).map((i) => buildMovieEntry(i, base, deviceUid)).join("")
  );
});

expressApp.get("/series.m3u", requireDeviceAuth, (req, res) => {
  const base = getBaseUrl(req);
  const deviceUid = (req as Record<string, unknown>).deviceUid as string;
  const idx = loadCategoriesIndex();
  if (!idx || !Array.isArray(idx.data)) return res.status(503).type("text/plain").send("#EXTM3U\n# not ready\n");
  const seen = new Set<string>();
  const parts: string[] = [`#EXTM3U\n# LankaTV Series\n# ${new Date().toISOString()}\n`];
  let epCount = 0;
  for (const cat of idx.data) {
    const file = loadCategoryFile(cat.id);
    if (!file || !Array.isArray(file.content)) continue;
    for (const item of file.content) {
      if (!item || !item.id || !item.uid) continue;
      if (item.type !== "series") continue;
      if (seen.has(String(item.id))) continue;
      seen.add(String(item.id));
      const seriesTitle = escapeM3U(String(item.title || ""));
      const logo = item.image_id ? `${base}/api/img/${item.image_id}` : "";
      const seasons = (item.seasons || []) as Array<{ number?: number; episodes?: Array<{ id?: string | number; cm_episode?: string; number?: number; title?: string; image_store?: Array<{ image_store_id?: number }> }> }>;
      for (const season of seasons) {
        for (const ep of season.episodes || []) {
          if (!ep || !ep.id || !ep.cm_episode) continue;
          const epUid = makeUidLocal("e", ep.id);
          const realPath = `bpcdn.dialog.lk/bpk-vod/vodprod/output/${ep.cm_episode}/${ep.cm_episode}/index.mpd`;
          const streamToken = encryptStreamPath(realPath, STREAM_TOKEN_TTL_MS);
          const drmToken = signDrmToken("content", DRM_LICENSE_TTL_MS, deviceUid);
          const epTitle = escapeM3U(String(ep.title || `S${season.number || 1}E${ep.number || ""}`));
          const epLogo = (ep.image_store && ep.image_store[0]?.image_store_id) ? `${base}/api/img/${ep.image_store[0].image_store_id}` : logo;
          parts.push(
            `#EXTINF:-1 tvg-id="${epUid}" tvg-name="${epTitle}" tvg-logo="${epLogo}" group-title="${seriesTitle}",${seriesTitle} — ${epTitle}\n` +
            `#KODIPROP:inputstream=inputstream.adaptive\n` +
            `#KODIPROP:inputstream.adaptive.manifest_type=mpd\n` +
            `#KODIPROP:inputstream.adaptive.license_type=com.widevine.alpha\n` +
            `#KODIPROP:inputstream.adaptive.license_key=${base}/api/drm/${drmToken}\n` +
            `${base}/api/stream/t/${streamToken}\n`
          );
          epCount++;
        }
      }
    }
  }
  res.setHeader("Content-Type", "audio/x-mpegurl; charset=utf-8");
  res.setHeader("Content-Disposition", 'inline; filename="series.m3u"');
  parts[0] = `#EXTM3U\n# LankaTV Series — ${epCount} episodes\n# ${new Date().toISOString()}\n`;
  res.send(parts.join(""));
});

// ── EPG XML ────────────────────────────────────────────────
function streamFile(req: express.Request, res: express.Response, file: string, contentType: string) {
  const token = (req.query.token as string) || "";
  if (token) {
    const deviceUid = verifyEpgToken(token);
    if (!deviceUid) return res.status(401).json({ error: "Invalid or expired EPG token" });
  } else {
    const deviceUid = (req.headers["x-device-uid"] as string) || "";
    if (!deviceUid) return res.status(401).json({ error: "EPG token or device auth required" });
    const latest = loadLatestTokens(deviceUid);
    const status = tokenStatus(latest);
    if (status !== "access_valid" && status !== "refresh_valid") {
      return res.status(401).json({ error: "Login required" });
    }
  }
  if (!fs.existsSync(file)) return res.status(404).json({ error: "not found" });
  const stat = fs.statSync(file);
  const etag = `"${stat.mtimeMs.toString(36)}-${stat.size.toString(36)}"`;
  if (req.headers["if-none-match"] === etag) return res.status(304).end();
  res.setHeader("Content-Type", contentType);
  res.setHeader("Cache-Control", "public, max-age=30");
  res.setHeader("ETag", etag);
  fs.createReadStream(file).pipe(res);
}

expressApp.get("/epg.xml", (req, res) => streamFile(req, res, EPG_XML_FILE, "application/xml; charset=utf-8"));
expressApp.get("/epg.xml.gz", (req, res) => streamFile(req, res, EPG_GZ_FILE, "application/gzip"));

// ── ADMIN ROUTES ────────────────────────────────────────────
expressApp.post("/admin/login", (req, res) => {
  const { password } = req.body || {};
  if (!password) return res.status(400).json({ error: "password required" });
  if (!timingSafePassword(String(password), ADMIN_PASSWORD)) return res.status(401).json({ error: "Invalid" });
  const token = createAdminSession();
  res.json({ ok: true, token, expiresIn: 4 * 3600 });
});

expressApp.get("/admin/verify", adminAuthMiddleware, (req, res) => res.json({ ok: true }));

expressApp.get("/admin/health", adminAuthMiddleware, (req, res) => {
  const idx = loadCategoriesIndex();
  const cats = idx?.data || [];
  let totalMovies = 0;
  let totalSeries = 0;
  for (const c of cats) {
    totalMovies += c.movies_count || 0;
    totalSeries += c.series_count || 0;
  }
  let channels = 0;
  try {
    const cj = loadChannels();
    if (cj) channels = flattenChannels(cj).length;
  } catch {}
  let epgData = { exists: false, updatedAt: null as string | null, programCount: 0 };
  try {
    const e = loadEpgJson();
    epgData.exists = fs.existsSync(EPG_XML_FILE);
    epgData.updatedAt = e?.updatedAt || null;
    epgData.programCount = e?.programs?.length || 0;
  } catch {}
  res.json({
    ok: true,
    server: { uptimeSec: Math.round(process.uptime()), nodeVersion: process.version, now: new Date().toISOString() },
    caches: { mpd: mpdCache.size, m3u8: m3u8Cache.size, pssh: Object.keys(psshCache).length, uid: Object.keys(UID_MAP.forward).length, episodes: EPISODE_CM_CACHE.size },
    tokens: { hasAccess: !!tokens.access, hasRefresh: !!tokens.refresh, minutesLeft: tokens.expiresAt ? Math.round((tokens.expiresAt - Date.now()) / 60000) : 0 },
    counts: { channels, categories: cats.length, movies: totalMovies, series: totalSeries },
    epg: epgData,
  });
});

expressApp.get("/admin/socket/stats", adminAuthMiddleware, (req, res) => {
  const io = SOCKET_STATS.io;
  if (!io) return res.json({ ok: false, error: "Socket.IO not attached" });
  const connected: unknown[] = [];
  for (const [id, meta] of SOCKET_STATS.connectedAt.entries()) {
    connected.push({ id, ip: meta.ip, userAgent: meta.ua, connectedForSec: Math.round((Date.now() - meta.ts) / 1000) });
  }
  res.json({
    ok: true,
    clientsConnected: io.engine.clientsCount,
    totalConnections: SOCKET_STATS.totalConnections,
    totalResolves: SOCKET_STATS.totalResolves,
    totalDelegateResolves: SOCKET_STATS.totalDelegateResolves,
    pendingDelegate: PENDING_RESOLVES.size,
    connectedClients: connected,
    now: new Date().toISOString(),
  });
});

expressApp.get("/admin/stats/categories", adminAuthMiddleware, (req, res) => {
  const idx = loadCategoriesIndex();
  if (!idx) return res.status(404).json({ error: "no data" });
  const cats = (idx.data || []).map((c) => {
    const file = loadCategoryFile(c.id);
    return {
      id: c.id,
      slug: c.uid,
      name: c.name,
      desc: c.desc,
      movies_count: c.movies_count || 0,
      series_count: c.series_count || 0,
      updatedAt: c.updatedAt || null,
      fileExists: !!file,
      itemCount: file ? (file.content || []).length : 0,
    };
  });
  res.json({ updatedAt: idx.updatedAt, total: cats.length, categories: cats });
});

async function handleRefreshChannels(req: express.Request, res: express.Response) {
  try {
    res.json({ ok: true, ...(await refreshChannelsFile()) });
  } catch (e) {
    res.status(500).json({ ok: false, error: (e as Error).message });
  }
}

async function handleRefreshContent(req: express.Request, res: express.Response) {
  try {
    res.json({ ok: true, ...(await rebuildAllCategories()), updatedAt: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ ok: false, error: (e as Error).message });
  }
}

async function handleRefreshEpg(req: express.Request, res: express.Response) {
  try {
    res.json({ ok: true, ...(await refreshEpgFile() as object) });
  } catch (e) {
    res.status(500).json({ ok: false, error: (e as Error).message });
  }
}

function rebuildUidMap(): { before: number; after: number; channels: number; categories: number; movies: number; series: number; episodes: number } {
  const before = Object.keys(UID_MAP.forward).length;
  let channels = 0, categories = 0, movies = 0, series = 0, episodes = 0;

  const cj = loadChannels();
  if (cj) {
    const chs = flattenChannels(cj);
    for (const ch of chs) {
      const realId = (ch as any).realId ?? (ch as any).id;
      if (realId != null) { makeUidLocal("c", realId); channels++; }
    }
  }

  const idx = loadCategoriesIndex();
  const cats = idx?.data || [];
  for (const cat of cats) {
    makeUidLocal("k", cat.id);
    categories++;
    const file = loadCategoryFile(cat.id);
    if (!file || !Array.isArray(file.content)) continue;
    for (const item of file.content) {
      if (!item || item.id == null) continue;
      const isSeries = item.type === "series" || !!item.seasons;
      makeUidLocal(isSeries ? "s" : "m", item.id);
      if (isSeries) series++; else movies++;
      if (Array.isArray(item.seasons)) {
        for (const season of item.seasons) {
          for (const ep of (season as any).episodes || []) {
            if (ep?.id != null) { makeUidLocal("e", ep.id); episodes++; }
          }
        }
      }
      if (Array.isArray(item.episodes)) {
        for (const ep of item.episodes) {
          if (ep?.id != null) { makeUidLocal("e", ep.id); episodes++; }
        }
      }
    }
  }

  const after = Object.keys(UID_MAP.forward).length;
  scheduleUidSave();
  return { before, after, channels, categories, movies, series, episodes };
}

async function handleRefreshAll(req: express.Request, res: express.Response) {
  try {
    const [ch, ct] = await Promise.allSettled([refreshChannelsFile(), rebuildAllCategories()]);
    let epg;
    try {
      epg = { ok: true, ...(await refreshEpgFile() as object) };
    } catch (e) {
      epg = { ok: false, error: (e as Error).message };
    }
    res.json({
      ok: true,
      channels: ch.status === "fulfilled" ? ch.value : { error: (ch.reason as Error)?.message },
      content: ct.status === "fulfilled" ? ct.value : { error: (ct.reason as Error)?.message },
      epg,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: (e as Error).message });
  }
}

expressApp.post("/admin/refresh-channels", adminAuthMiddleware, (req, res) => handleRefreshChannels(req, res));
expressApp.post("/admin/refresh-content", adminAuthMiddleware, (req, res) => handleRefreshContent(req, res));
expressApp.post("/admin/refresh-epg", adminAuthMiddleware, (req, res) => handleRefreshEpg(req, res));
expressApp.post("/admin/refresh-all", adminAuthMiddleware, (req, res) => handleRefreshAll(req, res));
expressApp.post("/admin/rebuild-uid-map", adminAuthMiddleware, (req, res) => {
  try {
    const result = rebuildUidMap();
    res.json({ ok: true, ...result });
  } catch (e) { res.status(500).json({ ok: false, error: (e as Error).message }); }
});

// ── DEVICES CRUD ────────────────────────────────────────────
expressApp.get("/admin/devices", adminAuthMiddleware, (req, res) => {
  try {
    const devices = getAllDevices();
    res.json({ ok: true, count: devices.length, devices });
  } catch (e) { res.status(500).json({ error: (e as Error).message }); }
});

expressApp.delete("/admin/devices/:uuid", adminAuthMiddleware, (req, res) => {
  try {
    deleteDevice(req.params.uuid);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: (e as Error).message }); }
});

// ── TOKENS CRUD ─────────────────────────────────────────────
expressApp.get("/admin/tokens", adminAuthMiddleware, (req, res) => {
  try {
    const tokens = getAllTokens().map((t: Record<string, unknown>) => ({
      user_id: t.user_id,
      expires_at: t.expires_at,
      mobileNumber: t.mobileNumber ? maskMobile(String(t.mobileNumber)) : undefined,
      has_access: !!t.access_token,
      has_refresh: !!t.refresh_token,
    }));
    res.json({ ok: true, count: tokens.length, tokens });
  } catch (e) { res.status(500).json({ error: (e as Error).message }); }
});

expressApp.delete("/admin/tokens/:deviceUid", adminAuthMiddleware, (req, res) => {
  try {
    deleteToken(req.params.deviceUid);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: (e as Error).message }); }
});

// ── DRM LICENSE URLS ────────────────────────────────────────
expressApp.get("/admin/config", adminAuthMiddleware, (req, res) => {
  try {
    res.json({
      ok: true,
      cache: getCacheSizes(),
    });
  } catch (e) { res.status(500).json({ error: (e as Error).message }); }
});

expressApp.post("/admin/config", adminAuthMiddleware, async (req, res) => {
  try {
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: (e as Error).message }); }
});

// ── CACHE INVALIDATE ────────────────────────────────────────
expressApp.post("/admin/cache/invalidate", adminAuthMiddleware, async (req, res) => {
  try {
    await reloadFromMongo();
    res.json({ ok: true, message: "All caches refreshed" });
  } catch (e) { res.status(500).json({ error: (e as Error).message }); }
});

// ── GENERIC MONGODB CRUD ────────────────────────────────────
const VALID_COLLECTIONS = ["channels", "categories_index", "categories", "packages", "devices", "tokens", "config"];

expressApp.get("/admin/mongo/:collection", adminAuthMiddleware, async (req, res) => {
  const colName = req.params.collection;
  if (!VALID_COLLECTIONS.includes(colName)) return res.status(400).json({ error: "Invalid collection" });
  try {
    const { col } = await import("./src/lib/mongo");
    const docs = await col(colName).find().toArray();
    const safe = docs.map(({ _id, ...rest }) => ({ _id, ...rest }));
    res.json({ ok: true, count: safe.length, docs: safe });
  } catch (e) { res.status(500).json({ error: (e as Error).message }); }
});

expressApp.get("/admin/mongo/:collection/:id", adminAuthMiddleware, async (req, res) => {
  const colName = req.params.collection;
  if (!VALID_COLLECTIONS.includes(colName)) return res.status(400).json({ error: "Invalid collection" });
  try {
    const { col } = await import("./src/lib/mongo");
    const id = isNaN(Number(req.params.id)) ? req.params.id : Number(req.params.id);
    const doc = await col(colName).findOne({ _id: id });
    if (!doc) return res.status(404).json({ error: "Not found" });
    const { _id, ...rest } = doc;
    res.json({ ok: true, doc: { _id, ...rest } });
  } catch (e) { res.status(500).json({ error: (e as Error).message }); }
});

expressApp.put("/admin/mongo/:collection/:id", adminAuthMiddleware, async (req, res) => {
  const colName = req.params.collection;
  if (!VALID_COLLECTIONS.includes(colName)) return res.status(400).json({ error: "Invalid collection" });
  try {
    const { col } = await import("./src/lib/mongo");
    const id = isNaN(Number(req.params.id)) ? req.params.id : Number(req.params.id);
    const { _id, ...data } = req.body;
    await col(colName).updateOne({ _id: id }, { $set: data }, { upsert: true });
    await reloadFromMongo();
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: (e as Error).message }); }
});

expressApp.delete("/admin/mongo/:collection/:id", adminAuthMiddleware, async (req, res) => {
  const colName = req.params.collection;
  if (!VALID_COLLECTIONS.includes(colName)) return res.status(400).json({ error: "Invalid collection" });
  try {
    const { col } = await import("./src/lib/mongo");
    const id = isNaN(Number(req.params.id)) ? req.params.id : Number(req.params.id);
    await col(colName).deleteOne({ _id: id });
    await reloadFromMongo();
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: (e as Error).message }); }
});

// ── IMPORT (clear + insert) ─────────────────────────────────
// Supports original file formats:
//   channels.json:         { status, data: [...] }  → stored as { _id: "main", status, data: [...] }
//   categories.json:       { status, updatedAt, data: [...] } → stored as { _id: "index", ...rest }
//   categories/{id}.json:  { status, id, updatedAt, meta, content: [...] } → stored as { _id: id, ...rest }
//   tokens.json:           { access, refresh, tv_wv_license_proxy_url, ... } → stored as { _id: "tokens", ...rest }
//   devices/*.json:        { deviceUid, mobile, ... } → stored as { _id: deviceUid, ...rest }
//   Also accepts: array of docs, or { docs: [...] }
expressApp.post("/admin/mongo/:collection/import", adminAuthMiddleware, async (req, res) => {
  const colName = req.params.collection;
  if (!VALID_COLLECTIONS.includes(colName)) return res.status(400).json({ error: "Invalid collection" });
  try {
    const { col } = await import("./src/lib/mongo");
    const body = req.body;

    // Clear collection first
    await col(colName).deleteMany({});

    let inserted = 0;

    if (colName === "channels") {
      // Original: { status, data: [...] }
      if (body.data && Array.isArray(body.data)) {
        await col("channels").insertOne({ _id: "main", status: body.status, updatedAt: body.updatedAt, data: body.data });
        inserted = 1;
      } else if (Array.isArray(body)) {
        // Raw array of channels → wrap
        await col("channels").insertOne({ _id: "main", status: "ok", updatedAt: new Date().toISOString(), data: body });
        inserted = 1;
      } else if (body.docs && Array.isArray(body.docs)) {
        await col("channels").insertOne({ _id: "main", status: "ok", updatedAt: new Date().toISOString(), data: body.docs });
        inserted = 1;
      }

    } else if (colName === "categories_index") {
      // Original: { status, updatedAt, data: [...] }
      if (body.data && Array.isArray(body.data)) {
        await col("categories_index").insertOne({ _id: "index", status: body.status, updatedAt: body.updatedAt, data: body.data });
        inserted = body.data.length;
      } else if (Array.isArray(body)) {
        await col("categories_index").insertOne({ _id: "index", status: "ok", updatedAt: new Date().toISOString(), data: body });
        inserted = body.length;
      }

    } else if (colName === "packages") {
      // Original: { status, data: [...] }
      if (body.data && Array.isArray(body.data)) {
        await col(colName).insertOne({ _id: "main", status: body.status, updatedAt: body.updatedAt, data: body.data });
        inserted = body.data.length;
      } else if (Array.isArray(body)) {
        await col(colName).insertOne({ _id: "main", status: "ok", updatedAt: new Date().toISOString(), data: body });
        inserted = body.length;
      } else if (body.docs && Array.isArray(body.docs)) {
        await col(colName).insertOne({ _id: "main", status: "ok", updatedAt: new Date().toISOString(), data: body.docs });
        inserted = body.docs.length;
      }

    } else if (colName === "categories") {
      // Original: single category file { status, id, updatedAt, meta, content: [...] }
      if (body.id !== undefined && body.content && Array.isArray(body.content)) {
        const id = body.id;
        const { _id, ...rest } = body;
        await col("categories").insertOne({ _id: id, ...rest });
        inserted = 1;
      } else if (Array.isArray(body)) {
        // Array of category objects
        for (const item of body) {
          const id = item._id || item.id;
          const { _id, ...rest } = item;
          await col("categories").insertOne({ _id: id, ...rest });
          inserted++;
        }
      } else if (body.docs && Array.isArray(body.docs)) {
        for (const item of body.docs) {
          const id = item._id || item.id;
          const { _id, ...rest } = item;
          await col("categories").insertOne({ _id: id, ...rest });
          inserted++;
        }
      } else if (body.data && Array.isArray(body.data)) {
        // categories.json index format being imported into categories
        for (const item of body.data) {
          const id = item._id || item.id;
          const { _id, ...rest } = item;
          await col("categories").insertOne({ _id: id, ...rest });
          inserted++;
        }
      }

    } else if (colName === "config") {
      // Original tokens.json: { access, refresh, tv_wv_license_proxy_url, ... }
      const { _id, ...rest } = body;
      if (Object.keys(rest).length > 0) {
        await col("config").insertOne({ _id: "tokens", ...rest });
        inserted = 1;
      } else if (body._id !== undefined) {
        await col("config").insertOne(body);
        inserted = 1;
      }

    } else if (colName === "devices") {
      // Original: single device { deviceUid, mobile, ... }
      if (body.deviceUid) {
        const { _id, ...rest } = body;
        await col("devices").insertOne({ _id: body.deviceUid, ...rest });
        inserted = 1;
      } else if (Array.isArray(body)) {
        for (const item of body) {
          const uid = item.deviceUid || item._id;
          const { _id, ...rest } = item;
          await col("devices").insertOne({ _id: uid, ...rest });
          inserted++;
        }
      } else if (body.docs && Array.isArray(body.docs)) {
        for (const item of body.docs) {
          const uid = item.deviceUid || item._id;
          const { _id, ...rest } = item;
          await col("devices").insertOne({ _id: uid, ...rest });
          inserted++;
        }
      }

    } else if (colName === "tokens") {
      // Original: { deviceUid, access_token, ... } or array
      if (body.deviceUid) {
        const { _id, ...rest } = body;
        await col("tokens").insertOne({ _id: body.deviceUid, ...rest });
        inserted = 1;
      } else if (Array.isArray(body)) {
        for (const item of body) {
          const uid = item.deviceUid || item._id;
          const { _id, ...rest } = item;
          await col("tokens").insertOne({ _id: uid, ...rest });
          inserted++;
        }
      } else if (body.docs && Array.isArray(body.docs)) {
        for (const item of body.docs) {
          const uid = item.deviceUid || item._id;
          const { _id, ...rest } = item;
          await col("tokens").insertOne({ _id: uid, ...rest });
          inserted++;
        }
      }

    } else {
      // Generic fallback
      let docs: Array<Record<string, unknown>> = [];
      if (Array.isArray(body)) docs = body;
      else if (body.docs && Array.isArray(body.docs)) docs = body.docs;
      else docs = [body];

      for (const d of docs) {
        const { _id, ...rest } = d;
        const id = _id !== undefined ? _id : d.id !== undefined ? d.id : undefined;
        if (id !== undefined) await col(colName).insertOne({ _id: id, ...rest });
        else await col(colName).insertOne(rest);
        inserted++;
      }
    }

    await reloadFromMongo();
    log(`[admin] Import ${colName}: ${inserted} docs`);
    res.json({ ok: true, count: inserted });
  } catch (e) { res.status(500).json({ error: (e as Error).message }); }
});

// ── IMPORT FROM JSON FILES (server-side) ─────────────────────
const DATAPLAY_DIR = path.join(process.cwd(), "..", "data");

expressApp.post("/admin/import-from-files", adminAuthMiddleware, async (req, res) => {
  try {
    const { col } = await import("./src/lib/mongo");
    let imported = 0;

    // channels.json — check both play-app/data and parent data
    const channelsPath = fs.existsSync(CHANNELS_FILE) ? CHANNELS_FILE : path.join(DATAPLAY_DIR, "channels.json");
    if (fs.existsSync(channelsPath)) {
      const data = JSON.parse(fs.readFileSync(channelsPath, "utf8"));
      await col("channels").deleteMany({});
      await col("channels").insertOne({ _id: "main", data });
      imported++;
      log("[admin] Imported channels.json");
    }

    // categories.json
    const catsIdxPath = fs.existsSync(CATEGORIES_INDEX) ? CATEGORIES_INDEX : path.join(DATAPLAY_DIR, "categories.json");
    if (fs.existsSync(catsIdxPath)) {
      const data = JSON.parse(fs.readFileSync(catsIdxPath, "utf8"));
      await col("categories_index").deleteMany({});
      await col("categories_index").insertOne({ _id: "index", status: data.status, updatedAt: data.updatedAt, data: data.data || [] });
      imported++;
      log("[admin] Imported categories.json");
    }

    // categories/*.json
    const catsDir = fs.existsSync(CATEGORIES_DIR) ? CATEGORIES_DIR : path.join(DATAPLAY_DIR, "categories");
    if (fs.existsSync(catsDir)) {
      const files = fs.readdirSync(catsDir).filter(f => f.endsWith(".json"));
      await col("categories").deleteMany({});
      for (const f of files) {
        const data = JSON.parse(fs.readFileSync(path.join(catsDir, f), "utf8"));
        const id = data.id || parseInt(f.replace(".json", ""), 10);
        await col("categories").insertOne({ _id: id, ...data });
      }
      imported += files.length;
      log(`[admin] Imported ${files.length} category files`);
    }

    // packages.json (from parent dataplay dir)
    const packagesPath = path.join(DATAPLAY_DIR, "packages.json");
    if (fs.existsSync(packagesPath)) {
      const data = JSON.parse(fs.readFileSync(packagesPath, "utf8"));
      await col("packages").deleteMany({});
      await col("packages").insertOne({ _id: "main", status: data.status, data: data.data || [] });
      imported++;
      log("[admin] Imported packages.json");
    }

    // tokens.json (root — DRM license URLs)
    if (fs.existsSync(TOKENS_FILE)) {
      const data = JSON.parse(fs.readFileSync(TOKENS_FILE, "utf8"));
      await col("config").deleteMany({});
      await col("config").insertOne({ _id: "tokens", ...data });
      imported++;
      log("[admin] Imported tokens.json");
    }

    // devices/*.json
    if (fs.existsSync(DEVICES_DIR)) {
      const files = fs.readdirSync(DEVICES_DIR).filter(f => f.endsWith(".json"));
      await col("devices").deleteMany({});
      for (const f of files) {
        const data = JSON.parse(fs.readFileSync(path.join(DEVICES_DIR, f), "utf8"));
        const uuid = f.replace(".json", "");
        await col("devices").insertOne({ _id: uuid, ...data });
      }
      imported += files.length;
      log(`[admin] Imported ${files.length} device files`);
    }

    await reloadFromMongo();
    res.json({ ok: true, imported });
  } catch (e) { res.status(500).json({ error: (e as Error).message }); }
});

// ── CONFIG ──────────────────────────────────────────────────
expressApp.get("/config", (req, res) => {
  res.setHeader("Cache-Control", "public, max-age=60");
  res.json({ ok: true, tokenTtl: Math.floor(STREAM_TOKEN_TTL_MS / 1000), drmTtl: Math.floor(DRM_LICENSE_TTL_MS / 1000) });
});

// ── TELEGRAM CONTACT ──────────────────────────────────────────
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "8279567692:AAEAauM0Jw1c2F-DyUisiFyncHSFBiCNIe0";
const TELEGRAM_OWNER_ID = process.env.TELEGRAM_OWNER_ID || "1593769028";

expressApp.post("/api/telegram", async (req, res) => {
  try {
    const { name, message } = req.body || {};
    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "Message is required" });
    }
    const text = `📢 *Copyright Contact Request*\n\n*From:* ${name || "Anonymous"}\n*Message:* ${message}`;
    const r = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: TELEGRAM_OWNER_ID, text, parse_mode: "Markdown" }),
    });
    const data = await r.json();
    if (!data.ok) return res.status(500).json({ error: "Failed to send" });
    res.json({ ok: true });
  } catch { res.status(500).json({ error: "Internal error" }); }
});

// ── TELEGRAM WEBHOOK ──────────────────────────────────────────
expressApp.post("/api/telegram/webhook", async (req, res) => {
  try {
    const update = req.body;
    const msg = update.message;
    if (!msg) return res.json({ ok: true });
    const chatId = msg.chat.id;
    const text = msg.text || "";
    const firstName = msg.from?.first_name || "User";
    const lastName = msg.from?.last_name || "";
    const username = msg.from?.username ? `@${msg.from.username}` : "";
    if (String(chatId) === TELEGRAM_OWNER_ID && msg.reply_to_message) {
      const match = msg.reply_to_message.text?.match(/👤 User: (.+)\n🆔 ID: (\d+)/);
      if (match) {
        const userId = match[2];
        await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: userId, text: `💬 *Owner:* ${text}`, parse_mode: "Markdown" }),
        });
      }
      return res.json({ ok: true });
    }
    if (String(chatId) !== TELEGRAM_OWNER_ID) {
      const ownerText = `📩 *New Message*\n\n👤 User: ${firstName} ${lastName} ${username}\n🆔 ID: ${chatId}\n\n💬 ${text}`;
      await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: TELEGRAM_OWNER_ID, text: ownerText, parse_mode: "Markdown" }),
      });
      await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: "✅ Your message has been sent. We'll get back to you soon." }),
      });
    }
    res.json({ ok: true });
  } catch { res.json({ ok: true }); }
});

// ── TELEGRAM WEBHOOK SETUP ──────────────────────────────────
expressApp.get("/api/telegram/setup", async (req, res) => {
  try {
    const baseUrl = req.query.url as string;
    if (!baseUrl) return res.json({ error: "Missing ?url= parameter" });
    const webhookUrl = `${baseUrl.replace(/\/$/, "")}/api/telegram/webhook`;
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/deleteWebhook`);
    const r = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: webhookUrl, allowed_updates: ["message"] }),
    });
    const data = await r.json();
    res.json({ ok: data.ok, webhook_url: webhookUrl, description: data.description });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// ── NEXT.JS HANDLER (fallback for all non-API routes) ──────
expressApp.all("*path", (req, res) => {
  return handle(req, res);
});

// ================================================================
// AUTO REFRESH
// ================================================================
async function runAutoRefresh() {
  log("[auto-refresh] …");
  const [a, b] = await Promise.allSettled([refreshChannelsFile(), rebuildAllCategories()]);
  if (a.status === "fulfilled") log(`[auto-refresh] channels ✓ ${a.value.count}`);
  if (b.status === "fulfilled") log(`[auto-refresh] content ✓ ${(b.value as Record<string, unknown>).ok} ok`);
  try {
    const r = (await refreshEpgFile()) as { count: number };
    log(`[auto-refresh] epg ✓ ${r.count}`);
  } catch (e) {
    log(`[auto-refresh] epg ✗ ${(e as Error).message}`);
  }
}

// ================================================================
// START
// ================================================================
async function main() {
  await app.prepare();

  // Intercept DRM POST at raw HTTP level — Express 5 body-parser consumes the stream
  const server = createServer((req, res) => {
    if (req.method === "POST" && req.url?.startsWith("/api/drm/")) {
      const chunks: Buffer[] = [];
      let totalBytes = 0;
      const MAX_DRM_BODY = 1024 * 1024;
      req.on("data", (c: Buffer) => { totalBytes += c.length; if (totalBytes > MAX_DRM_BODY) { req.destroy(); return; } chunks.push(c); });
      req.on("end", () => {
        const rawBody = Buffer.concat(chunks);
        (req as any)._rawDrmBody = rawBody;
        log(`[drm-body] captured ${rawBody.length}b hex=${rawBody.slice(0, 20).toString("hex")}`);
        expressApp(req, res);
      });
      req.on("error", () => { res.writeHead(500); res.end(); });
    } else {
      expressApp(req, res);
    }
  });
  const io = new SocketIOServer(server, {
    cors: { origin: "*", methods: ["GET", "POST"] },
    pingTimeout: 60000,
    pingInterval: 25000,
    maxHttpBufferSize: 1e6,
  });
  SOCKET_STATS.io = io;

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (token === SOCKET_SECRET) return next();
    return next(new Error("Unauthorized"));
  });

  io.on("connection", (socket) => {
    SOCKET_STATS.totalConnections++;
    SOCKET_STATS.connectedAt.set(socket.id, {
      ip: socket.handshake.address,
      ua: socket.handshake.headers["user-agent"] || "",
      ts: Date.now(),
    });
    socket.on("disconnect", () => {
      SOCKET_STATS.connectedAt.delete(socket.id);
      for (const [id, p] of PENDING_RESOLVES.entries()) {
        if (p.socketId === socket.id) {
          clearTimeout(p.timer);
          PENDING_RESOLVES.delete(id);
          p.reject(new Error("Socket disconnected"));
        }
      }
    });
  });

  // ── Background tasks ──────────────────────────────────────
  async function backgroundRefreshTokens() {
    const store = loadTokensStore();
    const deviceUids = Object.keys(store);
    if (deviceUids.length === 0) return;
    log(`[bg-refresh] Checking ${deviceUids.length} devices…`);
    let refreshed = 0, failed = 0, skipped = 0;
    const now = Date.now();
    for (const uid of deviceUids) {
      const latestFlat = loadLatestTokens(uid);
      if (!latestFlat) { skipped++; continue; }
      const refreshToken = latestFlat.refresh_token as string;
      const accessToken = latestFlat.access_token as string;
      if (!refreshToken || !accessToken) { skipped++; continue; }
      const refreshExpiresAt = Number(latestFlat.refresh_expires_at || 0);
      if (refreshExpiresAt <= 0) { skipped++; continue; }
      const daysLeft = (refreshExpiresAt - now) / (24 * 60 * 60 * 1000);
      if (daysLeft > 15 || daysLeft <= 0) { skipped++; continue; }

      try {
        const result = await refreshDeviceTokens(accessToken, refreshToken);
        if (!result) { failed++; continue; }
        const expiresAt = now + result.expires_in;
        let refreshExpiresNew: number | null = null;
        try {
          const payload = JSON.parse(Buffer.from(String(result.refresh_token).split(".")[1], "base64").toString());
          if (payload.exp) refreshExpiresNew = payload.exp * 1000;
        } catch {}
        const arr = store[uid] as Array<Record<string, unknown>> | undefined;
        const last = arr?.length ? arr[arr.length - 1] : null;
        if (last) {
          const t = (last.tokens || last.widevine || last) as Record<string, unknown>;
          t.access_token = result.access_token;
          t.refresh_token = result.refresh_token;
          t.expires_at = expiresAt;
          t.refresh_expires_at = refreshExpiresNew;
          last.captured_at = new Date().toISOString();
        }
        refreshed++;
        log(`[bg-refresh] ${uid.slice(0, 8)}… ✅ refreshed (${Math.round(daysLeft)}d left)`);
      } catch (e) {
        failed++;
        log(`[bg-refresh] ${uid.slice(0, 8)}… ❌ ${(e as Error).message}`);
      }
    }
    log(`[bg-refresh] Done: ${refreshed} refreshed, ${failed} failed, ${skipped} skipped`);
    try { saveTokensStore(store); } catch {}
  }

  async function backgroundRefreshLicenseUrls() {
    const store = loadTokensStore();
    const deviceUids = Object.keys(store);
    if (deviceUids.length === 0) return;
    log(`[bg-license] Updating license URLs for ${deviceUids.length} devices…`);
    let updated = 0, failed = 0;
    for (const uid of deviceUids) {
      const latestFlat = loadLatestTokens(uid);
      if (!latestFlat?.access_token) { failed++; continue; }
      const accessValid = isAccessTokenValid(latestFlat);
      const refreshValid = isRefreshTokenValid(latestFlat);
      if (!accessValid && !refreshValid) { failed++; continue; }
      let accessToken = latestFlat.access_token as string;
      if (!accessValid && refreshValid) {
        const refreshed = await ensureDeviceAccessToken(uid);
        if (refreshed) accessToken = refreshed;
      }
      try {
        const userId = String(latestFlat.user_id || "918558");
        const [liveUrl, vodUrl] = await Promise.all([
          fetchWvLicenseProxyUrlLive(accessToken, userId),
          fetchWvLicenseProxyUrlVod(accessToken, "23145", userId),
        ]);
        const arr = store[uid] as Array<Record<string, unknown>> | undefined;
        const last = arr?.length ? arr[arr.length - 1] : null;
        if (last) {
          const t = (last.tokens || last.widevine || last) as Record<string, unknown>;
          if (liveUrl) { t.wv_license_proxy_url_live = liveUrl; t.fp_license_proxy_url_live = liveUrl.replace("/wv/license", "/fp/license"); }
          if (vodUrl) { t.wv_license_proxy_url_vod = vodUrl; t.fp_license_proxy_url_vod = vodUrl.replace("/wv/license", "/fp/license"); }
          t.fp_certificate_url = FP_CERT_URL;
        }
        updated++;
        log(`[bg-license] ${uid.slice(0, 8)}… ✅ updated`);
      } catch (e) {
        failed++;
        log(`[bg-license] ${uid.slice(0, 8)}… ❌ ${(e as Error).message}`);
      }
    }
    log(`[bg-license] Done: ${updated} updated, ${failed} failed`);
    try { saveTokensStore(store); } catch {}
  }

  function scheduleNextTokenRefresh() {
    const now = new Date();
    const next = new Date(now);
    next.setDate(next.getDate() + 1);
    next.setHours(Math.floor(Math.random() * 24), Math.floor(Math.random() * 60), 0, 0);
    const delay = next.getTime() - now.getTime();
    log(`[bg-refresh] Next token check at ${next.toISOString()}`);
    setTimeout(async () => {
      try { await backgroundRefreshTokens(); } catch {}
      scheduleNextTokenRefresh();
    }, delay);
  }
  scheduleNextTokenRefresh();

  function scheduleNextLicenseUrlRefresh() {
    const now = new Date();
    const next = new Date(now);
    next.setDate(next.getDate() + 10);
    next.setHours(Math.floor(Math.random() * 24), Math.floor(Math.random() * 60), 0, 0);
    const delay = next.getTime() - now.getTime();
    log(`[bg-license] Next license URL refresh at ${next.toISOString()}`);
    setTimeout(async () => {
      try { await backgroundRefreshLicenseUrls(); } catch {}
      scheduleNextLicenseUrlRefresh();
    }, delay);
  }
  scheduleNextLicenseUrlRefresh();

  // Start intervals
  if (AUTO_REFRESH_MINUTES > 0) setInterval(runAutoRefresh, AUTO_REFRESH_MINUTES * 60 * 1000);
  if (EPG_REFRESH_MINUTES > 0)
    setInterval(async () => {
      try { await refreshEpgFile(); } catch {}
    }, EPG_REFRESH_MINUTES * 60 * 1000);
  setInterval(cleanupPsshCache, 3600 * 1000);
  cleanupPsshCache();

  // ── Boot: listen FIRST, then hydrate + fetch data ────────
  // 1) Start listening immediately so healthcheck passes
  server.listen(PORT, "0.0.0.0", () => {
    console.log("");
    console.log("  ┌───────────────────────────────────────────────────────────┐");
    console.log("  │   LankaTV Next.js — SECURE + HARDENED DRM                │");
    console.log("  ├───────────────────────────────────────────────────────────┤");
    console.log(`  │  Listening:        http://localhost:${String(PORT).padEnd(22)}│`);
    console.log(`  │  Legacy streams:   ${String(ALLOW_LEGACY_STREAMS).padEnd(39)}│`);
    console.log(`  │  Stream TTL:       ${String(STREAM_TOKEN_TTL_MS + "ms").padEnd(39)}│`);
    console.log(`  │  DRM TTL:          ${String(DRM_LICENSE_TTL_MS + "ms").padEnd(39)}│`);
    console.log(`  │  Admin:            http://localhost:${PORT}/admin`.padEnd(60) + "│");
    console.log("  └───────────────────────────────────────────────────────────┘");
    console.log("");
  });

  // 2) Connect MongoDB + hydrate in-memory cache (async, non-blocking)
  try {
    await connectMongo();
    await initFromMongo();
    log("[boot] MongoDB hydrated");
  } catch (e) {
    log("[boot] MongoDB connection failed — using file fallback:", (e as Error).message);
  }

  loadTokens();

  // 3) Fetch missing data in background (after server is listening)
  (async () => {
    const needChannels = !loadChannels();
    const needCats = !loadCategoriesIndex();
    const needEpg = !fs.existsSync(EPG_XML_FILE);
    if (needChannels || needCats) {
      log("[boot] Missing data — fetching…");
      try { await runAutoRefresh(); } catch (e) { log("[boot] failed:", (e as Error).message); }
    } else if (needEpg) {
      log("[boot] EPG missing — building…");
      try { await refreshEpgFile(); } catch (e) { log("[boot] failed:", (e as Error).message); }
    } else {
      log("[boot] All data files present");
    }

    const n = indexAllEpisodesFromDisk();
    log(`[boot] Indexed ${n} episodes from disk`);

    // Run background tasks once at boot
    setTimeout(() => { backgroundRefreshTokens().catch(() => {}); }, 60000);
    setTimeout(() => { backgroundRefreshLicenseUrls().catch(() => {}); }, 90000);
  })();
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});

// Graceful shutdown — close MongoDB connection
process.on("SIGINT", async () => {
  log("Shutting down…");
  await closeMongo();
  process.exit(0);
});
process.on("SIGTERM", async () => {
  log("Shutting down…");
  await closeMongo();
  process.exit(0);
});
