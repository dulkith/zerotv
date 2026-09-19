"use client";

import { useState, useEffect, useCallback } from "react";
import { Tv, QrCode, X } from "lucide-react";

interface AppHeaderProps {
  activePage?: "landing" | "home" | "m3u";
  onSignIn?: () => void;
}

export function AppHeader({ activePage, onSignIn }: AppHeaderProps) {
  const [signedIn, setSignedIn] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [qrImage, setQrImage] = useState("");
  const [qrUrl, setQrUrl] = useState("");
  const [qrLoading, setQrLoading] = useState(false);
  const [qrCopied, setQrCopied] = useState(false);

  useEffect(() => {
    const ctrl = new AbortController();
    const { getDeviceUid } = require("@/lib/auth");
    getDeviceUid().then((uid: string) => {
      fetch("/api/auth/auto-login", {
        method: "POST",
        headers: { "x-device-uid": uid },
        signal: ctrl.signal,
      })
        .then((r: Response) => r.json())
        .then((d: any) => { if (!ctrl.signal.aborted) setSignedIn(d.signedIn || false); })
        .catch(() => {});
    });
    return () => ctrl.abort();
  }, []);

  const generateQr = useCallback(async () => {
    setQrLoading(true);
    setQrOpen(true);
    setQrImage("");
    try {
      const { getDeviceUid } = require("@/lib/auth");
      const uid = await getDeviceUid();
      const res = await fetch("/api/auth/qr-generate", { method: "POST", headers: { "x-device-uid": uid } });
      if (res.ok) {
        const data = await res.json();
        if (data.qr) { setQrImage(data.qr); setQrUrl(data.url); }
      }
    } catch {}
    setQrLoading(false);
  }, []);

  return (
    <>
      <header className="sticky top-0 z-40 bg-[#0a0a0c]/95 backdrop-blur-md border-b border-white/[0.06]">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          {/* Left: logo */}
          <a href="/" className="flex items-center">
            <img src="/lanka_tv_logo.png" alt="LankaTV" className="h-7 sm:h-8" />
          </a>

          {/* Right actions */}
          <div className="flex items-center gap-1.5">
            <a
              href="https://t.me/yakalk_bot?text=hello"
              target="_blank"
              rel="noopener noreferrer"
              className="hidden sm:flex items-center gap-1.5 text-xs text-white/40 hover:text-white transition-all px-3 py-1.5 rounded-lg border border-white/[0.06] hover:border-white/[0.15] hover:bg-white/[0.04] font-semibold"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
              Contact
            </a>
            {signedIn && (
              <button
                onClick={generateQr}
                className="flex items-center gap-1.5 text-xs text-white/40 hover:text-white transition-all px-3 py-1.5 rounded-lg border border-white/[0.06] hover:border-white/[0.15] hover:bg-white/[0.04] font-semibold"
                title="Share login via QR"
              >
                <QrCode className="w-3.5 h-3.5" /> <span className="hidden sm:inline">QR</span>
              </button>
            )}
            {!signedIn && (
              <button onClick={onSignIn} className="flex items-center gap-1.5 text-xs text-white/60 hover:text-white transition-all px-3 py-1.5 rounded-lg border border-white/[0.08] hover:border-white/[0.2] hover:bg-white/[0.04] font-semibold">
                Sign In
              </button>
            )}
            {signedIn && activePage !== "home" && (
              <a href="/home" className="flex items-center gap-1.5 text-xs text-white/80 hover:text-white px-3 py-1.5 rounded-lg bg-[#ec1c24] hover:bg-[#d41a20] font-bold transition-all shadow-[0_2px_10px_rgba(236,28,36,0.25)]">
                <Tv className="w-3.5 h-3.5" /> Watch
              </a>
            )}
          </div>
        </div>
      </header>

      {/* QR Modal */}
      {qrOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm px-4" onClick={() => setQrOpen(false)}>
          <div className="relative w-full max-w-sm bg-[#111113] border border-white/[0.08] rounded-2xl p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => setQrOpen(false)} className="absolute top-3 right-3 text-white/30 hover:text-white transition-colors">
              <X className="w-5 h-5" />
            </button>
            <h3 className="text-base font-bold text-white text-center mb-1">Scan to Sign In</h3>
            <p className="text-[11px] text-white/30 text-center mb-5">Scan this QR code with another device to share this login</p>
            <div className="flex items-center justify-center mb-5">
              {qrLoading ? (
                <div className="w-[256px] h-[256px] flex items-center justify-center">
                  <div className="w-10 h-10 border-4 border-white/10 border-t-[#ec1c24] rounded-full animate-spin" />
                </div>
              ) : qrImage ? (
                <div className="bg-white rounded-xl p-3">
                  <img src={qrImage} alt="QR Code" className="w-[224px] h-[224px]" />
                </div>
              ) : (
                <div className="w-[256px] h-[256px] flex items-center justify-center bg-white/5 rounded-xl">
                  <p className="text-xs text-white/30">Failed to generate QR</p>
                </div>
              )}
            </div>
            {qrUrl && (
              <button
                onClick={() => { navigator.clipboard.writeText(qrUrl); setQrCopied(true); setTimeout(() => setQrCopied(false), 2000); }}
                className="w-full py-2.5 rounded-xl bg-white/[0.06] hover:bg-white/[0.1] border border-white/[0.08] text-xs font-semibold text-white/60 hover:text-white transition-all"
              >
                {qrCopied ? "Link Copied!" : "Copy Link"}
              </button>
            )}
            <p className="text-[10px] text-white/20 text-center mt-3">Link expires in 5 minutes</p>
          </div>
        </div>
      )}
    </>
  );
}
