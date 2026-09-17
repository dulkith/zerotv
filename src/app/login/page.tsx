"use client";

import { OtpInput } from "@/components/otp-input";
import { getDeviceUid } from "@/lib/auth";
import { useCallback, useEffect, useState } from "react";

function showToast(msg: string) {
  const t = document.createElement("div");
  t.className =
    "fixed bottom-8 left-1/2 -translate-x-1/2 bg-[#1e1e22ee] border border-white/15 text-white px-5 py-3 rounded-full text-sm font-semibold opacity-0 transition-all duration-250 z-[9999] pointer-events-none";
  t.textContent = msg;
  document.body.appendChild(t);
  requestAnimationFrame(() =>
    t.classList.add("opacity-100", "translate-y-0")
  );
  setTimeout(() => {
    t.classList.remove("opacity-100", "translate-y-0");
    setTimeout(() => t.remove(), 300);
  }, 2500);
}

export default function LoginPage() {
  const [step, setStep] = useState<"phone" | "otp">("phone");
  const [mobile, setMobile] = useState("");
  const [maskedMobile, setMaskedMobile] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(true);

  const checkAutoLogin = useCallback(async () => {
    try {
      const uid = await getDeviceUid();
      const res = await fetch("/api/auth/auto-login", {
        method: "POST",
        headers: { "x-device-uid": uid },
      });
      if (res.ok) {
        const data = await res.json();
        if (data.signedIn) {
          showToast(`Signed in as ${data.mobileNumber || "you"}`);
          setTimeout(() => {
            window.location.href = "/";
          }, 300);
          return;
        }
      }
    } catch { }
    setChecking(false);
  }, []);

  useEffect(() => {
    checkAutoLogin();
  }, [checkAutoLogin]);

  const handleSendOtp = async () => {
    if (!mobile || loading) return;
    setLoading(true);
    setError("");
    try {
      const uid = await getDeviceUid();
      const res = await fetch("/api/auth/send-otp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-device-uid": uid,
        },
        body: JSON.stringify({ mobileNumber: mobile }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to send code");
      setMaskedMobile(data.maskedMobile || "your phone");
      setStep("otp");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to send code");
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (code: string) => {
    setLoading(true);
    setError("");
    try {
      const uid = await getDeviceUid();
      const res = await fetch("/api/auth/verify-otp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-device-uid": uid,
        },
        body: JSON.stringify({ mobileNumber: mobile, otpCode: code }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Verification failed");
      showToast("Signed in successfully!");
      setTimeout(() => {
        window.location.href = "/";
      }, 500);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Verification failed");
      setLoading(false);
    }
  };

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#111]">
        <div className="w-10 h-10 border-4 border-white/10 border-t-[#ec1c24] rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-[#111]">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-black tracking-tight">
            Zero<span className="text-[#ec1c24]">TV</span>
          </h1>
          <p className="text-sm text-white/40 mt-2">
            Sign in with your mobile number
          </p>
        </div>

        <div className="bg-[#1c1c1c] border-2 border-white/10 rounded-xl p-6">
          {step === "phone" ? (
            <>
              <label className="block text-xs font-bold text-white/50 uppercase tracking-wider mb-2">
                Mobile number
              </label>
              <input
                type="tel"
                placeholder="077XXXXXXX"
                value={mobile}
                onChange={(e) => setMobile(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSendOtp()}
                className="w-full px-4 py-3 bg-black text-white border-2 border-white/10 outline-none focus:border-[#ec1c24] rounded-lg text-base mb-2"
                autoFocus
              />
              <p className="text-[11px] text-white/30 mb-4">
                Enter your Sri Lanka  077 number
              </p>
              <button
                onClick={handleSendOtp}
                disabled={!mobile || loading}
                className="w-full py-3 bg-[#ec1c24] text-black font-bold text-sm rounded-lg disabled:opacity-40 transition-opacity"
              >
                {loading ? "Sending…" : "Continue"}
              </button>
            </>
          ) : (
            <>
              <h2 className="text-lg font-bold text-white text-center mb-1">
                Enter code
              </h2>
              <p className="text-xs text-white/40 text-center mb-5">
                6-digit code sent to{" "}
                <b className="text-white/60">{maskedMobile}</b>
              </p>
              <OtpInput onComplete={handleVerifyOtp} disabled={loading} />
              {loading && (
                <p className="text-xs text-white/40 text-center mt-3">
                  Verifying…
                </p>
              )}
              <button
                onClick={() => {
                  setStep("phone");
                  setError("");
                }}
                className="w-full mt-4 text-xs text-white/40 hover:text-white/60 underline text-center"
              >
                ← Use a different number
              </button>
            </>
          )}
          {error && (
            <p className="text-xs text-red-400 mt-3 text-center">{error}</p>
          )}
        </div>

        <p className="text-center text-xs text-white/30 mt-6">
          <a href="/" className="hover:text-white/60">
            ← Back to ZeroTV
          </a>
        </p>
      </div>
    </div>
  );
}
