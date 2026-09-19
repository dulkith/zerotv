"use client";

import { LoginDialog } from "@/components/login-dialog";
import { AppHeader } from "@/components/app-header";
import { BottomNav } from "@/components/bottom-nav";
import { getDeviceUid } from "@/lib/auth";
import { Clapperboard, Film, Radio } from "lucide-react";
import { useEffect, useState } from "react";

export default function LandingPage() {
  const [signedIn, setSignedIn] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [copyrightAcknowledged, setCopyrightAcknowledged] = useState(false);

  useEffect(() => {
    const ctrl = new AbortController();
    getDeviceUid().then((uid) => {
      fetch("/api/auth/auto-login", {
        method: "POST",
        headers: { "x-device-uid": uid },
        signal: ctrl.signal,
      })
        .then((r) => r.json())
        .then((d) => {
          if (!ctrl.signal.aborted) {
            setSignedIn(d.signedIn || false);
            setAuthChecked(true);
            if (d.signedIn && window.location.search.includes("signin=1")) {
              window.history.replaceState(null, "", window.location.pathname);
            }
          }
        })
        .catch(() => { if (!ctrl.signal.aborted) setAuthChecked(true); });
    });

    const params = new URLSearchParams(window.location.search);
    if (params.get("signin") === "1") {
      setLoginOpen(true);
      window.history.replaceState(null, "", window.location.pathname);
    }

    return () => ctrl.abort();
  }, []);

  const goHome = () => { window.location.href = "/home"; };

  const TelegramIcon = () => (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5"><path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" /></svg>
  );

  return (
    <div className="min-h-screen bg-[#0a0a0c]">
      <div className="flex flex-col bg-[#0a0a0c] min-h-screen overflow-x-hidden">
        <AppHeader activePage="landing" />

        {/* Hero */}
        <div className="relative flex-1 flex flex-col">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[600px] bg-[#ec1c24]/8 rounded-full blur-[120px] pointer-events-none" />
          <div className="absolute bottom-0 right-0 w-[400px] h-[400px] bg-[#ec1c24]/5 rounded-full blur-[100px] pointer-events-none" />

          <div className="relative z-10 flex-1 flex flex-col items-center justify-center text-center px-6 pb-12 pt-8">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-[#ec1c24]/10 border border-[#ec1c24]/20 mb-8">
              <span className="w-1.5 h-1.5 rounded-full bg-[#ec1c24] animate-pulse" />
              <span className="text-xs text-[#ec1c24] font-bold uppercase tracking-wider">Live Now</span>
            </div>

            <h1 className="text-4xl sm:text-6xl md:text-7xl lg:text-8xl font-black text-white leading-[0.95] tracking-tight mb-6">
              Live TV<br />
              <span className="text-[#ec1c24]">Movies &amp; Series</span><br />
              <span className="text-white/30">On Any Screen</span>
            </h1>

            <p className="text-base sm:text-lg text-white/40 max-w-md leading-relaxed mb-10 font-medium">
              Live TV, Movies &amp; Series — on any device. Smart TV, iPhone, Laptop, TiviMate, or your browser. No app needed.
            </p>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full sm:w-auto">
              {authChecked && (
                signedIn ? (
                  <>
                    <button onClick={goHome} className="px-8 py-3.5 rounded-xl bg-[#ec1c24] text-white font-bold text-base hover:bg-[#d41a20] transition-all shadow-[0_4px_24px_rgba(236,28,36,0.4)] active:scale-[0.97] flex items-center justify-center gap-2">
                      <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5"><polygon points="6 4 20 12 6 20" /></svg>
                      Watch Now
                    </button>
                    <a href="https://t.me/+rsIXSZEUUIM2OWNl" target="_blank" rel="noopener noreferrer" className="px-8 py-3.5 rounded-xl bg-[#0088cc]/10 text-[#5ea9e8] font-bold text-base border border-[#0088cc]/30 hover:bg-[#0088cc]/20 hover:border-[#0088cc]/50 transition-all flex items-center justify-center gap-2">
                      <TelegramIcon />
                      Join Telegram
                    </a>
                  </>
                ) : (
                  <>
                    <button onClick={goHome} className="px-8 py-3.5 rounded-xl bg-[#ec1c24] text-white font-bold text-base hover:bg-[#d41a20] transition-all shadow-[0_4px_24px_rgba(236,28,36,0.4)] active:scale-[0.97] flex items-center justify-center gap-2">
                      <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5"><polygon points="6 4 20 12 6 20" /></svg>
                      Start Watching
                    </button>
                    <a href="https://t.me/+rsIXSZEUUIM2OWNl" target="_blank" rel="noopener noreferrer" className="px-8 py-3.5 rounded-xl bg-[#0088cc]/10 text-[#5ea9e8] font-bold text-base border border-[#0088cc]/30 hover:bg-[#0088cc]/20 hover:border-[#0088cc]/50 transition-all flex items-center justify-center gap-2">
                      <TelegramIcon />
                      Join Telegram
                    </a>
                  </>
                )
              )}
            </div>

            <div className="mt-16 flex flex-col items-center gap-2 text-white/20">
              <span className="text-xs font-semibold uppercase tracking-widest">Scroll to explore</span>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5 animate-bounce"><path d="m6 9 6 6 6-6" /></svg>
            </div>
          </div>
        </div>

        {/* Features */}
        <div id="features" className="relative z-10 px-6 sm:px-10 py-8 sm:py-12 border-t border-white/[0.04]">
          <div className="max-w-5xl mx-auto">
            <div className="text-center mb-8">
              <h2 className="text-3xl sm:text-4xl font-black text-white mb-2">Everything you need</h2>
              <p className="text-sm text-white/30">One subscription. All your entertainment.</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {[
                { icon: <Radio className="w-7 h-7" />, title: "Live TV", desc: "Hundreds of live channels with real-time EPG and catchup" },
                { icon: <Film className="w-7 h-7" />, title: "Movies", desc: "Latest movies in HD, FHD & 4K with DRM protection" },
                { icon: <Clapperboard className="w-7 h-7" />, title: "Series", desc: "Full series with auto-play next and episode queue" },
              ].map((f) => (
                <div key={f.title} className="group relative p-6 rounded-2xl bg-white/[0.02] border border-white/[0.06] hover:border-[#ec1c24]/30 transition-all overflow-hidden">
                  <div className="absolute inset-0 bg-gradient-to-br from-[#ec1c24]/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                  <div className="relative flex flex-col items-start text-left">
                    <div className="w-12 h-12 rounded-xl bg-[#ec1c24]/10 border border-[#ec1c24]/20 flex items-center justify-center text-[#ec1c24] mb-4">
                      {f.icon}
                    </div>
                    <h3 className="text-base font-bold text-white mb-1.5">{f.title}</h3>
                    <p className="text-xs text-white/40 leading-relaxed">{f.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Compatible Devices */}
        <div id="devices" className="relative z-10 px-6 sm:px-10 py-6 sm:py-10 border-t border-white/[0.04]">
          <div className="max-w-4xl mx-auto text-center">
            <p className="text-[10px] uppercase tracking-[0.2em] text-[#ec1c24] font-bold mb-2">Compatible Devices</p>
            <h2 className="text-2xl sm:text-3xl font-black text-white mb-5">Watch on any screen</h2>
            <div className="relative rounded-2xl overflow-hidden border border-white/[0.06] bg-white/[0.02]">
              <img src="/support-apps.png" alt="Supported devices and platforms" className="w-full h-auto p-5" />
            </div>
            <p className="text-[10px] text-white/20 mt-4">No app needed — works in any browser or via M3U playlist</p>
          </div>
        </div>

        {/* CTA */}
        <div className="relative z-10 px-6 sm:px-10 py-8 sm:py-12 border-t border-white/[0.04]">
          <div className="max-w-2xl mx-auto text-center">
            <p className="text-[10px] uppercase tracking-[0.2em] text-[#ec1c24] font-bold mb-2">Get Started</p>
            <h2 className="text-2xl sm:text-3xl font-black text-white mb-3">Ready to stream?</h2>
            <p className="text-sm text-white/35 mb-6">{signedIn ? "You're all set. Start watching now." : "Get your M3U playlist or sign in to start watching on any device."}</p>
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-3 w-full sm:w-auto">
              {authChecked && (
                signedIn ? (
                  <>
                    <button onClick={goHome} className="px-8 py-3.5 rounded-xl bg-[#ec1c24] text-white font-bold text-base hover:bg-[#d41a20] transition-all shadow-[0_4px_24px_rgba(236,28,36,0.4)] active:scale-[0.97] flex items-center justify-center gap-2">
                      <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5"><polygon points="6 4 20 12 6 20" /></svg>
                      Watch Now
                    </button>
                    <a href="https://t.me/+rsIXSZEUUIM2OWNl" target="_blank" rel="noopener noreferrer" className="px-8 py-3.5 rounded-xl bg-[#0088cc]/10 text-[#5ea9e8] font-bold text-base border border-[#0088cc]/30 hover:bg-[#0088cc]/20 hover:border-[#0088cc]/50 transition-all flex items-center justify-center gap-2">
                      <TelegramIcon />
                      Join Telegram
                    </a>
                  </>
                ) : (
                  <>
                    <button onClick={goHome} className="px-8 py-3.5 rounded-xl bg-[#ec1c24] text-white font-bold text-base hover:bg-[#d41a20] transition-all shadow-[0_4px_24px_rgba(236,28,36,0.4)] active:scale-[0.97] flex items-center justify-center gap-2">
                      <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5"><polygon points="6 4 20 12 6 20" /></svg>
                      Start Watching
                    </button>
                    <a href="https://t.me/+rsIXSZEUUIM2OWNl" target="_blank" rel="noopener noreferrer" className="px-8 py-3.5 rounded-xl bg-[#0088cc]/10 text-[#5ea9e8] font-bold text-base border border-[#0088cc]/30 hover:bg-[#0088cc]/20 hover:border-[#0088cc]/50 transition-all flex items-center justify-center gap-2">
                      <TelegramIcon />
                      Join Telegram
                    </a>
                  </>
                )
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="relative z-10 px-6 sm:px-10 py-6 border-t border-white/[0.04] pb-20 sm:pb-6">
          <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
            <span className="text-xs font-bold text-white/30">LankaTV</span>
            <p className="text-[10px] text-white/15">Live TV. Movies &amp; Series. On Any Screen.</p>
          </div>
        </div>

        <BottomNav activePage="home" />
      </div>

      {/* Copyright Notice Overlay */}
      {!copyrightAcknowledged && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/80 backdrop-blur-sm px-4">
          <div className="w-full max-w-lg bg-[#111113] border border-white/[0.08] rounded-2xl p-6 sm:p-8 shadow-2xl">
            <div className="text-center mb-5">
              <div className="w-12 h-12 rounded-full bg-[#ec1c24]/10 border border-[#ec1c24]/20 flex items-center justify-center mx-auto mb-4">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-6 h-6 text-[#ec1c24]"><path d="M12 9v4m0 4h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /></svg>
              </div>
              <h3 className="text-lg font-bold text-white mb-1">Important Notice</h3>
              <p className="text-xs text-white/40">To Broadcasters &amp; Content Owners</p>
            </div>
            <div className="space-y-3 text-sm text-white/50 leading-relaxed mb-6">
              <p>If you are a <span className="text-white/70 font-medium">copyright owner, broadcaster, or authorized representative</span> and have any concerns, issues, or takedown requests regarding any channel or content on LankaTV:</p>
              <p>Please contact me directly. <span className="text-[#ec1c24] font-medium">I will not hesitate to take down or stop the site immediately.</span> A single request from you is more than enough — I will stop it right away because I truly respect your rights and work.</p>
            </div>
            <div className="flex flex-col sm:flex-row gap-3">
              <a href="https://t.me/yakalk_bot?text=hello" target="_blank" rel="noopener noreferrer" className="flex-1 py-3 rounded-xl bg-[#22c55e]/10 text-[#22c55e] font-bold text-sm border border-[#22c55e]/30 hover:bg-[#22c55e]/20 hover:border-[#22c55e]/50 transition-all flex items-center justify-center gap-2">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
                Contact
              </a>
              <button onClick={() => setCopyrightAcknowledged(true)} className="flex-1 py-3 rounded-xl bg-[#ec1c24]/10 text-[#ec1c24] font-bold text-sm border border-[#ec1c24]/30 hover:bg-[#ec1c24]/20 hover:border-[#ec1c24]/50 transition-all">
                I Understand &amp; Continue
              </button>
            </div>
          </div>
        </div>
      )}

      <LoginDialog open={loginOpen} onOpenChange={setLoginOpen} />
    </div>
  );
}
