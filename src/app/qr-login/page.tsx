"use client";

import { useEffect, useState } from "react";
import { getDeviceUid } from "@/lib/auth";

export default function QrLoginPage() {
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");
    if (!token) {
      setStatus("error");
      setError("Invalid QR code — no token found");
      return;
    }

    let cancelled = false;
    getDeviceUid().then((uid) => {
      fetch("/api/auth/qr-claim", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-device-uid": uid },
        body: JSON.stringify({ token }),
      })
        .then((r) => r.json())
        .then((d) => {
          if (cancelled) return;
          if (d.signedIn) {
            setStatus("success");
            setTimeout(() => { window.location.href = "/home"; }, 1000);
          } else {
            setStatus("error");
            setError(d.error || "Failed to sign in");
          }
        })
        .catch(() => {
          if (!cancelled) {
            setStatus("error");
            setError("Network error — try again");
          }
        });
    });

    return () => { cancelled = true; };
  }, []);

  return (
    <div className="min-h-screen bg-[#0a0a0c] flex flex-col items-center justify-center gap-4 px-4">
      <img src="/lanka_tv_logo.png" alt="LankaTV" className="h-10" />
      {status === "loading" && (
        <>
          <div className="w-10 h-10 border-4 border-white/10 border-t-[#ec1c24] rounded-full animate-spin" />
          <p className="text-sm text-white/40">Signing you in...</p>
        </>
      )}
      {status === "success" && (
        <>
          <div className="w-12 h-12 rounded-full bg-[#22c55e]/10 border border-[#22c55e]/20 flex items-center justify-center">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-6 h-6 text-[#22c55e]"><path d="M20 6L9 17l-5-5" /></svg>
          </div>
          <p className="text-sm text-white/60 font-semibold">Signed in successfully! Redirecting...</p>
        </>
      )}
      {status === "error" && (
        <>
          <div className="w-12 h-12 rounded-full bg-[#ec1c24]/10 border border-[#ec1c24]/20 flex items-center justify-center">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-6 h-6 text-[#ec1c24]"><path d="M18 6L6 18M6 6l12 12" /></svg>
          </div>
          <p className="text-sm text-white/60 font-semibold">{error}</p>
          <a href="/" className="mt-2 px-6 py-2 bg-[#ec1c24] rounded-xl font-bold text-sm text-white hover:bg-[#d41a20] transition-all">
            Go to Home
          </a>
        </>
      )}
    </div>
  );
}
