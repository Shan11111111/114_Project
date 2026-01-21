// frontend/app/auth/page.tsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

import {
  apiJSON,
  clearAuth,
  getRefreshToken,
  setTokens,
  setUser,
  type AuthUser,
} from "../lib/auth";

/** =========================
 *  API Base + endpoints (with fallback)
 *  ========================= */
const API_BASE = (process.env.NEXT_PUBLIC_BACKEND_URL || "http://127.0.0.1:8000").replace(/\/+$/, "");

const EP = {
  register: `${API_BASE}/auth/register`,
  login: `${API_BASE}/auth/login`,
  me: `${API_BASE}/auth/me`,
  logout: `${API_BASE}/auth/logout`,
  refresh: `${API_BASE}/auth/refresh`,
  sendVerify: [
    `${API_BASE}/auth/email/send`,
    `${API_BASE}/auth/send-verify`,
    `${API_BASE}/auth/send`,
  ],
  verify: [
    `${API_BASE}/auth/email/verify`,
    `${API_BASE}/auth/verify`,
  ],
};

async function postWithFallback<T>(urls: string[], body: any): Promise<{ url: string; data: T }> {
  let lastErr: any = null;
  for (const url of urls) {
    try {
      const data = await apiJSON<T>(url, { method: "POST", body: JSON.stringify(body) });
      return { url, data };
    } catch (e: any) {
      lastErr = e;
      const msg = String(e?.message || "");
      if (msg.includes("404") || msg.toLowerCase().includes("not found") || msg.includes("Cannot POST")) continue;
      throw e;
    }
  }
  throw lastErr || new Error("No endpoint matched.");
}

/** =========================
 *  Helpers
 *  ========================= */
function cx(...cls: Array<string | false | null | undefined>) {
  return cls.filter(Boolean).join(" ");
}
function utf8BytesLen(s: string) {
  return new TextEncoder().encode(s).length;
}
function truncateUtf8ToBytes(s: string, maxBytes: number) {
  const enc = new TextEncoder();
  const bytes = enc.encode(s);
  if (bytes.length <= maxBytes) return s;
  let lo = 0, hi = s.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2);
    const part = s.slice(0, mid);
    if (enc.encode(part).length <= maxBytes) lo = mid;
    else hi = mid - 1;
  }
  return s.slice(0, lo);
}
function isEmailLike(s: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
}
function passwordScore(pw: string) {
  // 超簡易強度：夠用就好，不要變密碼學論文
  let s = 0;
  if (pw.length >= 8) s += 1;
  if (/[A-Z]/.test(pw)) s += 1;
  if (/[a-z]/.test(pw)) s += 1;
  if (/\d/.test(pw)) s += 1;
  if (/[^A-Za-z0-9]/.test(pw)) s += 1;
  return Math.min(5, s);
}

/** =========================
 *  Small Hook: 3D tilt
 *  ========================= */
function useTilt<T extends HTMLElement>(ref: React.RefObject<T | null>, enabled = true) {
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;

    let raf = 0;
    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width;
      const py = (e.clientY - r.top) / r.height;
      const rx = (0.5 - py) * 7;
      const ry = (px - 0.5) * 10;

      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        el.style.setProperty("--rx", `${rx.toFixed(2)}deg`);
        el.style.setProperty("--ry", `${ry.toFixed(2)}deg`);
        el.style.setProperty("--mx", `${(px * 100).toFixed(2)}%`);
        el.style.setProperty("--my", `${(py * 100).toFixed(2)}%`);
      });
    };

    const onLeave = () => {
      cancelAnimationFrame(raf);
      el.style.setProperty("--rx", `0deg`);
      el.style.setProperty("--ry", `0deg`);
      el.style.setProperty("--mx", `50%`);
      el.style.setProperty("--my", `50%`);
    };

    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerleave", onLeave);
    return () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", onLeave);
      cancelAnimationFrame(raf);
    };
  }, [ref, enabled]);
}

/** =========================
 *  Types
 *  ========================= */
type Mode = "login" | "register" | "verify";
type LoginOut = { access_token: string; refresh_token: string; token_type?: string };
type Role = "user" | "student" | "teacher" | "doctor" | "assistant";

type Flow = {
  registeredEmail?: string;
  verifySentEmail?: string;
  verifiedEmail?: string;
  lastSendAt?: number;
};

const FLOW_KEY = "galabone_auth_flow_v1";

/** =========================
 *  UI atoms
 *  ========================= */
function PillToast({
  toast,
  onClose,
}: {
  toast: { type: "ok" | "err" | "info"; msg: string } | null;
  onClose: () => void;
}) {
  if (!toast) return null;
  return (
    <div className={cx("toast", toast.type)} role="status" aria-live="polite">
      <div className="toastMsg">{toast.msg}</div>
      <button className="toastX" onClick={onClose} aria-label="close">✕</button>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  autoComplete,
  right,
  error,
  ok,
  hint,
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  autoComplete?: string;
  right?: React.ReactNode;
  error?: string | null;
  ok?: boolean;
  hint?: React.ReactNode;
  inputMode?: any;
}) {
  return (
    <div className="f">
      <div className="fTop">
        <div className="lab">{label}</div>
        {ok && !error && <div className="tag ok">OK</div>}
        {error && <div className="tag err">請修正</div>}
      </div>

      <div className={cx("inpWrap", error && "bad", ok && !error && "good")}>
        <input
          className="inp"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          type={type}
          autoComplete={autoComplete}
          inputMode={inputMode}
        />
        {right && <div className="right">{right}</div>}
      </div>

      {error ? <div className="msg err">{error}</div> : hint ? <div className="msg">{hint}</div> : null}
    </div>
  );
}

function SegmentedTabs({
  value,
  onChange,
  a,
  b,
  disabled,
}: {
  value: "login" | "register";
  onChange: (v: "login" | "register") => void;
  a: string;
  b: string;
  disabled?: boolean;
}) {
  return (
    <div className={cx("tabs", disabled && "dis")}>
      <div className={cx("slider", value === "register" && "r")} />
      <button
        className={cx("tab", value === "login" && "on")}
        onClick={() => onChange("login")}
        disabled={disabled}
        type="button"
      >
        {a}
      </button>
      <button
        className={cx("tab", value === "register" && "on")}
        onClick={() => onChange("register")}
        disabled={disabled}
        type="button"
      >
        {b}
      </button>
    </div>
  );
}

function RoleCards({
  value,
  onChange,
  disabled,
}: {
  value: Role;
  onChange: (r: Role) => void;
  disabled?: boolean;
}) {
  const items: Array<{ r: Role; title: string; desc: string; badge?: string }> = [
    { r: "user", title: "user", desc: "一般使用者（預設）" },
    { r: "student", title: "student", desc: "學生/學習用途" },
    { r: "teacher", title: "teacher", desc: "教學/帶課（通常要審核）", badge: "review" },
    { r: "doctor", title: "doctor", desc: "臨床/醫師（通常要審核）", badge: "review" },
    { r: "assistant", title: "assistant", desc: "助教/研究助理" },
  ];
  return (
    <div className="roleGrid">
      {items.map((x) => (
        <button
          key={x.r}
          type="button"
          disabled={disabled}
          className={cx("roleCard", value === x.r && "on")}
          onClick={() => onChange(x.r)}
        >
          <div className="roleHead">
            <div className="roleTitle">{x.title}</div>
            {x.badge && <span className="roleBadge">{x.badge}</span>}
          </div>
          <div className="roleDesc">{x.desc}</div>
        </button>
      ))}
    </div>
  );
}

/** =========================
 *  Main
 *  ========================= */
export default function Page() {
  const router = useRouter();
  const sp = useSearchParams();

  const urlMode = (sp.get("mode") as Mode) || "login";

  const [tab, setTab] = useState<"login" | "register">(urlMode === "register" ? "register" : "login");
  const [verifyOpen, setVerifyOpen] = useState(urlMode === "verify");

  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ type: "ok" | "err" | "info"; msg: string } | null>(null);

  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [role, setRole] = useState<Role>("user");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");

  const [showPw, setShowPw] = useState(false);
  const [showPw2, setShowPw2] = useState(false);

  const [code, setCode] = useState("");
  const [devCodeHint, setDevCodeHint] = useState<string | null>(null);

  const [flow, setFlow] = useState<Flow>({});
  const [shake, setShake] = useState(false);

  const shellRef = useRef<HTMLDivElement>(null);
  useTilt(shellRef, true);

  // sync url -> UI (optional, but nicer)
  useEffect(() => {
    if (urlMode === "verify") setVerifyOpen(true);
    if (urlMode === "register") setTab("register");
    if (urlMode === "login") setTab("login");
  }, [urlMode]);

  // load flow from localStorage
  useEffect(() => {
    try {
      const raw = localStorage.getItem(FLOW_KEY);
      if (raw) setFlow(JSON.parse(raw));
    } catch {}
  }, []);
  // save flow
  useEffect(() => {
    try {
      localStorage.setItem(FLOW_KEY, JSON.stringify(flow));
    } catch {}
  }, [flow]);

  // auto close toast
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4200);
    return () => clearTimeout(t);
  }, [toast]);

  // resend cooldown
  const resendLeft = useMemo(() => {
    const last = flow.lastSendAt ?? 0;
    if (!last) return 0;
    const diff = Math.floor((Date.now() - last) / 1000);
    return Math.max(0, 30 - diff);
  }, [flow.lastSendAt, toast]);

  // validation
  const emailOk = useMemo(() => (email.trim() ? isEmailLike(email) : false), [email]);
  const userOk = useMemo(() => username.trim().length >= 2, [username]);
  const pwBytes = useMemo(() => utf8BytesLen(pw), [pw]);
  const pwTooLong = pwBytes > 72;
  const pwScore = useMemo(() => passwordScore(pw), [pw]);
  const pwOk = useMemo(() => pw.length >= 8 && !pwTooLong, [pw, pwTooLong]);
  const pw2Ok = useMemo(() => pw2.length > 0 && pw2 === pw, [pw2, pw]);

  const registerReady = userOk && emailOk && pwOk && pw2Ok && !busy;
  const loginReady = emailOk && pw.length > 0 && !pwTooLong && !busy;

  function bounceError(msg: string) {
    setToast({ type: "err", msg });
    setShake(true);
    setTimeout(() => setShake(false), 520);
  }

  function goto(mode: Mode) {
    router.push(`/auth?mode=${mode}`);
  }

  function onPwChange(v: string, which: "pw" | "pw2") {
    const clipped = truncateUtf8ToBytes(v, 72);
    if (which === "pw") setPw(clipped);
    else setPw2(clipped);
  }

  const nextHint = useMemo(() => {
    // 右側指引：告訴你下一步
    if (verifyOpen) {
      if (!email.trim()) return { t: "先填 Email", d: "驗證要用 Email 當 key，你空著系統也救不了你。" };
      if (!flow.verifySentEmail) return { t: "先寄驗證碼", d: "按「寄驗證碼」，拿到 6 碼再驗證。" };
      if (flow.verifySentEmail !== email.trim()) return { t: "Email 對不上", d: `你寄到 ${flow.verifySentEmail}，但現在填的是 ${email.trim()}。改回去或重寄。` };
      return { t: "輸入驗證碼", d: "把收到的 6 碼貼上，按「確認驗證」。" };
    }

    if (tab === "register") {
      if (!userOk) return { t: "填 username", d: "至少 2 個字，不然像機器人帳號。" };
      if (!emailOk) return { t: "填有效 Email", d: "要能收信的那種（不然你自己也會迷路）。" };
      if (!pwOk) return { t: "設定密碼", d: pwTooLong ? "太長了（bcrypt 72 bytes 上限）" : "至少 8 碼，混點字母數字更香。" };
      if (!pw2Ok) return { t: "確認密碼", d: "兩次要一致，不然你未來會罵自己。" };
      return { t: "建立帳號", d: "送出後立刻去驗證 Email，流程才算完。" };
    }

    // login
    if (!emailOk) return { t: "填 Email", d: "用你註冊的 Email。" };
    if (!pw) return { t: "填密碼", d: "你密碼沒填我也沒辦法（我不是通靈王）。" };
    return { t: "登入", d: "如果被擋，多半是還沒驗證 Email。" };
  }, [verifyOpen, tab, email, pw, pw2, userOk, emailOk, pwOk, pw2Ok, pwTooLong, flow.verifySentEmail]);

  async function handleRegister() {
    if (!registerReady) {
      bounceError("資料還沒填好，先把紅色的修掉。");
      return;
    }

    setBusy(true);
    setToast(null);

    try {
      const e = email.trim();

      await apiJSON<AuthUser>(EP.register, {
        method: "POST",
        body: JSON.stringify({
          username: username.trim(),
          email: e,
          password: pw,
          role, // ✅ role（後端白名單 + 寫入 DB roles）
        }),
      });

      setFlow((f) => ({ ...f, registeredEmail: e }));
      setToast({ type: "ok", msg: "註冊成功 ✅ 下一步：去驗證 Email（不驗證就不給登入）。" });

      // 直接開驗證 drawer
      setVerifyOpen(true);
      goto("verify");
    } catch (e: any) {
      bounceError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  async function handleLogin() {
    if (!loginReady) {
      bounceError("先把 Email/密碼填好（或密碼太長）。");
      return;
    }

    setBusy(true);
    setToast(null);

    try {
      const e = email.trim();

      const out = await apiJSON<LoginOut>(EP.login, {
        method: "POST",
        body: JSON.stringify({ email: e, password: pw }),
      });

      setTokens(out.access_token, out.refresh_token);

      const me = await apiJSON<AuthUser>(EP.me, {
        method: "GET",
        headers: { Authorization: `Bearer ${out.access_token}` },
      });
      setUser(me);

      // ✅ 新增：把 users.id(int) 存起來，給 S0/S1 用
      const meId = (me as any)?.id ?? (me as any)?.userId ?? null;
      if (typeof meId === "number") {
        localStorage.setItem("galabone_me_id", String(meId));
      } else {
        // 這裡故意不靜默，避免你以為有存到結果根本沒有
        console.warn("[auth] /auth/me 沒回傳 id(int)，無法存 galabone_me_id。me=", me);
      }

      setToast({ type: "ok", msg: "登入成功 ✅" });
      router.push("/");
    } catch (e: any) {
      const msg = String(e?.message || e);
      if (msg.includes("尚未完成") || msg.includes("驗證") || msg.includes("403")) {
        setToast({ type: "info", msg: "你還沒驗證 Email。先驗證，系統才會放行。" });
        setVerifyOpen(true);
        goto("verify");
      } else {
        bounceError(msg);
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleSendVerify() {
    setBusy(true);
    setToast(null);
    setDevCodeHint(null);

    try {
      const e = email.trim();
      if (!e) throw new Error("請先填 Email，才能寄驗證碼。");
      if (!isEmailLike(e)) throw new Error("Email 格式不對（你是要寄到火星嗎）。");

      // 如果已註冊過，防呆：Email 不要亂改
      if (flow.registeredEmail && flow.registeredEmail !== e) {
        throw new Error(`你註冊的是 ${flow.registeredEmail}，但現在填的是 ${e}。請改回註冊 Email 或重新註冊。`);
      }

      const { data, url } = await postWithFallback<any>(EP.sendVerify, { email: e });
      const maybe = (data?.dev_code || data?.code || null) as string | null;
      if (maybe) setDevCodeHint(String(maybe));

      setFlow((f) => ({ ...f, verifySentEmail: e, lastSendAt: Date.now() }));
      setToast({
        type: "ok",
        msg: `驗證碼已送出 ✅（使用 ${url.replace(API_BASE, "")}）`,
      });
    } catch (e: any) {
      bounceError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  async function handleVerify() {
    setBusy(true);
    setToast(null);

    try {
      const e = email.trim();
      if (!e) throw new Error("請先填 Email。");
      if (!flow.verifySentEmail) throw new Error("你還沒寄驗證碼。先寄再驗證。");
      if (flow.verifySentEmail !== e) throw new Error(`你寄碼給 ${flow.verifySentEmail}，但現在填 ${e}。請改回去或重寄。`);
      if (!code.trim()) throw new Error("請輸入驗證碼。");

      const clean = code.replace(/\s+/g, "");
      if (clean.length < 4) throw new Error("驗證碼太短（別亂打）。");

      const { url } = await postWithFallback<any>(EP.verify, { email: e, code: clean });

      setFlow((f) => ({ ...f, verifiedEmail: e }));
      setToast({ type: "ok", msg: `驗證成功 ✅（${url.replace(API_BASE, "")}）現在可以登入了。` });

      setVerifyOpen(false);
      goto("login");
      setTab("login");
    } catch (e: any) {
      bounceError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  async function handleLogout() {
    setBusy(true);
    setToast(null);

    try {
      const rt = getRefreshToken();
      if (rt) {
        await apiJSON<{ ok: boolean }>(EP.logout, {
          method: "POST",
          body: JSON.stringify({ refresh_token: rt }),
        }).catch(() => null);
      }
    } finally {
      clearAuth();
      setBusy(false);
      setToast({ type: "ok", msg: "已登出 ✅" });
      router.push("/");
    }
  }

  function resetFlow() {
    setFlow({});
    setDevCodeHint(null);
    setCode("");
    setToast({ type: "info", msg: "已重置流程狀態（local）" });
    try { localStorage.removeItem(FLOW_KEY); } catch {}
  }

  return (
    <div className="root">
      <div className="bg" aria-hidden="true" />
      <div className="noise" aria-hidden="true" />

      <div className="shell">
        <div className="top">
          <div className="brand">
            <div className="logo">GB</div>
            <div className="brandTxt">
              <div className="name">GalaBone</div>
              <div className="desc">Auth • interactive • modern</div>
            </div>
          </div>

          <div className="topActions">
            <button className="linkBtn" onClick={() => setVerifyOpen(true)}>開啟驗證</button>
            <button className="linkBtn" onClick={resetFlow}>重置流程</button>
            <Link className="linkBtn" href="/">回首頁</Link>
          </div>
        </div>

        <div ref={shellRef} className={cx("card3d", shake && "shake")}>
          <div className="shine" aria-hidden="true" />

          {/* LEFT PANEL */}
          <aside className="leftPane">
            <div className="hero">
              <div className="heroTitle">骨科影像系統入口</div>
              <div className="heroSub">
                這裡是門禁，不是許願池。流程走完你就能進主系統。
              </div>

              <div className="stats">
                <div className="stat">
                  <div className="k">Step</div>
                  <div className="v">{verifyOpen ? "Verify" : tab === "register" ? "Register" : "Login"}</div>
                </div>
                <div className="stat">
                  <div className="k">Email</div>
                  <div className="v">{email.trim() ? (emailOk ? "OK" : "Invalid") : "Empty"}</div>
                </div>
                <div className="stat">
                  <div className="k">Flow</div>
                  <div className="v">
                    {flow.verifiedEmail ? "Verified" : flow.verifySentEmail ? "Code Sent" : flow.registeredEmail ? "Registered" : "New"}
                  </div>
                </div>
              </div>

              <div className="guide">
                <div className="gT">下一步建議</div>
                <div className="gH">{nextHint.t}</div>
                <div className="gD">{nextHint.d}</div>

                <div className="miniSteps">
                  <div className={cx("mini", !!flow.registeredEmail && "on")}>
                    <span className="dot" /> 註冊完成
                  </div>
                  <div className={cx("mini", !!flow.verifySentEmail && "on")}>
                    <span className="dot" /> 已寄驗證碼
                  </div>
                  <div className={cx("mini", !!flow.verifiedEmail && "on")}>
                    <span className="dot" /> 已驗證
                  </div>
                </div>

                <div className="smallNote">
                  小提醒：後端收的是 <b>role</b>，資料庫欄位叫 <b>roles</b> 沒關係，後端映射就好。
                </div>
              </div>

              <div className="leftFoot">
                <button className="ghost" onClick={handleLogout} disabled={busy} title="如果你目前已登入，這顆會登出">
                  我已登入 → 登出
                </button>
                <div className="muted">Dev UI / Demo friendly</div>
              </div>
            </div>
          </aside>

          {/* RIGHT PANEL */}
          <main className="rightPane">
            <div className="paneTop">
              <SegmentedTabs
                value={tab}
                onChange={(v) => {
                  setTab(v);
                  goto(v);
                }}
                a="登入"
                b="註冊"
                disabled={busy}
              />

              <div className="paneMeta">
                <div className="metaChip">
                  <span className={cx("pill", verifyOpen && "on")} />
                  Verify Drawer: {verifyOpen ? "On" : "Off"}
                </div>
              </div>
            </div>

            {/* FORM */}
            {tab === "login" ? (
              <div className="form">
                <div className="h1">登入</div>
                <div className="sub">還沒驗證的帳號會被擋。別怪系統兇，怪流程沒走完。</div>

                <Field
                  label="Email"
                  value={email}
                  onChange={setEmail}
                  placeholder="name@example.com"
                  autoComplete="email"
                  ok={!!email.trim() && emailOk}
                  error={email.trim() && !emailOk ? "Email 格式不正確" : null}
                />

                <Field
                  label="密碼"
                  value={pw}
                  onChange={(v) => onPwChange(v, "pw")}
                  placeholder="輸入密碼"
                  type={showPw ? "text" : "password"}
                  autoComplete="current-password"
                  ok={pw.length > 0 && !pwTooLong}
                  error={pwTooLong ? "密碼超過 72 bytes（bcrypt 上限）" : null}
                  right={
                    <button className="iconBtn" type="button" onClick={() => setShowPw((x) => !x)} title="顯示/隱藏">
                      {showPw ? "🙈" : "👀"}
                    </button>
                  }
                  hint={
                    <span className="hintRow">
                      <span>Bytes: <b>{pwBytes}</b>/72</span>
                      <span className="sep">•</span>
                      <span>強度: <b>{pwScore}/5</b></span>
                    </span>
                  }
                />

                <button className={cx("btn", "primary")} disabled={!loginReady} onClick={handleLogin}>
                  {busy ? <span className="spin" /> : null}
                  {busy ? "登入中…" : "登入"}
                </button>

                <div className="row">
                  <button className="btn soft" disabled={busy} onClick={() => { setTab("register"); goto("register"); }}>
                    沒帳號？去註冊 →
                  </button>
                  <button className="btn soft" disabled={busy} onClick={() => { setVerifyOpen(true); goto("verify"); }}>
                    我想驗證 Email →
                  </button>
                </div>
              </div>
            ) : (
              <div className="form">
                <div className="h1">註冊</div>
                <div className="sub">填完直接進驗證 drawer。你會感覺自己在用真的產品。</div>

                <Field
                  label="使用者名稱"
                  value={username}
                  onChange={setUsername}
                  placeholder="至少 2 個字"
                  autoComplete="username"
                  ok={username.trim().length > 0 && userOk}
                  error={username.trim().length > 0 && !userOk ? "至少 2 個字" : null}
                />

                <div className="block">
                  <div className="blockTop">
                    <div className="lab">角色（role）</div>
                    <div className="msg">後端要白名單：user/student/teacher/doctor/assistant</div>
                  </div>
                  <RoleCards value={role} onChange={setRole} disabled={busy} />
                </div>

                <Field
                  label="Email"
                  value={email}
                  onChange={setEmail}
                  placeholder="name@example.com"
                  autoComplete="email"
                  ok={!!email.trim() && emailOk}
                  error={email.trim() && !emailOk ? "Email 格式不正確" : null}
                />

                <div className="grid2">
                  <Field
                    label="密碼"
                    value={pw}
                    onChange={(v) => onPwChange(v, "pw")}
                    placeholder="至少 8 碼"
                    type={showPw ? "text" : "password"}
                    autoComplete="new-password"
                    ok={pw.length > 0 && pwOk}
                    error={pwTooLong ? "超過 72 bytes（bcrypt 上限）" : pw.length > 0 && pw.length < 8 ? "至少 8 碼" : null}
                    right={
                      <button className="iconBtn" type="button" onClick={() => setShowPw((x) => !x)} title="顯示/隱藏">
                        {showPw ? "🙈" : "👀"}
                      </button>
                    }
                    hint={
                      <span className="hintRow">
                        <span>Bytes: <b>{pwBytes}</b>/72</span>
                        <span className="sep">•</span>
                        <span>強度: <b>{pwScore}/5</b></span>
                      </span>
                    }
                  />

                  <Field
                    label="確認密碼"
                    value={pw2}
                    onChange={(v) => onPwChange(v, "pw2")}
                    placeholder="再打一次"
                    type={showPw2 ? "text" : "password"}
                    autoComplete="new-password"
                    ok={pw2.length > 0 && pw2Ok}
                    error={pw2.length > 0 && !pw2Ok ? "兩次密碼不一致" : null}
                    right={
                      <button className="iconBtn" type="button" onClick={() => setShowPw2((x) => !x)} title="顯示/隱藏">
                        {showPw2 ? "🙈" : "👀"}
                      </button>
                    }
                  />
                </div>

                <button className={cx("btn", "primary")} disabled={!registerReady} onClick={handleRegister}>
                  {busy ? <span className="spin" /> : null}
                  {busy ? "建立中…" : "建立帳號"}
                </button>

                <button
                  className={cx("btn", "softWide")}
                  disabled={busy || !emailOk}
                  onClick={() => { setVerifyOpen(true); goto("verify"); }}
                  title={!emailOk ? "先填正確 Email" : ""}
                >
                  我已註冊/想驗證 → 打開驗證 drawer
                </button>
              </div>
            )}
          </main>

          {/* VERIFY DRAWER */}
          <div className={cx("drawer", verifyOpen && "open")} aria-hidden={!verifyOpen}>
            <div className="drawerHead">
              <div>
                <div className="dTitle">Email 驗證</div>
                <div className="dSub">先寄碼 → 再輸入 → 確認。跳步會被擋（合理）。</div>
              </div>

              <div className="dBtns">
                <button className="btn soft" onClick={() => { setVerifyOpen(false); goto(tab); }} disabled={busy}>
                  收起
                </button>
              </div>
            </div>

            <div className="drawerBody">
              <Field
                label="Email"
                value={email}
                onChange={setEmail}
                placeholder="name@example.com"
                autoComplete="email"
                ok={!!email.trim() && emailOk}
                error={email.trim() && !emailOk ? "Email 格式不正確" : null}
                hint={
                  flow.registeredEmail && flow.registeredEmail !== email.trim() ? (
                    <span className="warn">
                      你註冊的是 <b>{flow.registeredEmail}</b>，建議改回去才不會對不上。
                    </span>
                  ) : (
                    <span>建議用註冊時的 Email。</span>
                  )
                }
              />

              <div className="row3">
                <button className={cx("btn", "ok")} disabled={busy || resendLeft > 0 || !emailOk} onClick={handleSendVerify}>
                  {busy ? <span className="spin" /> : null}
                  {resendLeft > 0 ? `請稍等 ${resendLeft}s` : "寄驗證碼"}
                </button>

                <button
                  className={cx("btn", "soft")}
                  disabled={busy}
                  onClick={() => {
                    setDevCodeHint(null);
                    setCode("");
                    setToast({ type: "info", msg: "已清空驗證碼欄位" });
                  }}
                >
                  清空
                </button>

                <div className="statusLine">
                  狀態：
                  <b>{flow.verifySentEmail ? " 已寄碼" : " 尚未寄碼"}</b>
                  {flow.verifySentEmail ? <span className="muted">（寄到 {flow.verifySentEmail}）</span> : null}
                </div>
              </div>

              {devCodeHint ? (
                <div className="devHint">
                  dev_code：<code>{devCodeHint}</code>
                  <span className="muted">（正式上線要改成寄信，不回傳 code）</span>
                </div>
              ) : null}

              <Field
                label="驗證碼"
                value={code}
                onChange={setCode}
                placeholder="例如：123456"
                inputMode="numeric"
                ok={code.trim().length >= 4}
                error={null}
                hint={<span>貼上 6 碼後按「確認驗證」。</span>}
              />

              <button
                className={cx("btn", "primary")}
                disabled={
                  busy ||
                  !emailOk ||
                  !flow.verifySentEmail ||
                  flow.verifySentEmail !== email.trim() ||
                  code.trim().length < 4
                }
                onClick={handleVerify}
                title={!flow.verifySentEmail ? "請先寄驗證碼" : flow.verifySentEmail !== email.trim() ? "Email 要跟寄碼時一致" : ""}
              >
                {busy ? <span className="spin" /> : null}
                {busy ? "驗證中…" : "確認驗證"}
              </button>

              <div className="drawerTip">
                如果一直說「錯誤或過期」：重寄一次，你可能拿到舊碼。
              </div>
            </div>
          </div>
        </div>

        <PillToast toast={toast} onClose={() => setToast(null)} />
      </div>

      <style jsx global>{`
        .root{
          min-height: calc(100vh - 64px);
          display: grid;
          place-items: center;
          padding: 36px 16px;
          position: relative;
          overflow: hidden;
          background: #0b1220;
          color: rgba(255,255,255,.92);
        }
        .bg{
          position:absolute; inset:-40%;
          background:
            radial-gradient(closest-side at 15% 15%, rgba(56,189,248,.35), transparent 62%),
            radial-gradient(closest-side at 80% 25%, rgba(168,85,247,.26), transparent 58%),
            radial-gradient(closest-side at 40% 85%, rgba(16,185,129,.22), transparent 62%);
          filter: blur(16px);
          animation: floaty 10s ease-in-out infinite alternate;
          opacity: .95;
        }
        .noise{
          position:absolute; inset:0;
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='180' height='180' filter='url(%23n)' opacity='.18'/%3E%3C/svg%3E");
          opacity: .22;
          mix-blend-mode: overlay;
          pointer-events: none;
        }
        @keyframes floaty { from { transform: translate3d(-10px,-12px,0) scale(1); } to { transform: translate3d(14px,10px,0) scale(1.03); } }

        .shell{ width: min(1120px, 100%); position: relative; z-index: 2; }

        .top{
          display:flex; align-items:center; justify-content: space-between; gap: 12px;
          margin-bottom: 14px; flex-wrap: wrap;
        }
        .brand{ display:flex; align-items:center; gap: 12px; }
        .logo{
          width: 44px; height: 44px; border-radius: 14px;
          display:grid; place-items:center;
          background: linear-gradient(135deg, rgba(56,189,248,1), rgba(168,85,247,1));
          box-shadow: 0 16px 50px rgba(0,0,0,.38);
          font-weight: 950; letter-spacing: -0.02em;
        }
        .brandTxt .name{ font-weight: 950; letter-spacing: -0.02em; }
        .brandTxt .desc{ font-size: 12px; opacity: .7; margin-top: 2px; }
        .topActions{ display:flex; gap: 10px; flex-wrap: wrap; }
        .linkBtn{
          border: 1px solid rgba(255,255,255,.14);
          background: rgba(255,255,255,.06);
          color: rgba(255,255,255,.85);
          border-radius: 999px;
          padding: 8px 12px;
          font-size: 12px;
          cursor: pointer;
          transition: transform .12s ease, background .12s ease;
          text-decoration: none;
        }
        .linkBtn:hover{ transform: translateY(-1px); background: rgba(255,255,255,.09); }

        .card3d{
          --rx: 0deg; --ry: 0deg; --mx: 50%; --my: 50%;
          position: relative;
          border-radius: 28px;
          overflow: hidden;
          border: 1px solid rgba(255,255,255,.14);
          background: rgba(255,255,255,.06);
          box-shadow: 0 28px 120px rgba(0,0,0,.55);
          transform: perspective(1200px) rotateX(var(--rx)) rotateY(var(--ry));
          transition: transform .18s ease;
          display: grid;
          grid-template-columns: 420px 1fr;
        }
        .card3d::before{
          content:"";
          position:absolute; inset: -2px;
          background: linear-gradient(135deg,
            rgba(56,189,248,.75),
            rgba(168,85,247,.55),
            rgba(16,185,129,.45)
          );
          opacity: .36;
          filter: blur(14px);
          z-index: 0;
        }
        .shine{
          position:absolute; inset:0;
          background: radial-gradient(900px 420px at var(--mx) var(--my), rgba(255,255,255,.18), transparent 58%);
          mix-blend-mode: overlay;
          pointer-events:none;
          z-index: 0;
        }
        .shake{ animation: shake .52s ease both; }
        @keyframes shake{
          10%, 90% { transform: translateX(-1px); }
          20%, 80% { transform: translateX(2px); }
          30%, 50%, 70% { transform: translateX(-4px); }
          40%, 60% { transform: translateX(4px); }
        }

        .leftPane, .rightPane{ position: relative; z-index: 1; }
        .leftPane{
          padding: 22px;
          background: rgba(255,255,255,.04);
          border-right: 1px solid rgba(255,255,255,.10);
        }
        .heroTitle{ font-size: 18px; font-weight: 950; letter-spacing: -0.02em; }
        .heroSub{ margin-top: 6px; font-size: 12px; opacity: .75; line-height: 1.5; }

        .stats{ display:grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-top: 14px; }
        .stat{
          border: 1px solid rgba(255,255,255,.10);
          background: rgba(255,255,255,.06);
          border-radius: 16px;
          padding: 10px;
        }
        .stat .k{ font-size: 11px; opacity:.7; }
        .stat .v{ margin-top: 6px; font-weight: 950; letter-spacing: -0.02em; }

        .guide{
          margin-top: 14px;
          border: 1px solid rgba(255,255,255,.10);
          background: rgba(0,0,0,.18);
          border-radius: 18px;
          padding: 12px;
        }
        .gT{ font-size: 11px; opacity:.75; }
        .gH{ margin-top: 8px; font-weight: 950; letter-spacing: -0.02em; }
        .gD{ margin-top: 6px; font-size: 12px; opacity: .76; line-height: 1.55; }

        .miniSteps{ margin-top: 10px; display:flex; flex-direction: column; gap: 8px; }
        .mini{ display:flex; align-items:center; gap: 8px; font-size: 12px; opacity: .72; }
        .mini .dot{ width: 10px; height: 10px; border-radius: 999px; background: rgba(255,255,255,.22); }
        .mini.on{ opacity: 1; }
        .mini.on .dot{ background: rgba(16,185,129,1); box-shadow: 0 0 0 6px rgba(16,185,129,.12); }

        .smallNote{ margin-top: 10px; font-size: 12px; opacity:.7; line-height: 1.5; }

        .leftFoot{ margin-top: 14px; display:flex; justify-content: space-between; align-items:center; gap: 10px; }
        .muted{ opacity:.65; font-size: 12px; }

        .rightPane{ padding: 22px; background: rgba(255,255,255,.03); }
        .paneTop{ display:flex; justify-content: space-between; align-items:center; gap: 12px; flex-wrap: wrap; }
        .paneMeta{ display:flex; gap: 10px; flex-wrap: wrap; }
        .metaChip{
          border: 1px solid rgba(255,255,255,.10);
          background: rgba(255,255,255,.05);
          border-radius: 999px;
          padding: 8px 10px;
          font-size: 12px;
          opacity: .85;
          display:flex; gap: 10px; align-items:center;
        }
        .pill{ width: 10px; height: 10px; border-radius: 999px; background: rgba(255,255,255,.25); }
        .pill.on{ background: rgba(56,189,248,1); box-shadow: 0 0 0 6px rgba(56,189,248,.14); }

        .tabs{
          position: relative;
          display:flex;
          border-radius: 999px;
          border: 1px solid rgba(255,255,255,.12);
          background: rgba(255,255,255,.06);
          overflow: hidden;
        }
        .tabs.dis{ opacity: .65; pointer-events: none; }
        .tab{
          width: 140px;
          padding: 10px 12px;
          font-weight: 950;
          color: rgba(255,255,255,.78);
          background: transparent;
          border: 0;
          cursor:pointer;
          position: relative;
          z-index: 1;
        }
        .tab.on{ color: rgba(0,0,0,.92); }
        .slider{
          position:absolute; inset: 3px;
          width: calc(50% - 3px);
          border-radius: 999px;
          background: rgba(255,255,255,.90);
          transition: transform .18s ease;
        }
        .slider.r{ transform: translateX(100%); }

        .form{ margin-top: 16px; }
        .h1{ font-size: 26px; font-weight: 950; letter-spacing: -0.02em; }
        .sub{ margin-top: 6px; font-size: 12px; opacity: .75; line-height: 1.55; }

        .f{ margin-top: 14px; }
        .fTop{ display:flex; gap: 10px; align-items:center; justify-content: space-between; }
        .lab{ font-size: 12px; font-weight: 900; opacity: .85; }
        .tag{
          font-size: 11px;
          padding: 4px 10px;
          border-radius: 999px;
          border: 1px solid rgba(255,255,255,.14);
          opacity: .9;
        }
        .tag.ok{ background: rgba(16,185,129,.20); border-color: rgba(16,185,129,.35); }
        .tag.err{ background: rgba(220,38,38,.18); border-color: rgba(220,38,38,.35); }

        .inpWrap{
          margin-top: 8px;
          border-radius: 18px;
          border: 1px solid rgba(255,255,255,.12);
          background: rgba(255,255,255,.06);
          display:flex;
          align-items:center;
          overflow: hidden;
          transition: box-shadow .15s ease, border-color .15s ease;
        }
        .inpWrap:focus-within{ box-shadow: 0 0 0 3px rgba(56,189,248,.18); border-color: rgba(56,189,248,.35); }
        .inpWrap.bad{ border-color: rgba(220,38,38,.45); box-shadow: 0 0 0 3px rgba(220,38,38,.12); }
        .inpWrap.good{ border-color: rgba(16,185,129,.45); box-shadow: 0 0 0 3px rgba(16,185,129,.12); }

        .inp{
          flex:1;
          padding: 12px 14px;
          border: 0;
          outline: none;
          color: rgba(255,255,255,.90);
          background: transparent;
          font-size: 14px;
        }
        .inp::placeholder{ color: rgba(255,255,255,.35); }
        .right{ padding-right: 10px; display:flex; align-items:center; }
        .iconBtn{
          border: 0;
          background: rgba(255,255,255,.10);
          color: rgba(255,255,255,.92);
          border-radius: 12px;
          padding: 8px 10px;
          cursor:pointer;
          transition: transform .12s ease;
        }
        .iconBtn:hover{ transform: translateY(-1px); }

        .msg{ margin-top: 8px; font-size: 12px; opacity: .72; }
        .msg.err{ color: rgba(252,165,165,1); opacity: 1; }
        .warn{ color: rgba(253,224,71,1); }
        .hintRow{ display:inline-flex; gap: 10px; align-items:center; flex-wrap: wrap; }
        .sep{ opacity:.4; }

        .block{ margin-top: 14px; }
        .blockTop{ display:flex; justify-content: space-between; gap: 12px; align-items: baseline; flex-wrap: wrap; }

        .roleGrid{
          margin-top: 10px;
          display:grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 10px;
        }
        .roleCard{
          text-align:left;
          border-radius: 16px;
          border: 1px solid rgba(255,255,255,.12);
          background: rgba(255,255,255,.06);
          padding: 10px;
          cursor:pointer;
          transition: transform .12s ease, box-shadow .12s ease, border-color .12s ease;
          color: rgba(255,255,255,.88);
        }
        .roleCard:hover{ transform: translateY(-1px); box-shadow: 0 14px 40px rgba(0,0,0,.25); }
        .roleCard.on{ border-color: rgba(56,189,248,.55); box-shadow: 0 0 0 3px rgba(56,189,248,.16); }
        .roleHead{ display:flex; justify-content: space-between; align-items:center; gap: 10px; }
        .roleTitle{ font-weight: 950; letter-spacing: -0.02em; }
        .roleBadge{
          font-size: 11px;
          padding: 3px 8px;
          border-radius: 999px;
          background: rgba(253,224,71,.20);
          border: 1px solid rgba(253,224,71,.35);
          color: rgba(255,255,255,.9);
        }
        .roleDesc{ margin-top: 6px; font-size: 12px; opacity: .72; line-height: 1.45; }

        .grid2{
          display:grid;
          grid-template-columns: 1fr 1fr;
          gap: 12px;
        }

        .btn{
          margin-top: 14px;
          width: 100%;
          border-radius: 18px;
          border: 1px solid rgba(255,255,255,.14);
          padding: 12px 14px;
          font-weight: 950;
          cursor:pointer;
          display:inline-flex;
          gap: 10px;
          align-items:center;
          justify-content:center;
          transition: transform .12s ease, box-shadow .12s ease, opacity .12s ease;
          user-select:none;
        }
        .btn:disabled{ opacity: .55; cursor: not-allowed; }
        .btn:hover:not(:disabled){ transform: translateY(-1px); box-shadow: 0 14px 50px rgba(0,0,0,.30); }

        .primary{
          background: linear-gradient(135deg, rgba(56,189,248,1), rgba(168,85,247,1));
          border-color: rgba(56,189,248,.35);
          color: rgba(0,0,0,.92);
        }
        .soft{
          background: rgba(255,255,255,.06);
          color: rgba(255,255,255,.90);
        }
        .softWide{
          background: rgba(16,185,129,.12);
          border-color: rgba(16,185,129,.22);
          color: rgba(255,255,255,.92);
        }
        .ok{
          background: rgba(16,185,129,1);
          border-color: rgba(16,185,129,1);
          color: rgba(0,0,0,.90);
        }
        .ghost{
          background: rgba(255,255,255,.06);
          border: 1px solid rgba(255,255,255,.12);
          color: rgba(255,255,255,.88);
          border-radius: 14px;
          padding: 10px 12px;
          cursor: pointer;
          font-weight: 900;
        }

        .row{
          margin-top: 10px;
          display:grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
        }

        .spin{
          width: 16px; height: 16px;
          border-radius: 999px;
          border: 2px solid rgba(255,255,255,.55);
          border-top-color: rgba(0,0,0,.55);
          animation: sp .8s linear infinite;
        }
        @keyframes sp{ to { transform: rotate(360deg); } }

        /* Drawer */
        .drawer{
          position:absolute;
          right: 0; top: 0; bottom: 0;
          width: 420px;
          background: rgba(10,16,30,.88);
          border-left: 1px solid rgba(255,255,255,.12);
          transform: translateX(100%);
          transition: transform .22s ease;
          z-index: 5;
          display:flex;
          flex-direction: column;
        }
        .drawer.open{ transform: translateX(0); }
        .drawerHead{
          padding: 16px;
          border-bottom: 1px solid rgba(255,255,255,.10);
          display:flex;
          justify-content: space-between;
          gap: 12px;
          align-items: flex-start;
        }
        .dTitle{ font-weight: 950; letter-spacing: -0.02em; }
        .dSub{ margin-top: 4px; font-size: 12px; opacity: .72; line-height: 1.5; }
        .drawerBody{ padding: 16px; overflow: auto; }
        .row3{ margin-top: 12px; display:flex; gap: 10px; flex-wrap: wrap; align-items:center; }
        .statusLine{ font-size: 12px; opacity: .78; }
        .devHint{
          margin-top: 10px;
          border-radius: 16px;
          border: 1px solid rgba(255,255,255,.10);
          background: rgba(255,255,255,.06);
          padding: 10px;
          font-size: 12px;
          display:flex;
          gap: 10px;
          align-items:center;
          flex-wrap: wrap;
        }
        .devHint code{
          padding: 6px 10px;
          border-radius: 999px;
          background: rgba(255,255,255,.10);
          font-weight: 950;
        }
        .drawerTip{ margin-top: 10px; font-size: 12px; opacity: .75; }

        /* Toast */
        .toast{
          position: fixed;
          left: 50%;
          bottom: 22px;
          transform: translateX(-50%);
          width: min(860px, calc(100% - 28px));
          border-radius: 18px;
          border: 1px solid rgba(255,255,255,.12);
          background: rgba(0,0,0,.55);
          backdrop-filter: blur(10px);
          padding: 12px 14px;
          display:flex;
          justify-content: space-between;
          gap: 10px;
          align-items:center;
          z-index: 9999;
          box-shadow: 0 20px 90px rgba(0,0,0,.45);
        }
        .toast.ok{ border-color: rgba(16,185,129,.35); }
        .toast.err{ border-color: rgba(220,38,38,.35); }
        .toast.info{ border-color: rgba(56,189,248,.35); }
        .toastMsg{ font-size: 13px; opacity: .92; }
        .toastX{
          border: 0;
          background: rgba(255,255,255,.10);
          color: rgba(255,255,255,.92);
          border-radius: 12px;
          padding: 8px 10px;
          cursor:pointer;
        }

        @media (max-width: 1080px){
          .card3d{ grid-template-columns: 1fr; }
          .leftPane{ border-right: 0; border-bottom: 1px solid rgba(255,255,255,.10); }
          .drawer{ width: min(520px, 100%); }
          .grid2{ grid-template-columns: 1fr; }
          .roleGrid{ grid-template-columns: 1fr; }
          .row{ grid-template-columns: 1fr; }
        }
      `}</style>
    </div>
  );
}
