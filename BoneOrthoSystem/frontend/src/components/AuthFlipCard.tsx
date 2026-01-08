"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence, useMotionValue, useSpring } from "framer-motion";

/** =========================
 *  API Base
 *  ========================= */
const API_BASE = (process.env.NEXT_PUBLIC_BACKEND_URL || "http://127.0.0.1:8000").replace(/\/+$/, "");
const API = {
  register: `${API_BASE}/auth/register`,
  login: `${API_BASE}/auth/login`,
  me: `${API_BASE}/auth/me`,
  logout: `${API_BASE}/auth/logout`,
};

type Mode = "login" | "register";

type UserOut = {
  user_id: string;
  username?: string | null;
  email?: string | null;
  roles?: string | null;
  states?: string | null;
};

type TokenOut = {
  access_token: string;
  refresh_token: string;
  token_type: "bearer";
};

const LS = {
  access: "access_token",
  refresh: "refresh_token",
};

function setTokens(t: TokenOut) {
  localStorage.setItem(LS.access, t.access_token);
  localStorage.setItem(LS.refresh, t.refresh_token);
}
function clearTokens() {
  localStorage.removeItem(LS.access);
  localStorage.removeItem(LS.refresh);
}
function getAccess() {
  return localStorage.getItem(LS.access) || "";
}
function getRefresh() {
  return localStorage.getItem(LS.refresh) || "";
}

async function apiJson<T>(url: string, body?: any, accessToken?: string): Promise<T> {
  const res = await fetch(url, {
    method: body ? "POST" : "GET",
    headers: {
      "Content-Type": "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!res.ok) {
    const detail = data?.detail || data?.error || res.statusText || "Request failed";
    throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
  }
  return data as T;
}

/** =========================
 *  Main Component
 *  ========================= */
export default function AuthFlipCard() {
  const [mode, setMode] = useState<Mode>("login");
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  // auth state
  const [user, setUser] = useState<UserOut | null>(null);
  const isAuthed = !!user;

  // forms
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPw, setLoginPw] = useState("");

  const [regName, setRegName] = useState("");
  const [regEmail, setRegEmail] = useState("");
  const [regPw, setRegPw] = useState("");

  // 3D flip (rotateY)
  const rotateY = useSpring(mode === "login" ? 0 : 180, { stiffness: 220, damping: 26 });

  // swipe/drag helper
  const dragX = useMotionValue(0);
  const dragXS = useSpring(dragX, { stiffness: 350, damping: 30 });

  // top drawer (logout)
  const DRAWER_H = 140;
  const drawerY = useMotionValue(-DRAWER_H);
  const drawerYS = useSpring(drawerY, { stiffness: 260, damping: 28 });

  // bottom handle visibility
  const [drawerOpen, setDrawerOpen] = useState(false);

  const safeSetHint = (m: string) => {
    setHint(m);
    window.setTimeout(() => setHint(null), 2500);
  };

  // bootstrap: check /me
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const token = getAccess();
      if (!token) return;
      try {
        const me = await apiJson<UserOut>(API.me, undefined, token);
        if (!cancelled) setUser(me);
      } catch {
        // token invalid/expired
        clearTokens();
        if (!cancelled) setUser(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // lock drawer when logged out
  useEffect(() => {
    if (!isAuthed) {
      setDrawerOpen(false);
      drawerY.set(-DRAWER_H);
    }
  }, [isAuthed]);

  const flipHint = useMemo(() => {
    return mode === "login" ? "→ 右滑翻到註冊" : "← 左滑翻回登入";
  }, [mode]);

  const onSwipeEnd = (_: any, info: { offset: { x: number } }) => {
    const dx = info.offset.x;
    // 右翻 -> 註冊；左翻 -> 登入
    if (dx > 80) setMode("register");
    if (dx < -80) setMode("login");
    dragX.set(0);
  };

  const doRegister = async () => {
    setBusy(true);
    try {
      await apiJson<UserOut>(API.register, { username: regName, email: regEmail, password: regPw });
      safeSetHint("註冊成功 ✅ 現在去登入");
      setMode("login");
      setLoginEmail(regEmail);
      setLoginPw(regPw);
    } catch (e: any) {
      safeSetHint(`註冊失敗：${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  const doLogin = async () => {
    setBusy(true);
    try {
      const t = await apiJson<TokenOut>(API.login, { email: loginEmail, password: loginPw });
      setTokens(t);
      const me = await apiJson<UserOut>(API.me, undefined, t.access_token);
      setUser(me);
      safeSetHint(`登入成功 ✅ Hi ${me.username || "user"}`);
    } catch (e: any) {
      safeSetHint(`登入失敗：${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  const doLogout = async () => {
    setBusy(true);
    try {
      const rt = getRefresh();
      if (rt) {
        await apiJson<{ ok: boolean }>(API.logout, { refresh_token: rt });
      }
    } catch {
      // 就算後端說無效，也照樣清掉本地 token（登出體驗優先）
    } finally {
      clearTokens();
      setUser(null);
      setDrawerOpen(false);
      drawerY.set(-DRAWER_H);
      setBusy(false);
      safeSetHint("已登出 👋");
    }
  };

  const toggleDrawer = () => {
    if (!isAuthed) return;
    const next = !drawerOpen;
    setDrawerOpen(next);
    drawerY.set(next ? 0 : -DRAWER_H);
  };

  return (
    <div className="min-h-[100dvh] w-full flex items-center justify-center p-6">
      {/* 背景：你之後可換成更猛的漸變 */}
      <div className="fixed inset-0 -z-10 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950" />
      <div className="fixed inset-0 -z-10 opacity-40 bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.14),transparent_45%),radial-gradient(circle_at_70%_60%,rgba(255,255,255,0.10),transparent_50%)]" />

      {/* Top pull-down drawer (logout) */}
      <AnimatePresence>
        {isAuthed && (
          <motion.div
            className="fixed top-0 left-0 right-0 z-50"
            style={{ y: drawerYS }}
            initial={{ y: -DRAWER_H }}
            exit={{ y: -DRAWER_H }}
          >
            <div className="mx-auto max-w-xl px-4 pt-3">
              <motion.div
                className="rounded-2xl border border-white/10 bg-black/40 backdrop-blur-xl shadow-2xl overflow-hidden"
                style={{ height: DRAWER_H }}
                drag="y"
                dragConstraints={{ top: -DRAWER_H, bottom: 0 }}
                dragElastic={0.12}
                onDragEnd={(_, info) => {
                  // 放手決定收合/展開
                  const y = info.point.y;
                  // 這裡用更簡單：看 drawerY 現在位置
                  const current = drawerY.get();
                  const open = current > -DRAWER_H / 2;
                  setDrawerOpen(open);
                  drawerY.set(open ? 0 : -DRAWER_H);
                }}
              >
                <div className="p-4 flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="text-sm text-white/70">已登入</div>
                    <div className="text-white font-semibold truncate">
                      {user?.username || "User"} <span className="text-white/50">({user?.email || "no-email"})</span>
                    </div>
                    <div className="text-xs text-white/50 mt-1">roles: {user?.roles || "user"} / states: {user?.states || "active"}</div>
                  </div>

                  <button
                    disabled={busy}
                    onClick={doLogout}
                    className="shrink-0 rounded-xl px-4 py-2 text-sm font-semibold
                               bg-white text-black hover:bg-white/90 active:scale-[0.98]
                               disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    登出
                  </button>
                </div>

                <div className="px-4 pb-3 text-xs text-white/40 flex items-center justify-center gap-2">
                  <span>下拉顯示 / 上推收合</span>
                  <span className="inline-block h-1 w-10 rounded-full bg-white/15" />
                </div>
              </motion.div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Card */}
      <div className="w-full max-w-xl">
        <div className="mb-4 flex items-center justify-between text-white/70 text-sm">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-2 w-2 rounded-full bg-emerald-400/80" />
            <span>{isAuthed ? "已登入" : "未登入"}</span>
          </div>
          <div className="text-white/60">{flipHint}</div>
        </div>

        {/* Flip Stage */}
        <div
          className="relative"
          style={{
            perspective: 1200,
          }}
        >
          <motion.div
            className="relative w-full"
            style={{
                rotateY,
                rotateZ: dragXS,            // ✅ 放這裡
                transformStyle: "preserve-3d",
            }}
            drag="x"
            dragElastic={0.18}
            dragConstraints={{ left: 0, right: 0 }}
            onDragEnd={onSwipeEnd}
            onDrag={(_, info) => {
                const tilt = Math.max(-24, Math.min(24, info.offset.x / 12));
                dragX.set(tilt);
            }}
            onDragStart={() => setHint(null)}
            transition={{ type: "spring", stiffness: 240, damping: 24 }}
            >

            {/* Front: Login */}
            <div
              className="absolute inset-0"
              style={{
                backfaceVisibility: "hidden",
              }}
            >
              <CardShell
                title="登入"
                subtitle="左滑回登入 / 右滑去註冊"
                hint={hint}
              >
                <Label>信箱</Label>
                <Input
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                  placeholder="test_user@example.com"
                />

                <Label className="mt-3">密碼</Label>
                <Input
                  value={loginPw}
                  onChange={(e) => setLoginPw(e.target.value)}
                  placeholder="Passw0rd!123"
                  type="password"
                />

                <div className="mt-5 flex items-center gap-3">
                  <button
                    disabled={busy}
                    onClick={doLogin}
                    className="flex-1 rounded-xl px-4 py-3 font-semibold
                               bg-emerald-400 text-black hover:bg-emerald-300 active:scale-[0.99]
                               disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {busy ? "處理中…" : "登入"}
                  </button>

                  <button
                    type="button"
                    onClick={() => setMode("register")}
                    className="rounded-xl px-4 py-3 font-semibold
                               bg-white/10 text-white hover:bg-white/15 active:scale-[0.99]"
                  >
                    去註冊 →
                  </button>
                </div>
              </CardShell>
            </div>

            {/* Back: Register */}
            <div
              className="absolute inset-0"
              style={{
                transform: "rotateY(180deg)",
                backfaceVisibility: "hidden",
              }}
            >
              <CardShell
                title="註冊"
                subtitle="右翻進註冊 / 左翻回登入"
                hint={hint}
              >
                <Label>使用者名稱</Label>
                <Input
                  value={regName}
                  onChange={(e) => setRegName(e.target.value)}
                  placeholder="test_user"
                />

                <Label className="mt-3">信箱</Label>
                <Input
                  value={regEmail}
                  onChange={(e) => setRegEmail(e.target.value)}
                  placeholder="test_user@example.com"
                />

                <Label className="mt-3">密碼（請避免超長，bcrypt 限制 72 bytes）</Label>
                <Input
                  value={regPw}
                  onChange={(e) => setRegPw(e.target.value)}
                  placeholder="Passw0rd!123"
                  type="password"
                />

                <div className="mt-5 flex items-center gap-3">
                  <button
                    disabled={busy}
                    onClick={doRegister}
                    className="flex-1 rounded-xl px-4 py-3 font-semibold
                               bg-sky-400 text-black hover:bg-sky-300 active:scale-[0.99]
                               disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {busy ? "處理中…" : "註冊"}
                  </button>

                  <button
                    type="button"
                    onClick={() => setMode("login")}
                    className="rounded-xl px-4 py-3 font-semibold
                               bg-white/10 text-white hover:bg-white/15 active:scale-[0.99]"
                  >
                    ← 回登入
                  </button>
                </div>
              </CardShell>
            </div>

            {/* height holder */}
            <div className="invisible">
              <CardShell title="holder" subtitle="holder" hint={null}>
                <div style={{ height: 280 }} />
              </CardShell>
            </div>
          </motion.div>
        </div>

        {/* Bottom small handle button (only when logged in) */}
        <AnimatePresence>
          {isAuthed && (
            <motion.div
              className="mt-6 flex justify-center"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
            >
              <button
                onClick={toggleDrawer}
                className="group inline-flex items-center gap-2 rounded-full px-4 py-2
                           bg-white/10 text-white/80 hover:bg-white/15 active:scale-[0.98]
                           border border-white/10"
              >
                <span className="text-xs">{drawerOpen ? "收合" : "下拉登出"}</span>
                <span className="inline-block h-1 w-8 rounded-full bg-white/20 group-hover:bg-white/30" />
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Guard text when logged out */}
        {!isAuthed && (
          <div className="mt-6 text-center text-xs text-white/40">
            未登入時：不顯示登出按鈕，也不允許下拉。
          </div>
        )}
      </div>
    </div>
  );
}

/** =========================
 *  UI Bits
 *  ========================= */
function CardShell({
  title,
  subtitle,
  hint,
  children,
}: {
  title: string;
  subtitle: string;
  hint: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-3xl border border-white/10 bg-black/35 backdrop-blur-xl shadow-2xl overflow-hidden">
      <div className="px-6 pt-6 pb-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-white text-2xl font-bold tracking-tight">{title}</div>
            <div className="text-white/55 text-sm mt-1">{subtitle}</div>
          </div>
          <div className="text-xs text-white/45 px-3 py-1 rounded-full border border-white/10 bg-white/5">
            翻書模式
          </div>
        </div>

        <AnimatePresence>
          {hint && (
            <motion.div
              className="mt-4 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/80"
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
            >
              {hint}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="px-6 pb-6">{children}</div>
    </div>
  );
}

function Label({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`text-sm text-white/70 ${className}`}>{children}</div>;
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`mt-2 w-full rounded-xl px-4 py-3 outline-none
                  bg-white/5 border border-white/10 text-white placeholder:text-white/30
                  focus:border-white/25 focus:bg-white/7 transition`}
    />
  );
}
