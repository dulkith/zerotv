"use client";

import { useState, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { OtpInput } from "@/components/otp-input";
import { getDeviceUid } from "@/lib/auth";

interface LoginDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

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

export function LoginDialog({ open, onOpenChange }: LoginDialogProps) {
  const [step, setStep] = useState<"phone" | "otp">("phone");
  const [mobile, setMobile] = useState("");
  const [maskedMobile, setMaskedMobile] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const reset = useCallback(() => {
    setStep("phone");
    setMobile("");
    setMaskedMobile("");
    setLoading(false);
    setError("");
  }, []);

  const handleOpenChange = useCallback((val: boolean) => {
    if (!val) reset();
    onOpenChange(val);
  }, [onOpenChange, reset]);

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
      onOpenChange(false);
      setTimeout(() => {
        window.location.reload();
      }, 300);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Verification failed");
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="bg-[#1c1c1c] border border-white/10">
        <DialogHeader>
          <DialogTitle className="text-center text-white">
            <img src="/lanka_tv_logo.png" alt="LankaTV" className="h-10 mx-auto" />
          </DialogTitle>
          <DialogDescription className="text-center text-white/40 text-xs">
            Sign in with your mobile number
          </DialogDescription>
        </DialogHeader>

        <div className="pt-2">
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
                Enter your Sri Lanka 077 number
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
              <h2 className="text-base font-bold text-white text-center mb-1">
                Enter code
              </h2>
              <p className="text-xs text-white/40 text-center mb-4">
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
      </DialogContent>
    </Dialog>
  );
}
