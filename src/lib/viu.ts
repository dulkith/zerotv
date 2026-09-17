import https from "https";
import http from "http";
import { VIU_ORIGIN, VIU_REFERER, USER_AGENT, DIRECT_API, IMG_ACCESS_KEY } from "./constants";

const httpsAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 30000,
  maxSockets: 20,
  maxFreeSockets: 10,
  timeout: 60000,
  scheduling: "fifo",
});

export function buildViuHeaders(token: string): Record<string, string> {
  return {
    accept: "application/json, text/plain, */*",
    "accept-language": "en-GB,en;q=0.6",
    authorization: `Bearer ${token}`,
    "cache-control": "no-cache",
    origin: VIU_ORIGIN,
    pragma: "no-cache",
    referer: VIU_REFERER,
    "user-agent": USER_AGENT,
    "sec-ch-ua": '"Not=A?Brand";v="99", "Brave";v="151", "Chromium";v="151"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"macOS"',
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-site",
    "sec-gpc": "1",
  };
}

export function httpsRequest({
  method,
  hostname,
  path,
  headers,
  body,
}: {
  method: string;
  hostname: string;
  path: string;
  headers: Record<string, string>;
  body?: string;
}): Promise<{ statusCode: number; headers: Record<string, string>; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      { method, hostname, path, headers, agent: httpsAgent },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () =>
          resolve({
            statusCode: res.statusCode || 0,
            headers: res.headers as Record<string, string>,
            body: Buffer.concat(chunks),
          })
        );
      }
    );
    req.on("error", reject);
    req.setTimeout(20000, () => req.destroy(new Error("Timeout")));
    if (body) req.write(typeof body === "string" ? body : JSON.stringify(body));
    req.end();
  });
}

// ── Device Management ─────────────────────────────────────────

/**
 * Start a registration session. Returns a registration JWT (sub:"registration")
 * containing a trace_id, used for subsequent registration calls.
 */
export async function startRegistration(): Promise<{ status: number; data: Record<string, unknown> }> {
  const headers: Record<string, string> = {
    accept: "application/json, text/plain, */*",
    "content-type": "application/json",
    origin: "https://registration.viu.lk",
    referer: "https://registration.viu.lk/",
    "user-agent": USER_AGENT,
  };
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        method: "POST",
        hostname: "api.viu.lk",
        path: `/api/client/v1/global/registration/start?accessKey=${encodeURIComponent(IMG_ACCESS_KEY)}`,
        headers,
        agent: httpsAgent,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode || 0, data: JSON.parse(Buffer.concat(chunks).toString("utf8")) });
          } catch {
            resolve({ status: res.statusCode || 0, data: {} });
          }
        });
      }
    );
    req.on("error", reject);
    req.setTimeout(15000, () => req.destroy(new Error("Timeout")));
    req.write(JSON.stringify({}));
    req.end();
  });
}

/**
 * Register a device using a registration JWT (from startRegistration).
 * POST /api/client/v2/viu/registration/register
 */
export async function registerDeviceV2(registrationToken: string, params: {
  mobileNumber: string;
  deviceUid: string;
  deviceClass?: string;
  deviceType?: string;
  deviceOS?: string;
  traceId: string;
}): Promise<{ status: number; data: Record<string, unknown> }> {
  const headers: Record<string, string> = {
    accept: "application/json, text/plain, */*",
    "content-type": "application/json",
    authorization: `Bearer ${registrationToken}`,
    origin: "https://registration.viu.lk",
    referer: "https://registration.viu.lk/",
    "user-agent": USER_AGENT,
  };
  const body = {
    mobile_number: params.mobileNumber,
    trace_id: params.traceId,
    device_type: params.deviceType || "SMART_TV",
    device_class: params.deviceClass || "SMART_TV",
    device_os: params.deviceOS || "WEBOS",
    device: params.deviceUid,
    reg_action: "EXISTING",
    otp_mobile_number: params.mobileNumber,
  };
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        method: "POST",
        hostname: "api.viu.lk",
        path: `/api/client/v2/viu/registration/register`,
        headers,
        agent: httpsAgent,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode || 0, data: JSON.parse(Buffer.concat(chunks).toString("utf8")) });
          } catch {
            resolve({ status: res.statusCode || 0, data: {} });
          }
        });
      }
    );
    req.on("error", reject);
    req.setTimeout(15000, () => req.destroy(new Error("Timeout")));
    req.write(JSON.stringify(body));
    req.end();
  });
}

export async function listViuDevices(accessToken: string, userId: number | string): Promise<{ status: number; data: Array<Record<string, unknown>> }> {
  const headers: Record<string, string> = {
    accept: "application/json, text/plain, */*",
    "accept-language": "en-GB,en;q=0.9",
    authorization: `Bearer ${accessToken}`,
    origin: "https://smarttv.viu.lk",
    referer: "https://smarttv.viu.lk/",
    "user-agent": USER_AGENT,
  };
  return new Promise((resolve, reject) => {
    const req = https.request(
      { method: "GET", hostname: "api1.viu.lk", path: `/api/client/v1/default/users/${userId}/devices`, headers, agent: httpsAgent },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          try {
            const j = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            resolve({ status: res.statusCode || 0, data: j.data || [] });
          } catch {
            resolve({ status: res.statusCode || 0, data: [] });
          }
        });
      }
    );
    req.on("error", reject);
    req.setTimeout(15000, () => req.destroy(new Error("Timeout")));
    req.end();
  });
}

export async function registerViuDevice(accessToken: string, userId: number | string, device: {
  deviceUid: string;
  deviceClass?: string;
  deviceType?: string;
  deviceOS?: string;
}): Promise<{ status: number; data: Record<string, unknown> }> {
  const headers: Record<string, string> = {
    accept: "application/json, text/plain, */*",
    "accept-language": "en-GB,en;q=0.9",
    "content-type": "application/json",
    authorization: `Bearer ${accessToken}`,
    origin: "https://smarttv.viu.lk",
    referer: "https://smarttv.viu.lk/",
    "user-agent": USER_AGENT,
  };
  const body = {
    uid: device.deviceUid,
    device_class: device.deviceClass || "SMART_TV",
    device_type: { uid: device.deviceType || "LG SmartTV" },
    os: device.deviceOS || "WEBOS",
  };
  return new Promise((resolve, reject) => {
    const req = https.request(
      { method: "POST", hostname: "api1.viu.lk", path: `/api/client/v1/default/users/${userId}/devices`, headers, agent: httpsAgent },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode || 0, data: JSON.parse(Buffer.concat(chunks).toString("utf8")) });
          } catch {
            resolve({ status: res.statusCode || 0, data: {} });
          }
        });
      }
    );
    req.on("error", reject);
    req.setTimeout(15000, () => req.destroy(new Error("Timeout")));
    req.write(JSON.stringify(body));
    req.end();
  });
}

export async function deleteViuDevice(accessToken: string, userId: number | string, deviceId: number | string): Promise<{ status: number; data: Record<string, unknown> }> {
  const headers: Record<string, string> = {
    accept: "application/json, text/plain, */*",
    "accept-language": "en-GB,en;q=0.9",
    authorization: `Bearer ${accessToken}`,
    origin: "https://smarttv.viu.lk",
    referer: "https://smarttv.viu.lk/",
    "user-agent": USER_AGENT,
  };
  return new Promise((resolve, reject) => {
    const req = https.request(
      { method: "DELETE", hostname: "api1.viu.lk", path: `/api/client/v1/default/users/${userId}/devices/${deviceId}`, headers, agent: httpsAgent },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode || 0, data: JSON.parse(Buffer.concat(chunks).toString("utf8")) });
          } catch {
            resolve({ status: res.statusCode || 0, data: {} });
          }
        });
      }
    );
    req.on("error", reject);
    req.setTimeout(15000, () => req.destroy(new Error("Timeout")));
    req.end();
  });
}

export function httpsRequestFollow({
  method,
  hostname,
  path,
  headers,
  body,
  maxRedirects = 5,
  collectBody = true,
}: {
  method: string;
  hostname: string;
  path: string;
  headers: Record<string, string>;
  body?: string;
  maxRedirects?: number;
  collectBody?: boolean;
}): Promise<{
  statusCode: number;
  headers: Record<string, string>;
  body?: Buffer;
  stream?: http.IncomingMessage;
  url?: string;
}> {
  return new Promise((resolve, reject) => {
    const doReq = (host: string, p: string, hops: number) => {
      const req = https.request(
        { method, hostname: host, path: p, headers, agent: httpsAgent },
        (res) => {
          if (
            [301, 302, 303, 307, 308].includes(res.statusCode || 0) &&
            res.headers.location &&
            hops > 0
          ) {
            try {
              const u = new URL(res.headers.location);
              res.resume();
              return doReq(u.hostname, u.pathname + u.search, hops - 1);
            } catch (e) {
              return reject(e);
            }
          }
          if (!collectBody) {
            return resolve({
              statusCode: res.statusCode || 0,
              headers: res.headers as Record<string, string>,
              stream: res,
              url: `https://${host}${p}`,
            });
          }
          const chunks: Buffer[] = [];
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("end", () =>
            resolve({
              statusCode: res.statusCode || 0,
              headers: res.headers as Record<string, string>,
              body: Buffer.concat(chunks),
              url: `https://${host}${p}`,
            })
          );
        }
      );
      req.on("error", reject);
      req.setTimeout(30000, () => req.destroy(new Error("Timeout")));
      if (body) req.write(body);
      req.end();
    };
    doReq(hostname, path, maxRedirects);
  });
}

export function imgUrl(id: number | null): string {
  return !id ? "" : `/api/img/${id}`;
}

export function applyCdn(url: string): string {
  const CDN_MAP: Record<string, string> = {
    bpcdncs1: "bpcdncs5",
    bpcdncs2: "bpcdncs6",
    bpcdncs3: "bpcdncs7",
    bpcdncs4: "bpcdncs8",
  };
  let r = url;
  for (const [oldH, newH] of Object.entries(CDN_MAP)) {
    if (r.includes(oldH)) r = r.replace(oldH, newH);
  }
  return r;
}

export function extractChannelId(cm: string | null): string | null {
  if (!cm) return null;
  const s = String(cm).trim();
  if (!s) return null;
  const d = s.lastIndexOf("-");
  return d !== -1 && d < s.length - 1 ? s.slice(d + 1).trim() : s;
}

export async function fetchWvLicenseProxyUrlLive(accessToken: string, userId: string = "918558"): Promise<string | null> {
  try {
    const headers: Record<string, string> = {
      accept: "application/json, text/plain, */*",
      authorization: `Bearer ${accessToken}`,
      origin: "https://smarttv.viu.lk",
      referer: "https://smarttv.viu.lk/",
      "user-agent": USER_AGENT,
    };
    const up = await httpsRequest({
      method: "GET",
      hostname: "api2.viu.lk",
      path: `/api/client/v1/default/users/${userId}/live/channels/channelone?translation=en`,
      headers,
    });
    if (up.statusCode !== 200) return null;
    const j = JSON.parse(up.body.toString("utf8"));
    return j.data?.wv_license_proxy_url || null;
  } catch {
    return null;
  }
}

export async function fetchWvLicenseProxyUrlVod(accessToken: string, contentId: string = "23145", userId: string = "918558"): Promise<string | null> {
  try {
    const headers: Record<string, string> = {
      accept: "application/json, text/plain, */*",
      authorization: `Bearer ${accessToken}`,
      origin: "https://smarttv.viu.lk",
      referer: "https://smarttv.viu.lk/",
      "user-agent": USER_AGENT,
    };
    const up = await httpsRequest({
      method: "GET",
      hostname: "api2.viu.lk",
      path: `/api/client/v1/default/users/${userId}/vod/trailers/movies/${contentId}`,
      headers,
    });
    if (up.statusCode !== 200) return null;
    const j = JSON.parse(up.body.toString("utf8"));
    return j.data?.wv_license_proxy_url || null;
  } catch {
    return null;
  }
}

export async function fetchFairPlayLicenseUrlLive(accessToken: string, userId: string = "918558"): Promise<{ fp_license_proxy_url: string | null; fp_certificate_url: string | null }> {
  try {
    const headers: Record<string, string> = {
      accept: "application/json, text/plain, */*",
      authorization: `Bearer ${accessToken}`,
      origin: "https://smarttv.viu.lk",
      referer: "https://smarttv.viu.lk/",
      "user-agent": USER_AGENT,
    };
    const up = await httpsRequest({
      method: "GET",
      hostname: "api2.viu.lk",
      path: `/api/client/v1/default/users/${userId}/live/channels/channelone?translation=en`,
      headers,
    });
    if (up.statusCode !== 200) return { fp_license_proxy_url: null, fp_certificate_url: null };
    const j = JSON.parse(up.body.toString("utf8"));
    return {
      fp_license_proxy_url: j.data?.fp_license_proxy_url || null,
      fp_certificate_url: j.data?.fp_certificate_url || null,
    };
  } catch {
    return { fp_license_proxy_url: null, fp_certificate_url: null };
  }
}

export async function fetchFairPlayLicenseUrlVod(accessToken: string, contentId: string = "23145", userId: string = "918558"): Promise<{ fp_license_proxy_url: string | null; fp_certificate_url: string | null }> {
  try {
    const headers: Record<string, string> = {
      accept: "application/json, text/plain, */*",
      authorization: `Bearer ${accessToken}`,
      origin: "https://smarttv.viu.lk",
      referer: "https://smarttv.viu.lk/",
      "user-agent": USER_AGENT,
    };
    const up = await httpsRequest({
      method: "GET",
      hostname: "api3.viu.lk",
      path: `/api/client/v1/default/users/${userId}/vod/trailers/movies/${contentId}`,
      headers,
    });
    if (up.statusCode !== 200) return { fp_license_proxy_url: null, fp_certificate_url: null };
    const j = JSON.parse(up.body.toString("utf8"));
    return {
      fp_license_proxy_url: j.data?.fp_license_proxy_url || null,
      fp_certificate_url: j.data?.fp_certificate_url || null,
    };
  } catch {
    return { fp_license_proxy_url: null, fp_certificate_url: null };
  }
}

export async function fetchViuDevices(accessToken: string, userId: string = "918558"): Promise<Record<string, unknown> | null> {
  try {
    const headers: Record<string, string> = {
      accept: "application/json, text/plain, */*",
      authorization: `Bearer ${accessToken}`,
      origin: "https://smarttv.viu.lk",
      referer: "https://smarttv.viu.lk/",
      "user-agent": USER_AGENT,
    };
    const up = await httpsRequest({
      method: "GET",
      hostname: "api2.viu.lk",
      path: `/api/client/v1/default/users/${userId}/devices`,
      headers,
    });
    if (up.statusCode !== 200) return null;
    const j = JSON.parse(up.body.toString("utf8"));
    return j.data || null;
  } catch {
    return null;
  }
}

export interface RefreshResult {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

export async function refreshDeviceTokens(
  accessToken: string,
  refreshToken: string
): Promise<RefreshResult | null> {
  try {
    const res = await httpsRequest({
      method: "POST",
      hostname: "api.viu.lk",
      path: "/api/client/v2/global/refresh",
      headers: {
        accept: "application/json, text/plain, */*",
        "content-type": "application/json",
        authorization: `Bearer ${accessToken}`,
        origin: "https://smarttv.viu.lk",
        referer: "https://smarttv.viu.lk/",
        "user-agent": USER_AGENT,
      },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    if (res.statusCode < 200 || res.statusCode >= 300) return null;
    const j = JSON.parse(res.body.toString("utf8"));
    const d = j.data || j;
    if (!d.access_token) return null;
    return {
      access_token: d.access_token,
      refresh_token: d.refresh_token || refreshToken,
      expires_in: parseInt(String(d.expires_in || 0), 10),
    };
  } catch {
    return null;
  }
}

export async function fetchChannelsFromViu(token: string): Promise<unknown> {
  const up = await httpsRequest({
    method: "GET",
    hostname: "api2.viu.lk",
    path: "/api/client/v2/default/channels?packages=3,17,19,145,148,162,641,705,710,729,731,805,806,810,826,827,871,878&translation=en",
    headers: buildViuHeaders(token),
  });
  if (up.statusCode !== 200) throw new Error(`Channels HTTP ${up.statusCode}`);
  return JSON.parse(up.body.toString("utf8"));
}

export async function fetchMovieDetail(token: string, realId: string, userId: string = "918558"): Promise<unknown> {
  const up = await httpsRequestFollow({
    method: "GET",
    hostname: "api3.viu.lk",
    path: `/api/client/v1/default/users/${userId}/movies/${realId}?translation=en`,
    headers: buildViuHeaders(token),
  });
  if (up.statusCode !== 200) throw new Error(`Movie HTTP ${up.statusCode}`);
  if (!up.body) throw new Error("Movie empty body");
  return JSON.parse(up.body.toString("utf8"));
}

export async function fetchSeriesDetail(token: string, realId: string, userId: string = "918558"): Promise<unknown> {
  const up = await httpsRequestFollow({
    method: "GET",
    hostname: "api2.viu.lk",
    path: `/api/client/v1/default/users/${userId}/series/${realId}?translation=en&profile=920337`,
    headers: buildViuHeaders(token),
  });
  if (up.statusCode !== 200) throw new Error(`Series HTTP ${up.statusCode}`);
  if (!up.body) throw new Error("Series empty body");
  return JSON.parse(up.body.toString("utf8"));
}

export async function fetchOtpLogin(body: Record<string, unknown>): Promise<{ status: number; data: Record<string, unknown> }> {
  const url = "https://api.viu.lk/api/client/v2/global/login";
  const headers: Record<string, string> = {
    accept: "application/json, text/plain, */*",
    "accept-language": "en-GB,en;q=0.9",
    "content-type": "application/json",
    origin: "https://registration.viu.lk",
    referer: "https://registration.viu.lk/",
    "user-agent": USER_AGENT,
  };
  return new Promise((resolve, reject) => {
    const req = https.request(
      { method: "POST", hostname: "api.viu.lk", path: url.replace("https://api.viu.lk", ""), headers, agent: httpsAgent },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode || 0, data: JSON.parse(Buffer.concat(chunks).toString("utf8")) });
          } catch {
            resolve({ status: res.statusCode || 0, data: {} });
          }
        });
      }
    );
    req.on("error", reject);
    req.setTimeout(20000, () => req.destroy(new Error("Timeout")));
    req.write(JSON.stringify(body));
    req.end();
  });
}

export async function sendOtp(mobile: string): Promise<{ status: number; data: Record<string, unknown> }> {
  const url = `https://api.viu.lk/api/client/v1/global/send_otp?accessKey=${encodeURIComponent(IMG_ACCESS_KEY)}`;
  const body = {
    subscriber_uid: mobile,
    purpose: "LOGIN",
    length: "6",
    device_type: "SMART_TV",
    type: "NUMERIC",
  };
  const headers: Record<string, string> = {
    accept: "application/json, text/plain, */*",
    "accept-language": "en-GB,en;q=0.9",
    "content-type": "application/json",
    origin: "https://registration.viu.lk",
    referer: "https://registration.viu.lk/",
    "user-agent": USER_AGENT,
  };
  return new Promise((resolve, reject) => {
    const req = https.request(
      { method: "POST", hostname: "api.viu.lk", path: url.replace("https://api.viu.lk", ""), headers, agent: httpsAgent },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode || 0, data: JSON.parse(Buffer.concat(chunks).toString("utf8")) });
          } catch {
            resolve({ status: res.statusCode || 0, data: {} });
          }
        });
      }
    );
    req.on("error", reject);
    req.setTimeout(20000, () => req.destroy(new Error("Timeout")));
    req.write(JSON.stringify(body));
    req.end();
  });
}
