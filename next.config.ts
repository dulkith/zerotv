import type { NextConfig } from "next";
import WebpackObfuscator from "webpack-obfuscator";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "api2.viu.lk" },
    ],
  },
  poweredByHeader: false,
  productionBrowserSourceMaps: false,
  webpack: (config, { dev, isServer }) => {
    if (!dev && !isServer) {
      config.plugins.push(
        new WebpackObfuscator({
          compact: true,
          controlFlowFlattening: true,
          controlFlowFlatteningThreshold: 0.4,
          deadCodeInjection: true,
          deadCodeInjectionThreshold: 0.2,
          debugProtection: true,
          disableConsoleOutput: true,
          identifierNamesGenerator: "mangled",
          renameGlobals: false,
          selfDefending: true,
          stringArray: true,
          stringArrayEncoding: ["base64"],
          stringArrayThreshold: 0.75,
          stringConcealing: true,
          transformObjectKeys: true,
          unicodeEscapeSequence: false,
        })
      );
    }
    return config;
  },
};

export default nextConfig;
