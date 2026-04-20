"use client";

import { useEffect, useState } from "react";

export default function ThemeToggle() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    // ✅ 預設深色：第一次載入時加上 dark
    if (!document.documentElement.classList.contains("dark")) {
      document.documentElement.classList.add("dark");
    }
  }, []);

  if (!mounted) return null;

  const isDark = document.documentElement.classList.contains("dark");

  const toggleTheme = () => {
    document.documentElement.classList.toggle("dark");
  };

  return (
    <button
      onClick={toggleTheme}
      className="w-9 h-9 rounded-full flex items-center justify-center border border-slate-600 text-xs"
    >
      {isDark ? "☀️" : "🌙"}
    </button>
  );
}
