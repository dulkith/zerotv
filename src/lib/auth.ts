const DEVICE_UID_KEY = "deviceUid";

export async function getDeviceUid(): Promise<string> {
  if (typeof window === "undefined") return "";
  let uid = localStorage.getItem(DEVICE_UID_KEY);
  if (!uid) {
    const components = [
      navigator.userAgent,
      navigator.language,
      navigator.languages?.join(",") || "",
      screen.width + "x" + screen.height,
      screen.availWidth,
      screen.colorDepth + "x" + screen.pixelDepth,
      window.innerWidth || 0,
      Intl.DateTimeFormat().resolvedOptions().timeZone,
      navigator.hardwareConcurrency || 0,
      navigator.platform || "",
      new Date().getTimezoneOffset(),
      navigator.maxTouchPoints || 0,
    ].join("|");

    const hashBuffer = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(components)
    );
    const hashHex = Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    uid = [
      hashHex.substring(0, 8),
      hashHex.substring(8, 12),
      "4" + hashHex.substring(13, 16),
      ((parseInt(hashHex.substring(16, 18), 16) & 0x3f) | 0x80)
        .toString(16)
        .padStart(2, "0") +
        hashHex.substring(18, 20),
      hashHex.substring(20, 32),
    ].join("-");
    localStorage.setItem(DEVICE_UID_KEY, uid);
  }
  return uid;
}

export function authHeaders(uid: string): Record<string, string> {
  return { "x-device-uid": uid };
}

export async function authFetch(url: string, init?: RequestInit): Promise<Response> {
  const uid = await getDeviceUid();
  return fetch(url, {
    ...init,
    headers: { "x-device-uid": uid, ...init?.headers },
  });
}

// ── Auto-login (deduplicated) ────────────────────────────────
// Every page renders <AppHeader/> and both the page and the header need the
// signed-in state, but they must NOT each fire their own /api/auth/auto-login
// request. The in-flight promise is cached per device-uid so the first caller
// pays the network cost and the rest reuse the same result.
export interface AutoLoginResult {
  signedIn: boolean;
  mobileNumber: string | null;
}

let _autoLoginUid = "";
let _autoLoginPromise: Promise<AutoLoginResult> | null = null;

export async function checkAutoLogin(force = false): Promise<AutoLoginResult> {
  const uid = await getDeviceUid();
  if (!force && _autoLoginPromise && _autoLoginUid === uid) return _autoLoginPromise;
  _autoLoginUid = uid;
  _autoLoginPromise = fetch("/api/auth/auto-login", {
    method: "POST",
    headers: { "x-device-uid": uid },
  })
    .then((r) => r.json())
    .then(
      (d: { signedIn?: boolean; mobileNumber?: string | null }): AutoLoginResult => ({
        signedIn: !!d?.signedIn,
        mobileNumber: d?.mobileNumber ?? null,
      })
    )
    .catch((): AutoLoginResult => ({ signedIn: false, mobileNumber: null }));
  return _autoLoginPromise;
}

export function clearAutoLoginCache(): void {
  _autoLoginUid = "";
  _autoLoginPromise = null;
}
