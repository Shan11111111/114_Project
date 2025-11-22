"use client";

import Link from "next/link";
import ThemeToggle from "./ThemeToggle";

export default function Navbar() {
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
        <ThemeToggle />

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
