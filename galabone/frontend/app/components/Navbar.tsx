"use client";

import Link from "next/link";
import ThemeToggle from "./ThemeToggle";

export default function Navbar() {
  return (
    <nav className="w-full h-16 border-b border-slate-800 bg-slate-900/60 
                    backdrop-blur-md flex items-center justify-between px-6">
      
      {/* Left - Logo */}
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 bg-cyan-400 rounded-full flex items-center justify-center font-bold text-slate-900">
          G
        </div>
        <span className="text-lg font-semibold">GalaBone</span>
      </div>

      {/* Middle - Links */}
      <div className="hidden md:flex items-center gap-6 text-sm">
        <Link href="/" className="hover:text-cyan-300">首頁</Link>
        <Link href="/bonevision" className="hover:text-cyan-300">辨識頁面</Link>
        <Link href="/llm" className="hover:text-cyan-300">LLM</Link>
        <Link href="/model" className="hover:text-cyan-300">3D 模型</Link>
      </div>

      {/* Right - Theme + Login */}
      <div className="flex items-center gap-4">
        <ThemeToggle />

        {/* Login icon */}
        <button className="w-9 h-9 bg-slate-700 rounded-full flex items-center justify-center hover:bg-slate-600">
          <i className="fa-solid fa-user text-slate-200"></i>
        </button>
      </div>
    </nav>
  );
}
