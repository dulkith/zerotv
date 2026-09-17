"use client";

import { useState, useEffect, useRef, useCallback } from "react";

interface OtpInputProps {
  length?: number;
  onComplete: (code: string) => void;
  disabled?: boolean;
}

export function OtpInput({ length = 6, onComplete, disabled }: OtpInputProps) {
  const [values, setValues] = useState<string[]>(Array(length).fill(""));
  const inputs = useRef<(HTMLInputElement | null)[]>([]);

  const handleChange = useCallback(
    (index: number, value: string) => {
      if (!/^\d*$/.test(value)) return;
      const newValues = [...values];
      newValues[index] = value.slice(-1);
      setValues(newValues);

      if (value && index < length - 1) {
        inputs.current[index + 1]?.focus();
      }

      const code = newValues.join("");
      if (code.length === length) {
        onComplete(code);
      }
    },
    [values, length, onComplete]
  );

  const handleKeyDown = useCallback(
    (index: number, e: React.KeyboardEvent) => {
      if (e.key === "Backspace" && !values[index] && index > 0) {
        inputs.current[index - 1]?.focus();
      }
    },
    [values]
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      e.preventDefault();
      const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, length);
      if (!pasted) return;
      const newValues = Array(length).fill("");
      for (let i = 0; i < pasted.length; i++) {
        newValues[i] = pasted[i];
      }
      setValues(newValues);
      const focusIndex = Math.min(pasted.length, length - 1);
      inputs.current[focusIndex]?.focus();
      if (pasted.length === length) {
        onComplete(pasted);
      }
    },
    [length, onComplete]
  );

  return (
    <div className="flex gap-2 justify-center">
      {values.map((val, i) => (
        <input
          key={i}
          ref={(el) => { inputs.current[i] = el; }}
          type="text"
          inputMode="numeric"
          maxLength={1}
          value={val}
          onChange={(e) => handleChange(i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onPaste={handlePaste}
          disabled={disabled}
          className="w-11 h-13 text-center text-lg font-bold bg-black text-white border-2 border-white/20 outline-none focus:border-[#ec1c24] rounded-lg disabled:opacity-40 transition-colors"
        />
      ))}
    </div>
  );
}
