"use client";

import { useEffect } from "react";
import DisableDevtool from "disable-devtool";

export function SecurityInit() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    DisableDevtool({
      url: "about:blank",
      rewriteHTML: '<body style="background:#000;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;font-size:1.2rem">Access denied</body>',
      disableMenu: true,
      clearLog: true,
      detectors: "all" as never,
      interval: 200,
      disableSelect: true,
      disableCopy: true,
      disableCut: true,
      disablePaste: true,
      disableIframeParents: true,
    });
  }, []);

  return null;
}
