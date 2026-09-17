import crypto from "crypto";

function deriveKey(secret: string): Buffer {
  return crypto.createHash("sha256").update(String(secret)).digest();
}

// Lazy-loaded keys — read process.env after dotenv.config() has run
let _streamKey: Buffer | null = null;
let _drmKey: Buffer | null = null;
let _adminSessionSecret = "";
let _jwtSecret = "";

function getStreamKey(): Buffer { return (_streamKey ??= deriveKey(process.env.STREAM_ENCRYPTION_KEY || "")); }
function getDrmKey(): Buffer { return (_drmKey ??= deriveKey(process.env.DRM_SIGNING_KEY || ":drm")); }
function getAdminSessionSecret(): string { return _adminSessionSecret || (_adminSessionSecret = process.env.ADMIN_SESSION_SECRET || ""); }
function getJwtSecret(): string { return _jwtSecret || (_jwtSecret = process.env.JWT_SECRET || ""); }

// ---- Stream Token Encryption (AES-256-GCM) ----
export function encryptStreamPath(pathStr: string, ttlMs: number): string {
  const payload = JSON.stringify({
    p: pathStr,
    exp: Date.now() + ttlMs,
    n: crypto.randomBytes(8).toString("hex"),
  });
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getStreamKey(), iv);
  const enc = Buffer.concat([
    cipher.update(payload, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64url");
}

export function decryptStreamPath(token: string): string {
  const buf = Buffer.from(token, "base64url");
  if (buf.length < 28) throw new Error("malformed token");
  const iv = buf.slice(0, 12);
  const tag = buf.slice(12, 28);
  const enc = buf.slice(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", getStreamKey(), iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
  const payload = JSON.parse(dec.toString("utf8"));
  if (payload.exp < Date.now()) throw new Error("token expired");
  return payload.p;
}

// ---- Admin Session (HMAC) ----
export function createAdminSession(): string {
  const exp = Date.now() + 4 * 3600 * 1000;
  const data = `admin:${exp}`;
  const sig = crypto
    .createHmac("sha256", getAdminSessionSecret())
    .update(data)
    .digest("hex");
  return Buffer.from(`${data}:${sig}`).toString("base64url");
}

export function verifyAdminSession(token: string): boolean {
  try {
    const raw = Buffer.from(token, "base64url").toString("utf8");
    const parts = raw.split(":");
    if (parts.length !== 3) return false;
    const [role, expStr, sig] = parts;
    const exp = parseInt(expStr, 10);
    if (role !== "admin" || !isFinite(exp) || exp < Date.now()) return false;
    const expected = crypto
      .createHmac("sha256", getAdminSessionSecret())
      .update(`admin:${expStr}`)
      .digest("hex");
    const a = Buffer.from(sig, "hex");
    const b = Buffer.from(expected, "hex");
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// ---- DRM Token (HMAC-Signed) ----
export function signDrmToken(kind: string, ttlMs: number, deviceUid?: string): string {
  const exp = Date.now() + ttlMs;
  const nonce = crypto.randomBytes(10).toString("hex");
  const payload = `drm:${kind}:${deviceUid || ""}:${exp}:${nonce}`;
  const sig = crypto
    .createHmac("sha256", getDrmKey())
    .update(payload)
    .digest("hex");
  return Buffer.from(`${payload}:${sig}`).toString("base64url");
}

export function verifyDrmToken(token: string): { kind: string; deviceUid?: string } | null {
  try {
    const raw = Buffer.from(token, "base64url").toString("utf8");
    const parts = raw.split(":");
    if (parts.length !== 6) return null;
    const [prefix, kind, deviceUid, expStr, nonce, sig] = parts;
    if (prefix !== "drm") return null;
    const exp = parseInt(expStr, 10);
    if (!isFinite(exp) || exp < Date.now()) return null;
    const expected = crypto
      .createHmac("sha256", getDrmKey())
      .update(`drm:${kind}:${deviceUid}:${expStr}:${nonce}`)
      .digest("hex");
    const a = Buffer.from(sig, "hex");
    const b = Buffer.from(expected, "hex");
    if (a.length !== b.length) return null;
    if (!crypto.timingSafeEqual(a, b)) return null;
    return { kind, deviceUid: deviceUid || undefined };
  } catch {
    return null;
  }
}

// ---- JWT Session (for browser auth) ----
export interface SessionData {
  deviceUid: string;
  mobileNumber: string | null;
  signedIn: boolean;
}

function base64urlEncode(data: string): string {
  return Buffer.from(data)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64urlDecode(data: string): string {
  let base64 = data.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4) base64 += "=";
  return Buffer.from(base64, "base64").toString("utf8");
}

export function createSessionToken(data: SessionData): string {
  const header = base64urlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const now = Math.floor(Date.now() / 1000);
  const payload = base64urlEncode(
    JSON.stringify({ ...data, iat: now, exp: now + 30 * 24 * 3600 })
  );
  const sigInput = `${header}.${payload}`;
  const sig = crypto
    .createHmac("sha256", getJwtSecret())
    .update(sigInput)
    .digest("base64url");
  return `${sigInput}.${sig}`;
}

export function verifySessionToken(token: string): SessionData | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [header, payload, sig] = parts;
    const sigInput = `${header}.${payload}`;
    const expected = crypto
      .createHmac("sha256", getJwtSecret())
      .update(sigInput)
      .digest("base64url");
    const a = Buffer.from(sig, "base64url");
    const b = Buffer.from(expected, "base64url");
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const data = JSON.parse(base64urlDecode(payload));
    if (!data.exp || data.exp < Math.floor(Date.now() / 1000)) return null;
    return { deviceUid: data.deviceUid, mobileNumber: data.mobileNumber, signedIn: data.signedIn };
  } catch {
    return null;
  }
}

export function parseSessionPayload(token: string): SessionData | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [header, payload, sig] = parts;
    const sigInput = `${header}.${payload}`;
    const expected = crypto
      .createHmac("sha256", getJwtSecret())
      .update(sigInput)
      .digest("base64url");
    const a = Buffer.from(sig, "base64url");
    const b = Buffer.from(expected, "base64url");
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const data = JSON.parse(base64urlDecode(payload));
    if (!data.signedIn || !data.deviceUid) return null;
    return { deviceUid: data.deviceUid, mobileNumber: data.mobileNumber, signedIn: data.signedIn };
  } catch {
    return null;
  }
}

// ---- UID Mapping (opaque IDs) ----
const UID_SECRET = (process.env.STREAM_ENCRYPTION_KEY || "") + ":uid";

export function makeUid(type: string, realId: string | number): string {
  const key = `${type}:${realId}`;
  const h = crypto.createHmac("sha256", UID_SECRET).update(key).digest();
  return h.slice(0, 12).toString("base64url");
}

// ---- Mobile Helpers ----
export function normalizeMobile(input: string): { ok: boolean; number?: string; error?: string } {
  if (!input) return { ok: false, error: "Missing mobile number" };
  let n = String(input).replace(/[\s\-()+]/g, "");
  if (n.startsWith("94") && n.length >= 11) n = n.slice(2);
  if (n.startsWith("0") && n.length === 10) n = n.slice(1);
  if (!/^\d{9}$/.test(n)) return { ok: false, error: "Enter a valid 9-digit number" };
  if (!/^77\d{7}$/.test(n)) return { ok: false, error: "Only 077/77 numbers are accepted" };
  return { ok: true, number: n };
}

export function maskMobile(mobile: string | null): string | null {
  if (!mobile || mobile.length < 4) return null;
  return "*****" + mobile.slice(-4);
}

// ---- Timing-safe password check ----
export function timingSafePassword(input: string, expected: string): boolean {
  const a = Buffer.from(input);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
