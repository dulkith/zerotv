/**
 * Data Access Layer — MongoDB + in-memory cache
 * All getters are SYNC (read from memory).
 * All setters are SYNC (update memory + async-flush to MongoDB).
 * Startup: call initFromMongo() to hydrate memory from MongoDB.
 * EPG stays file-based (too large for MongoDB reads).
 */
import fs from "fs";
import path from "path";
import { col, connectMongo, getDb } from "./mongo";

// ================================================================
// FILE PATHS (EPG + legacy fallback)
// ================================================================
const DATA_DIR = path.join(process.cwd(), "data");
const CATEGORIES_DIR = path.join(DATA_DIR, "categories");
const EPG_JSON_FILE = path.join(DATA_DIR, "epg.json");
const TOKENS_FILE = path.join(process.cwd(), "tokens.json");
const DRM_TOKENS_FILE = path.join(process.cwd(), "..", "tokens.json");
const PSSH_CACHE_FILE = path.join(DATA_DIR, "pssh-cache.json");

// ================================================================
// IN-MEMORY STORE
// ================================================================
let _channels: Record<string, unknown> | null = null;
let _categoriesIndex: any = null;
let _categoryFiles = new Map<number, any>();
let _epgJson: any = null;
let _uidMap: { forward: Record<string, { type: string; realId: string }>; reverse: Record<string, string> } = { forward: {}, reverse: {} };
let _tvLicense: string | null = null;
let _movieLicense: string | null = null;
let _tokensFile: Record<string, unknown> = {};
let _tokensStore: Record<string, unknown[]> = {};
let _devices = new Map<string, Record<string, unknown>>();

const SHORT_TTL = 15_000;
const LONG_TTL = 300_000;
let _channelsTs = 0;
let _catIdxTs = 0;
let _catFileTs = new Map<number, number>();
let _epgTs = 0;
let _tokensStoreTs = 0;
let _tvLicenseTs = 0;
let _movieLicenseTs = 0;
let _tokensFileTs = 0;

// ================================================================
// MONGODB COLLECTION NAMES
// ================================================================
const C_CONFIG = "config";
const C_CHANNELS = "channels";
const C_CATEGORIES_IDX = "categories_index";
const C_CATEGORIES = "categories";
const C_UID_MAP = "uid_map";
const C_DEVICES = "devices";
const C_TOKENS = "tokens";

// ================================================================
// ASYNC MONGODB HELPERS
// ================================================================
async function mongoWrite(colName: string, filter: Record<string, unknown>, data: Record<string, unknown>) {
  try {
    const { _id, ...rest } = data as any;
    await col(colName).updateOne(filter, { $set: rest }, { upsert: true });
  } catch (e) { console.error(`[mongo] write error ${colName}:`, e); }
}

async function mongoRead(colName: string, filter: Record<string, unknown>): Promise<any | null> {
  try {
    return await col(colName).findOne(filter);
  } catch { return null; }
}

async function mongoDelete(colName: string, filter: Record<string, unknown>) {
  try {
    await col(colName).deleteOne(filter);
  } catch (e) { console.error(`[mongo] delete error ${colName}:`, e); }
}

// ================================================================
// INIT FROM MONGODB — call at startup
// ================================================================
export async function initFromMongo(): Promise<void> {
  console.log("[data] Hydrating from MongoDB...");

  // Channels
  try {
    const doc = await mongoRead(C_CHANNELS, { _id: "main" });
    if (doc?.data) _channels = doc.data;
  } catch {}
  console.log(`[data]   channels: ${_channels ? "loaded" : "null"}`);

  // Categories index
  try {
    const doc = await mongoRead(C_CATEGORIES_IDX, { _id: "index" });
    if (doc) { const { _id, ...rest } = doc; _categoriesIndex = rest; }
  } catch {}
  console.log(`[data]   categories_index: ${_categoriesIndex?.data?.length ?? 0} categories`);

  // Categories content
  try {
    const docs = await col(C_CATEGORIES).find().toArray();
    for (const doc of docs) {
      const id = Number(doc._id);
      const { _id, ...rest } = doc;
      _categoryFiles.set(id, rest);
    }
  } catch {}
  console.log(`[data]   categories: ${_categoryFiles.size} files`);

  // UID Map
  try {
    const doc = await mongoRead(C_UID_MAP, { _id: "map" });
    if (doc?.forward && doc?.reverse) {
      _uidMap = { forward: doc.forward, reverse: doc.reverse };
    }
  } catch {}
  console.log(`[data]   uid_map: ${Object.keys(_uidMap.forward).length} entries`);

  // Config — DRM license URLs
  try {
    const doc = await mongoRead(C_CONFIG, { _id: "drm" });
    if (doc) {
      _tvLicense = doc.tv_wv_license_proxy_url || null;
      _movieLicense = doc.movies_wv_license_proxy_url || null;
    }
  } catch {}
  console.log(`[data]   config: tv=${!!_tvLicense} movie=${!!_movieLicense}`);

  // Config — tokens file
  try {
    const doc = await mongoRead(C_CONFIG, { _id: "tokens" });
    if (doc) { const { _id, ...rest } = doc; _tokensFile = rest; }
  } catch {}

  // Devices
  try {
    const docs = await col(C_DEVICES).find().toArray();
    let activeCount = 0;
    let deletedCount = 0;
    for (const doc of docs) {
      const { _id, ...rest } = doc;
      if (rest._deleted) { deletedCount++; continue; }
      _devices.set(String(_id), rest);
      activeCount++;
    }
    console.log(`[data]   devices: ${activeCount} active, ${deletedCount} deleted`);
  } catch {}

  // Tokens store
  try {
    const docs = await col(C_TOKENS).find().toArray();
    for (const doc of docs) {
      const { _id, ...rest } = doc;
      _tokensStore[String(_id)] = [rest];
    }
  } catch {}
  console.log(`[data]   tokens_store: ${Object.keys(_tokensStore).length}`);

  // EPG — file-based only
  _epgTs = 0; // force re-read from file
  console.log(`[data]   epg: ${loadEpgJson() ? "loaded from file" : "not found"}`);

  console.log("[data] MongoDB hydration complete");
}

// ================================================================
// CHANNELS (sync getter, async flush)
// ================================================================
export function loadChannels(): Record<string, unknown> | null {
  return _channels;
}

export async function loadChannelsFresh(): Promise<Record<string, unknown> | null> {
  await _refreshChannels();
  return _channels;
}

// Called from server.ts — keeps the same sync signature
export { loadChannels as _loadChannelsSync };

async function _refreshChannels() {
  try {
    const doc = await mongoRead(C_CHANNELS, { _id: "main" });
    if (doc?.data) { _channels = doc.data; _channelsTs = Date.now(); }
  } catch {}
}

export function saveChannelsSync(data: Record<string, unknown>) {
  _channels = data;
  _channelsTs = Date.now();
  // Async flush to MongoDB
  mongoWrite(C_CHANNELS, { _id: "main" } as any, { _id: "main", data } as any);
}

// ================================================================
// CATEGORIES INDEX
// ================================================================
export function loadCategoriesIndex(): typeof _categoriesIndex {
  return _categoriesIndex;
}

export async function loadCategoriesIndexFresh(): Promise<typeof _categoriesIndex> {
  try {
    const doc = await mongoRead(C_CATEGORIES_IDX, { _id: "index" });
    if (doc) { const { _id, ...rest } = doc; _categoriesIndex = rest; _catIdxTs = Date.now(); }
  } catch {}
  return _categoriesIndex;
}

export function saveCategoriesIndexSync(data: any) {
  _categoriesIndex = data;
  _catIdxTs = Date.now();
  mongoWrite(C_CATEGORIES_IDX, { _id: "index" } as any, { _id: "index", ...data } as any);
}

// ================================================================
// CATEGORY FILE
// ================================================================
export function loadCategoryFile(id: number): any | null {
  return _categoryFiles.get(id) || null;
}

export function saveCategoryFileSync(id: number, data: any) {
  _categoryFiles.set(id, data);
  _catFileTs.set(id, Date.now());
  mongoWrite(C_CATEGORIES, { _id: id } as any, { _id: id, ...data } as any);
}

// ================================================================
// EPG — FILE-BASED (fast reads, too large for MongoDB)
// ================================================================
function _loadEpgFromFile(): any {
  try {
    if (!fs.existsSync(EPG_JSON_FILE)) return null;
    const stat = fs.statSync(EPG_JSON_FILE);
    if (stat.mtimeMs === _epgTs) return _epgJson;
    _epgJson = JSON.parse(fs.readFileSync(EPG_JSON_FILE, "utf8"));
    _epgTs = stat.mtimeMs;
    return _epgJson;
  } catch { return null; }
}

export function loadEpgJson(): any {
  return _loadEpgFromFile();
}

export function loadEpgJsonFresh(): any {
  _epgTs = 0;
  return _loadEpgFromFile();
}

// ================================================================
// UID MAP
// ================================================================
export function loadUidMap(): typeof _uidMap {
  return _uidMap;
}

export function saveUidMap(map: typeof _uidMap) {
  _uidMap = map;
  mongoWrite(C_UID_MAP, { _id: "map" } as any, { _id: "map", forward: map.forward, reverse: map.reverse } as any);
}

// ================================================================
// TOKENS FILE (DRM license URLs + Viu API tokens)
// ================================================================
export function loadTokensFile(): Record<string, unknown> {
  if (_tvLicense || _movieLicense) {
    return {
      access: _tokensFile.access || "",
      refresh: _tokensFile.refresh || "",
      tv_wv_license_proxy_url: _tvLicense,
      movies_wv_license_proxy_url: _movieLicense,
      ..._tokensFile,
    };
  }
  return _tokensFile;
}

export function saveTokensFile(data: Record<string, unknown>) {
  _tokensFile = data;
  _tokensFileTs = Date.now();
  if (data.tv_wv_license_proxy_url !== undefined) _tvLicense = data.tv_wv_license_proxy_url as string;
  if (data.movies_wv_license_proxy_url !== undefined) _movieLicense = data.movies_wv_license_proxy_url as string;
  mongoWrite(C_CONFIG, { _id: "tokens" } as any, { _id: "tokens", ...data } as any);
}

export function getTvLicenseUrl(): string | null {
  return _tvLicense;
}

export function getMoviesLicenseUrl(): string | null {
  return _movieLicense;
}

// ================================================================
// DEVICES
// ================================================================
export function loadDevice(uuid: string): Record<string, unknown> | null {
  return _devices.get(uuid) || null;
}

export function saveDevice(device: Record<string, unknown>) {
  const uuid = String(device.deviceUid || device._id);
  _devices.set(uuid, device);
  mongoWrite(C_DEVICES, { _id: uuid } as any, { _id: uuid, ...device } as any);
}

export function getAllDevices(): Record<string, unknown>[] {
  return [..._devices.entries()].map(([id, data]) => ({ ...data, _id: id }));
}

export function deleteDevice(uuid: string) {
  const dev = _devices.get(uuid);
  if (dev) {
    dev._deleted = true;
    dev._deletedAt = new Date().toISOString();
    mongoWrite(C_DEVICES, { _id: uuid } as any, { _id: uuid, ...dev } as any);
  }
  _devices.delete(uuid);
}

// ================================================================
// TOKENS STORE (per-device Viu auth)
// ================================================================
export function loadTokensStore(): Record<string, unknown[]> {
  return _tokensStore;
}

export function saveTokensStore(store: Record<string, unknown[]>) {
  _tokensStore = store;
  _tokensStoreTs = Date.now();
  // Async flush each device token
  for (const [key, val] of Object.entries(store)) {
    if (val && val.length > 0) {
      const entry = val[val.length - 1] as any;
      mongoWrite(C_TOKENS, { _id: key } as any, { _id: key, ...entry } as any);
    }
  }
}

export function getAllTokens(): Array<Record<string, unknown>> {
  return Object.entries(_tokensStore).map(([deviceUid, entries]) => {
    const last = entries && entries.length > 0 ? entries[entries.length - 1] as Record<string, unknown> : {};
    return { ...last, deviceUid };
  });
}

export function deleteToken(deviceUid: string) {
  delete _tokensStore[deviceUid];
  mongoDelete(C_TOKENS, { _id: deviceUid });
}

// ================================================================
// CACHE SIZE HELPERS (for admin dashboard)
// ================================================================
export function getCacheSizes() {
  return {
    channels: _channels ? 1 : 0,
    categoriesIndex: _categoriesIndex?.data?.length ?? 0,
    categoryFiles: _categoryFiles.size,
    epgPrograms: _epgJson?.programs?.length ?? 0,
    devices: _devices.size,
    tokens: Object.keys(_tokensStore).length,
    uidMap: Object.keys(_uidMap.forward).length,
  };
}

// ================================================================
// BULK IMPORT — used by refresh
// ================================================================
export function importChannels(data: Record<string, unknown>) { saveChannelsSync(data); }
export function importCategoriesIndex(data: any) { saveCategoriesIndexSync(data); }
export function importCategoryFile(id: number, data: any) { saveCategoryFileSync(id, data); }

// ================================================================
// RELOAD — called after imports to refresh in-memory cache from MongoDB
// ================================================================
export async function reloadFromMongo(): Promise<void> {
  try {
    const doc = await mongoRead(C_CHANNELS, { _id: "main" });
    if (doc?.data) _channels = doc.data;
  } catch {}
  try {
    const doc = await mongoRead(C_CATEGORIES_IDX, { _id: "index" });
    if (doc) { const { _id, ...rest } = doc; _categoriesIndex = rest; }
  } catch {}
  try {
    _categoryFiles.clear();
    const docs = await col(C_CATEGORIES).find().toArray();
    for (const doc of docs) {
      const id = Number(doc._id);
      const { _id, ...rest } = doc;
      _categoryFiles.set(id, rest);
    }
  } catch {}
  try {
    const doc = await mongoRead(C_CONFIG, { _id: "tokens" });
    if (doc) { const { _id, ...rest } = doc; _tokensFile = rest; }
  } catch {}
  try {
    _tvLicense = null; _movieLicense = null;
    const doc = await mongoRead(C_CONFIG, { _id: "drm" });
    if (doc) { _tvLicense = doc.tv_wv_license_proxy_url || null; _movieLicense = doc.movies_wv_license_proxy_url || null; }
  } catch {}
  try {
    _devices.clear();
    const docs = await col(C_DEVICES).find({ _deleted: { $ne: true } }).toArray();
    for (const doc of docs) { const { _id, ...rest } = doc; _devices.set(String(_id), rest); }
  } catch {}
  try {
    _tokensStore = {};
    const docs = await col(C_TOKENS).find().toArray();
    for (const doc of docs) { const { _id, ...rest } = doc; _tokensStore[String(_id)] = [rest]; }
  } catch {}
}
