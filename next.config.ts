import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "api2.viu.lk" },
    ],
  },
  // Custom server handles all API routes
  // Next.js only handles page rendering
};

export default nextConfig;
