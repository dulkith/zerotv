import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { SecurityInit } from "@/components/security-init";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "LankaTV",
  description: "LankaTV — Live TV, Movies & Series. Stream on any device.",
  icons: {
    icon: [
      { url: "/favicon-96x96.png", sizes: "96x96", type: "image/png" },
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon.ico" },
    ],
    apple: "/apple-touch-icon.png",
    other: [
      { rel: "shortcut icon", url: "/favicon.ico" },
    ],
  },
  manifest: "/site.webmanifest",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable}`}>
      <body>
        <SecurityInit />
        {children}
      </body>
    </html>
  );
}
