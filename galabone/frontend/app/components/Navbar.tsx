"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export default function Navbar() {
  const [dark, setDark] = useState(false);
  const [mounted, setMounted] = useState(false);

  // 讀取目前 html 上是否有 .dark，只用來對齊按鈕狀態
  useEffect(() => {
    const isDark = document.documentElement.classList.contains("dark");
    setDark(isDark);
    setMounted(true);
  }, []);

  const toggleTheme = () => {
    const newDark = !dark;
    setDark(newDark);

    if (newDark) {
      document.documentElement.classList.add("dark");
      localStorage.setItem("theme", "dark");
    } else {
      document.documentElement.classList.remove("dark");
      localStorage.setItem("theme", "light");
    }
  };

  return (
    <nav
      className="w-full h-16 border-b backdrop-blur-md flex items-center justify-between px-6"
      style={{
        backgroundColor: "var(--navbar-bg)",
        borderColor: "var(--navbar-border)",
        color: "var(--navbar-text)",
      }}
    >
      {/* Left - Logo */}
      <div className="flex items-center gap-3">
        <div
          className="w-9 h-9 rounded-full flex items-center justify-center font-bold"
          style={{
            backgroundColor: "var(--navbar-logo-bg)",
            color: "var(--navbar-logo-text)",
          }}
        >
          G
        </div>
        <span className="text-lg font-semibold">GalaBone</span>
      </div>

      {/* Middle - Links */}
      <div className="hidden md:flex items-center gap-6 text-sm">
        <Link href="/" className="hover-link">
          <b>首頁</b>
        </Link>
        <Link href="/bonevision" className="hover-link">
          <b>辨識頁面</b>
        </Link>
        <Link href="/llm" className="hover-link">
          <b>LLM</b>
        </Link>
        <Link href="/model" className="hover-link">
          <b>3D 模型</b>
        </Link>
      </div>

      {/* Right - Theme + Login */}
      <div className="flex items-center gap-4">
        {/* mounted 之前不渲染 → 避免 hydration warning & 閃爍 */}
        {mounted && (
          <button
            onClick={toggleTheme}
            aria-label="切換主題"
            className={`
              relative h-8 w-20 rounded-full border
              flex items-center
              transition-colors duration-300
              ${dark ? "bg-slate-900 border-slate-100/70" : "bg-slate-200 border-slate-300"}
            `}
          >
            {/* 縮小版 iOS 風格滑動圓角球 */}
            <div
              className={`
                absolute top-1 left-1 h-6 w-12 rounded-full
                bg-white shadow-md flex items-center justify-center gap-1
                text-[9px] font-semibold
                transition-transform duration-300
                ${dark ? "translate-x-8" : "translate-x-0"}
              `}
            >
              {dark ? (
                <>
                  <i className="fa-solid fa-moon text-slate-700 text-[10px]" />
                  <span>DARK</span>
                </>
              ) : (
                <>
                  <i className="fa-solid fa-sun text-yellow-500 text-[10px]" />
                  <span>LIGHT</span>
                </>
              )}
            </div>
          </button>
        )}

        {/* Login icon */}
        <button
          className="w-9 h-9 rounded-full flex items-center justify-center"
          style={{
            backgroundColor: "var(--navbar-icon-bg)",
            color: "var(--navbar-icon-text)",
          }}
          aria-label="登入"
        >
          <i className="fa-solid fa-user" />
        </button>
      </div>
    </nav>
  );
}
