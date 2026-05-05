"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { getUser } from "../lib/auth";
import { logoutUser } from "../lib/auth_api";
import { usePathname, useRouter } from "next/navigation";

export default function Navbar() {
  const [dark, setDark] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [user, setUserState] = useState(getUser());
  const [open, setOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [lang, setLang] = useState<"zh" | "en">("zh");

  const router = useRouter();
  const pathname = usePathname();
  const menuRef = useRef<HTMLDivElement | null>(null);



  useEffect(() => {
    const isDark = document.documentElement.classList.contains("dark");
    setDark(isDark);
    setMounted(true);

    const savedLang = localStorage.getItem("siteLang");

    if (savedLang === "en") {
      setLang("en");
    } else {
      setLang("zh");
      localStorage.setItem("siteLang", "zh");
    }

    const onAuthChanged = () => setUserState(getUser());
    window.addEventListener("auth-changed", onAuthChanged);
    return () => window.removeEventListener("auth-changed", onAuthChanged);

  }, []);

  useEffect(() => {
    setOpen(false);
    setMobileMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    const onPointerDown = (e: MouseEvent) => {
      if (!menuRef.current) return;
      if (!menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, []);

  const toggleLang = () => {
    const nextLang = lang === "zh" ? "en" : "zh";
    setLang(nextLang);
    localStorage.setItem("siteLang", nextLang);
  };

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
    setMobileMenuOpen(false);
    router.push("/auth");
  };

  const role = String(user?.roles || "").toLowerCase();
  const isManager = role === "manager";
  const canAccessMaterials = role === "teacher" || role === "manager";
  const avatarText = (user?.username?.[0] || user?.email?.[0] || "U").toUpperCase();

  return (
    <>
      <nav
        className="site-navbar fixed top-0 left-0 right-0 z-[9999] w-full h-14 border-b backdrop-blur-md flex items-center justify-between px-6" style={{
          backgroundColor: "var(--navbar-bg)",
          borderColor: "var(--navbar-border)",
          color: "var(--navbar-text)",
        }}
      >
        <Link href="/" className="navbar-brand flex items-center gap-3">
          <div
            className="navbar-logo w-8 h-8 rounded-full flex items-center justify-center font-bold shrink-0"
            style={{
              backgroundColor: "var(--navbar-logo-bg)",
              color: "var(--navbar-logo-text)",
              fontSize: "18px",
              lineHeight: "1",
            }}
          >
            G
          </div>
          <span className="navbar-title text-base font-semibold">GalaBone</span>
        </Link>

        {/* 桌機版導覽 */}
        <div className="absolute left-1/2 -translate-x-1/2 hidden md:flex items-center gap-5 text-[13px]">
          <Link href="/" className="hover-link">
            <b>{lang === "zh" ? "首頁" : "Home"}</b>
          </Link>
          <Link href="/bonevision" className="hover-link">
            <b>{lang === "zh" ? "骨骼辨識" : "Bone Detection"}</b>
          </Link>
          <Link href="/llm" className="hover-link">
            <b>{lang === "zh" ? "骨骼知識庫" : "Bone Knowledge"}</b>
          </Link>
          <Link href="/model" className="hover-link">
            <b>{lang === "zh" ? "3D 骨骼模型" : "3D Bone Model"}</b>
          </Link>

          {canAccessMaterials && (
            <Link href="/llm/materials" className="hover-link">
              <b>{lang === "zh" ? "教材管理" : "Materials"}</b>
            </Link>
          )}

          {isManager && (
            <Link href="/admin/users" className="hover-link">
              <b>{lang === "zh" ? "帳號管理" : "Account"}</b>
            </Link>
          )}
        </div>

        <div ref={menuRef} className="navbar-actions flex items-center gap-3 relative">
          <button
            type="button"
            onClick={toggleLang}
            aria-label={lang === "zh" ? "切換英文" : "Switch to Chinese"}
            className="hidden md:inline-flex h-8 items-center rounded-full border border-slate-200 bg-white/70 px-3 text-[12px] font-bold tracking-wide text-slate-600 shadow-sm backdrop-blur-md transition hover:border-cyan-300 hover:bg-cyan-50 hover:text-cyan-700 dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-300 dark:hover:border-cyan-400/60 dark:hover:bg-cyan-950/40 dark:hover:text-cyan-200"
          >
            <i className="fa-solid fa-language mr-1.5 text-[12px]" />
            {lang === "zh" ? "EN" : "中"}
          </button>
          
          {mounted && (
            <button
              onClick={toggleTheme}
              aria-label="切換主題"
              className={`navbar-theme-btn
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

          {/* 桌機版帳號按鈕，手機隱藏 */}
          <button
            onClick={() => {
              if (!user) {
                router.push("/auth");
              } else {
                setOpen((v) => !v);
              }
            }}
            className="navbar-user-btn hidden md:flex w-9 h-9 rounded-full items-center justify-center font-bold"
            style={{
              backgroundColor: "var(--navbar-icon-bg)",
              color: "var(--navbar-icon-text)",
            }}
            aria-label={user ? "帳號選單" : "登入"}
            title={user ? (user.username || user.email || "Account") : "登入 / 註冊"}
          >
            {user ? avatarText : <i className="fa-solid fa-user" />}
          </button>

          {/* 手機版漢堡 */}
          <button
            type="button"
            className="navbar-hamburger md:hidden"
            onClick={() => setMobileMenuOpen((v) => !v)}
            aria-label="開啟選單"
            aria-expanded={mobileMenuOpen}
          >
            <i className={`fa-solid ${mobileMenuOpen ? "fa-xmark" : "fa-bars-staggered"}`} />
            {!mobileMenuOpen && (
              <span className="navbar-hamburger-text">
                {lang === "zh" ? "選單" : "Menu"}
              </span>
            )}

          </button>

          {/* 桌機版帳號下拉 */}
          {user && open && (
            <div
              className="absolute right-0 top-12 w-64 rounded-xl border shadow-lg p-3 z-50"
              style={{ background: "var(--card-bg)", borderColor: "var(--card-border)" }}
            >
              <div className="text-sm">
                <div className="font-semibold">{user.username || "未命名使用者"}</div>
                <div className="opacity-80">{user.email}</div>
                <div className="text-xs mt-1 opacity-70">role: {user.roles || "student"}</div>
              </div>

              <div className="mt-3 grid gap-2">
                <button
                  className="rounded-lg border px-3 py-2 text-sm"
                  style={{ borderColor: "var(--card-border)" }}
                  onClick={() => {
                    setOpen(false);
                    router.push("/auth");
                  }}
                >
                  帳戶中心
                </button>

                {canAccessMaterials && (
                  <button
                    className="rounded-lg border px-3 py-2 text-sm"
                    style={{ borderColor: "var(--card-border)" }}
                    onClick={() => {
                      setOpen(false);
                      router.push("/llm/materials");
                    }}
                  >
                    教材管理
                  </button>
                )}

                {isManager && (
                  <button
                    className="rounded-lg border px-3 py-2 text-sm"
                    style={{ borderColor: "var(--card-border)" }}
                    onClick={() => {
                      setOpen(false);
                      router.push("/admin/users");
                    }}
                  >
                    帳號管理
                  </button>
                )}

                <button
                  className="rounded-lg px-3 py-2 text-sm font-semibold"
                  style={{
                    background: "var(--chip-active-bg)",
                    color: "var(--chip-active-text)",
                  }}
                  onClick={onLogout}
                >
                  登出
                </button>
              </div>
            </div>
          )}
        </div>
      </nav>

      {/* 手機版遮罩 */}
      {mobileMenuOpen && (
        <div
          className="mobile-menu-backdrop md:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* 手機版滑出選單 */}
      {/* 手機版滑出選單 */}
      <div className={`mobile-menu-panel md:hidden ${mobileMenuOpen ? "open" : ""}`}>
        <div className="mobile-menu-links">
          {!user && (
            <Link
              href="/auth"
              className="mobile-menu-link"
              onClick={() => setMobileMenuOpen(false)}
            >
              {lang === "zh" ? "登入 / 註冊" : "Login / Register"}
            </Link>
          )}

          {user && (
            <div className="mobile-user-card">
              <div className="mobile-user-head">
                <div className="mobile-user-avatar">{avatarText}</div>
                <div className="mobile-user-meta">
                  <div className="mobile-user-name">
                    {user.username || (lang === "zh" ? "未命名使用者" : "Unnamed User")}
                  </div>
                  <div className="mobile-user-email">{user.email}</div>
                </div>
              </div>

              <div className="mobile-user-actions">
                <button
                  type="button"
                  onClick={() => {
                    setMobileMenuOpen(false);
                    router.push("/auth");
                  }}
                >
                  {lang === "zh" ? "帳戶中心" : "Account Center"}
                </button>

                <button type="button" onClick={onLogout}>
                  {lang === "zh" ? "登出" : "Logout"}
                </button>
              </div>
            </div>
          )}

          <Link href="/" className="mobile-menu-link" onClick={() => setMobileMenuOpen(false)}>
            {lang === "zh" ? "首頁" : "Home"}
          </Link>

          <Link
            href="/bonevision"
            className="mobile-menu-link"
            onClick={() => setMobileMenuOpen(false)}
          >
            {lang === "zh" ? "骨骼辨識" : "Bone Detection"}
          </Link>

          <Link href="/llm" className="mobile-menu-link" onClick={() => setMobileMenuOpen(false)}>
            {lang === "zh" ? "骨骼知識庫" : "Bone Knowledge"}
          </Link>

          <Link
            href="/model"
            className="mobile-menu-link"
            onClick={() => setMobileMenuOpen(false)}
          >
            {lang === "zh" ? "3D 模型" : "3D Model"}
          </Link>

          {canAccessMaterials && (
            <Link
              href="/llm/materials"
              className="mobile-menu-link"
              onClick={() => setMobileMenuOpen(false)}
            >
              {lang === "zh" ? "教材管理" : "Materials"}
            </Link>
          )}

          {isManager && (
            <Link
              href="/admin/users"
              className="mobile-menu-link"
              onClick={() => setMobileMenuOpen(false)}
            >
              {lang === "zh" ? "帳號管理" : "Account"}
            </Link>
          )}
        </div>
      </div>    </>
  );
}