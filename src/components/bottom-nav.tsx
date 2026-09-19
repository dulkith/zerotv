"use client";

import { Tv, Home, Radio, MessageCircle } from "lucide-react";

interface BottomNavProps {
  activePage: string;
}

export function BottomNav({ activePage }: BottomNavProps) {
  const item = (page: string, href: string, icon: React.ReactNode, label: string) => (
    <a
      href={href}
      className={`flex flex-col items-center gap-0.5 px-4 py-1.5 rounded-xl transition-colors ${
        activePage === page ? "text-[#ec1c24]" : "text-white/40 hover:text-white"
      }`}
    >
      {icon}
      <span className="text-[9px] font-bold">{label}</span>
    </a>
  );

  return (
    <div className="sm:hidden fixed bottom-0 left-0 right-0 z-[85] bg-[#0a0a0c]/98 backdrop-blur-xl border-t border-white/[0.06]">
      <div className="flex items-center justify-around px-2 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        {item("home", "/", <Home className="w-5 h-5" />, "Home")}
        {item("live", "/home", <Tv className="w-5 h-5" />, "Live")}
        {item("m3u", "/m3u", <Radio className="w-5 h-5" />, "M3U")}
        <a
          href="https://t.me/yakalk_bot?text=hello"
          target="_blank"
          rel="noopener noreferrer"
          className="flex flex-col items-center gap-0.5 px-4 py-1.5 rounded-xl text-white/40 hover:text-white transition-colors"
        >
          <MessageCircle className="w-5 h-5" />
          <span className="text-[9px] font-bold">Chat</span>
        </a>
      </div>
    </div>
  );
}
