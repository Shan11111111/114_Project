"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getUser } from "../lib/auth";
import { logoutUser } from "../lib/auth_api";
import { useRouter } from "next/navigation";

export default function Navbar() {
  const [dark, setDark] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [user, setUserState] = useState(getUser());
  const [open, setOpen] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const isDark = document.documentElement.classList.contains("dark");
    setDark(isDark);
    setMounted(true);

    const onAuthChanged = () => setUserState(getUser());
    window.addEventListener("auth-changed", onAuthChanged);
    return () => window.removeEventListener("auth-changed", onAuthChanged);
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

  const onLogout = async () => {
    await logoutUser();
    setOpen(false);
    router.push("/auth");
  };

  const avatarText = (user?.username?.[0] || user?.email?.[0] || "U").toUpperCase();

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
      <Link href="/" className="flex items-center gap-3">
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
      </Link>

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

      {/* Right - Theme + Auth */}
      <div className="flex items-center gap-4 relative">
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
            <div
              className={`
                absolute inset-y-1 w-12 rounded-full
                bg-white shadow-md flex items-center justify-center gap-1
                text-[9px] font-semibold
                transition-all duration-300
                ${dark ? "right-1" : "left-1"}
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

        {/* Auth button */}
        <button
          onClick={() => {
            if (!user) {
              router.push("/auth");
            } else {
              setOpen((v) => !v);
            }
          }}
          className="w-9 h-9 rounded-full flex items-center justify-center font-bold"
          style={{
            backgroundColor: "var(--navbar-icon-bg)",
            color: "var(--navbar-icon-text)",
          }}
          aria-label={user ? "帳號選單" : "登入"}
          title={user ? (user.username || user.email || "Account") : "登入 / 註冊"}
        >
          {user ? avatarText : <i className="fa-solid fa-user" />}
        </button>

        {/* Dropdown */}
        {user && open && (
          <div
            className="absolute right-0 top-12 w-64 rounded-xl border shadow-lg p-3 z-50"
            style={{ background: "var(--card-bg)", borderColor: "var(--card-border)" }}
          >
            <div className="text-sm">
              <div className="font-semibold">{user.username || "未命名使用者"}</div>
              <div className="opacity-80">{user.email}</div>
              <div className="text-xs mt-1 opacity-70">role: {user.roles || "user"}</div>
            </div>

            <div className="mt-3 flex gap-2">
              <button
                className="flex-1 rounded-lg border px-3 py-2 text-sm"
                style={{ borderColor: "var(--card-border)" }}
                onClick={() => {
                  setOpen(false);
                  router.push("/auth");
                }}
              >
                帳戶中心
              </button>
              <button
                className="flex-1 rounded-lg px-3 py-2 text-sm font-semibold"
                style={{ background: "var(--chip-active-bg)", color: "var(--chip-active-text)" }}
                onClick={onLogout}
              >
                登出
              </button>
            </div>
          </div>
        )}
      </div>
    </nav>
  );
}
