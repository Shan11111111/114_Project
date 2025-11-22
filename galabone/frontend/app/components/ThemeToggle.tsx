"use client";

import { useEffect, useState } from "react";

export default function ThemeToggle() {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    // 初次載入讀取目前 class 狀態
    setIsDark(document.documentElement.classList.contains("dark"));
  }, []);

  const toggleTheme = () => {
    const html = document.documentElement;
    html.classList.toggle("dark");
    setIsDark(html.classList.contains("dark"));
  };

  return (
    <button
      onClick={toggleTheme}
      className="w-9 h-9 bg-slate-700 rounded-full flex items-center justify-center hover:bg-slate-600"
    >
      {isDark ? (
        <i className="fa-solid fa-sun text-yellow-300"></i>
      ) : (
        <i className="fa-solid fa-moon text-slate-200"></i>
      )}
    </button>
  );
}
