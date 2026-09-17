import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "api2.viu.lk" },
    ],
  },
};

export default nextConfig;
