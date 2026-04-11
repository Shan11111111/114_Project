"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";

import {
  apiJSON,
  clearAuth,
  getRefreshToken,
  setTokens,
  setUser,
  type AuthUser,
} from "../lib/auth";

import "./auth.css";

/** =========================
 *  API Base + endpoints (with fallback)
 *  ========================= */
const API_BASE = (
  process.env.NEXT_PUBLIC_BACKEND_URL || "http://127.0.0.1:8000"
).replace(/\/+$/, "");

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
  verify: [`${API_BASE}/auth/email/verify`, `${API_BASE}/auth/verify`],
};

async function postWithFallback<T>(
  urls: string[],
  body: any
): Promise<{ url: string; data: T }> {
  let lastErr: any = null;

  for (const url of urls) {
    try {
      const data = await apiJSON<T>(url, {
        method: "POST",
        body: JSON.stringify(body),
      });
      return { url, data };
    } catch (e: any) {
      lastErr = e;
      const msg = String(e?.message || "");
      if (
        msg.includes("404") ||
        msg.toLowerCase().includes("not found") ||
        msg.includes("Cannot POST")
      ) {
        continue;
      }
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

  let lo = 0;
  let hi = s.length;

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
function useTilt<T extends HTMLElement>(
  ref: React.RefObject<T | null>,
  enabled = true
) {
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
      el.style.setProperty("--rx", "0deg");
      el.style.setProperty("--ry", "0deg");
      el.style.setProperty("--mx", "50%");
      el.style.setProperty("--my", "50%");
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

type LoginOut = {
  access_token: string;
  refresh_token: string;
  token_type?: string;
};

type Role = "manager" | "student" | "teacher" | "doctor" | "assistant";

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
      <button className="toastX" onClick={onClose} aria-label="close">
        ✕
      </button>
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
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
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

      {error ? (
        <div className="msg err">{error}</div>
      ) : hint ? (
        <div className="msg">{hint}</div>
      ) : null}
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
  const items: Array<{
    r: Role;
    title: string;
    desc: string;
    badge?: string;
  }> = [
    { r: "student", title: "student", desc: "學生/學習用途" },
    {
      r: "teacher",
      title: "teacher",
      desc: "教學/帶課（未來要審核）",
      badge: "review",
    },
    {
      r: "doctor",
      title: "doctor",
      desc: "專業醫療人員/醫師（未來要審核）",
      badge: "review",
    },
    {
      r: "assistant",
      title: "assistant",
      desc: "研究人員/專題成員/研究助理",
    },
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
export default function AuthPageClient() {
  const router = useRouter();
  const sp = useSearchParams();

  const urlMode = (sp.get("mode") as Mode) || "login";

  const [tab, setTab] = useState<"login" | "register">(
    urlMode === "register" ? "register" : "login"
  );
  const [verifyOpen, setVerifyOpen] = useState(urlMode === "verify");

  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{
    type: "ok" | "err" | "info";
    msg: string;
  } | null>(null);

  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [role, setRole] = useState<Role>("student");
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

  useEffect(() => {
    if (urlMode === "verify") setVerifyOpen(true);
    if (urlMode === "register") setTab("register");
    if (urlMode === "login") setTab("login");
  }, [urlMode]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(FLOW_KEY);
      if (raw) setFlow(JSON.parse(raw));
    } catch {}
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(FLOW_KEY, JSON.stringify(flow));
    } catch {}
  }, [flow]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4200);
    return () => clearTimeout(t);
  }, [toast]);

  const resendLeft = useMemo(() => {
    const last = flow.lastSendAt ?? 0;
    if (!last) return 0;
    const diff = Math.floor((Date.now() - last) / 1000);
    return Math.max(0, 30 - diff);
  }, [flow.lastSendAt, toast]);

  const emailOk = useMemo(
    () => (email.trim() ? isEmailLike(email) : false),
    [email]
  );
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
    if (verifyOpen) {
      if (!email.trim()) {
        return {
          t: "先填 Email",
          d: "驗證要用 Email 當 key，你空著系統也救不了你。",
        };
      }
      if (!flow.verifySentEmail) {
        return { t: "先寄驗證碼", d: "按「寄驗證碼」，拿到 6 碼再驗證。" };
      }
      if (flow.verifySentEmail !== email.trim()) {
        return {
          t: "Email 對不上",
          d: `你寄到 ${flow.verifySentEmail}，但現在填的是 ${email.trim()}。改回去或重寄。`,
        };
      }
      return {
        t: "輸入驗證碼",
        d: "把收到的 6 碼貼上，按「確認驗證」。",
      };
    }

    if (tab === "register") {
      if (!userOk) {
        return {
          t: "填暱稱",
          d: "至少 2 個字以上。",
        };
      }
      if (!emailOk) {
        return {
          t: "請填有效 Email",
          d: "請先填能收信的那種，後續開通寄信服務才能繼續使用。",
        };
      }
      if (!pwOk) {
        return {
          t: "設定密碼",
          d: pwTooLong
            ? "太長了（bcrypt 72 字元 上限）"
            : "至少 8 字元，混點字母數字更香。",
        };
      }
      if (!pw2Ok) {
        return {
          t: "確認密碼",
          d: "兩次要一致，如果之後忘記密碼，請聯繫我們。",
        };
      }
      return {
        t: "建立帳號",
        d: "送出後立刻去驗證 Email，流程才算完成。",
      };
    }

    if (!emailOk) return { t: "填 Email", d: "用你註冊的 Email。" };
    if (!pw) return { t: "填密碼", d: "你密碼沒填我也沒辦法讓你通過。" };
    return { t: "登入", d: "如果被擋，多半是還沒驗證 Email。" };
  }, [
    verifyOpen,
    tab,
    email,
    pw,
    userOk,
    emailOk,
    pwOk,
    pw2Ok,
    pwTooLong,
    flow.verifySentEmail,
  ]);

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
          role,
        }),
      });

      setFlow((f) => ({ ...f, registeredEmail: e }));
      setToast({
        type: "ok",
        msg: "註冊成功 ✅ 下一步：去驗證 Email（不驗證就不給登入）。",
      });

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

      const meId = (me as any)?.id ?? (me as any)?.userId ?? null;
      if (typeof meId === "number") {
        localStorage.setItem("galabone_me_id", String(meId));
      }

      setToast({ type: "ok", msg: "登入成功 ✅" });
      router.push("/");
    } catch (e: any) {
      const msg = String(e?.message || e);
      if (msg.includes("尚未完成") || msg.includes("驗證") || msg.includes("403")) {
        setToast({
          type: "info",
          msg: "你還沒驗證 Email。先驗證，系統才會放行。",
        });
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

      if (flow.registeredEmail && flow.registeredEmail !== e) {
        throw new Error(
          `你註冊的是 ${flow.registeredEmail}，但現在填的是 ${e}。請改回註冊 Email 或重新註冊。`
        );
      }

      const { data, url } = await postWithFallback<any>(EP.sendVerify, {
        email: e,
      });
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
      if (flow.verifySentEmail !== e) {
        throw new Error(
          `你寄碼給 ${flow.verifySentEmail}，但現在填 ${e}。請改回去或重寄。`
        );
      }
      if (!code.trim()) throw new Error("請輸入驗證碼。");

      const clean = code.replace(/\s+/g, "");
      if (clean.length < 4) throw new Error("驗證碼太短（別亂打）。");

      const { url } = await postWithFallback<any>(EP.verify, {
        email: e,
        code: clean,
      });

      setFlow((f) => ({ ...f, verifiedEmail: e }));
      setToast({
        type: "ok",
        msg: `驗證成功 ✅（${url.replace(API_BASE, "")}）現在可以登入了。`,
      });

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
    try {
      localStorage.removeItem(FLOW_KEY);
    } catch {}
  }

  return (
    <div className="root">
      <div className="bg" aria-hidden="true" />
      <div className="noise" aria-hidden="true" />

      <div ref={shellRef} className={cx("card3d", shake && "shake")}>
        <div className="shine" aria-hidden="true" />

        <aside className="leftPane">
          <div className="hero">
            <div className="heroTitle">GalaBone 入口</div>
            <div className="heroSub">
              歡迎使用我們的系統！請在右側登入或註冊帳號，完成 Email 驗證後即可使用。這裡是專為骨科醫師、學生、教師打造的影像分析與知識查詢平台。立即加入我們，開啟您的骨科影像分析之旅！
            </div>

            <div className="stats">
              <div className="stat">
                <div className="k">目前介面</div>
                <div className="v">
                  {verifyOpen ? "Verify" : tab === "register" ? "註冊" : "登入"}
                </div>
              </div>
              <div className="stat">
                <div className="k">Email</div>
                <div className="v">
                  {email.trim() ? (emailOk ? "格式合法" : "格式不合法") : "尚未填寫"}
                </div>
              </div>
              <div className="stat">
                <div className="k">是否驗證</div>
                <div className="v">
                  {flow.verifiedEmail
                    ? "已驗證"
                    : flow.verifySentEmail
                    ? "驗證碼已送出"
                    : flow.registeredEmail
                    ? "已註冊"
                    : "新使用者"}
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
                尚無寄信服務，驗證碼會直接顯示在畫面上（dev code）。這樣測試流程比較快，也不怕收不到信。正式環境會改成寄信的。
              </div>
            </div>

            <div className="leftFoot">
              <button
                className="ghost"
                onClick={handleLogout}
                disabled={busy}
                title="如果你目前已登入，這顆會登出"
              >
                我已登入 → 登出
              </button>
              <div className="muted">GalaBone</div>
            </div>
          </div>
        </aside>

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

            {tab === "register" && (
              <>
                <div className="paneActions">
                  <button
                    className="linkBtn"
                    type="button"
                    onClick={() => {
                      setVerifyOpen(true);
                      goto("verify");
                    }}
                  >
                    開啟驗證
                  </button>

                  <button className="linkBtn" type="button" onClick={resetFlow}>
                    重置流程
                  </button>
                </div>

                <div className="paneMeta">
                  <div className="metaChip">
                    <span className={cx("pill", flow.verifiedEmail && "on")} />
                    email驗證:{flow.verifiedEmail ? "成功" : "尚未成功"}
                  </div>
                </div>
              </>
            )}
          </div>

          {tab === "login" ? (
            <div className="form formFixed">
              <div className="formHead">
                <div className="h1">登入</div>
                <div className="sub">
                  註冊完成後即可登入；若帳號尚未完成 Email 驗證，系統會提示你先完成驗證。
                </div>
              </div>

              <div className="formBody formBodyLogin">
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
                  error={pwTooLong ? "密碼超過 72 字元（bcrypt 上限）" : null}
                  right={
                    <button
                      className="iconBtn"
                      type="button"
                      onClick={() => setShowPw((x) => !x)}
                      title="顯示/隱藏"
                    >
                      {showPw ? "🙈" : "👀"}
                    </button>
                  }
                  hint={
                    <span className="hintRow">
                      <span>
                        密碼長度: <b>{pwBytes}</b>/72
                      </span>
                      <span className="sep">•</span>
                      <span>
                        密碼強度: <b>{pwScore}/5</b>
                      </span>
                    </span>
                  }
                />
              </div>

              <div className="formFoot">
                <button
                  className={cx("btn", "primary")}
                  disabled={!loginReady}
                  onClick={handleLogin}
                >
                  {busy ? <span className="spin" /> : null}
                  {busy ? "登入中…" : "登入"}
                </button>

                <div className="row rowSingle">
                  <button
                    className="btn soft"
                    disabled={busy}
                    onClick={() => {
                      setTab("register");
                      goto("register");
                    }}
                  >
                    沒帳號？去註冊 →
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="form formFixed">
              <div className="formHead">
                <div className="h1">註冊</div>
                <div className="sub">
                  請在註冊後，點擊開啟驗證完成 Email 驗證流程，等待系統螢幕上顯示 dev code，尚未開通寄信服務，感謝配合。
                </div>
              </div>

              <div className="formBody">
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
                    <div className="msg">
                      請選擇你要註冊的身分:student/teacher/doctor/assistant，未來會根據不同角色開放不同功能，目前只是 demo，所以先選一個玩玩看就好，之後會有審核機制。
                    </div>
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
                    error={
                      pwTooLong
                        ? "超過 72 字元（bcrypt 上限）"
                        : pw.length > 0 && pw.length < 8
                        ? "至少 8 碼"
                        : null
                    }
                    right={
                      <button
                        className="iconBtn"
                        type="button"
                        onClick={() => setShowPw((x) => !x)}
                        title="顯示/隱藏"
                      >
                        {showPw ? "🙈" : "👀"}
                      </button>
                    }
                    hint={
                      <span className="hintRow">
                        <span>
                          密碼長度: <b>{pwBytes}</b>/72
                        </span>
                        <span className="sep">•</span>
                        <span>
                          密碼強度: <b>{pwScore}/5</b>
                        </span>
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
                      <button
                        className="iconBtn"
                        type="button"
                        onClick={() => setShowPw2((x) => !x)}
                        title="顯示/隱藏"
                      >
                        {showPw2 ? "🙈" : "👀"}
                      </button>
                    }
                  />
                </div>
              </div>

              <div className="formFoot">
                <button
                  className={cx("btn", "primary")}
                  disabled={!registerReady}
                  onClick={handleRegister}
                >
                  {busy ? <span className="spin" /> : null}
                  {busy ? "建立中…" : "建立帳號"}
                </button>

                <button
                  className={cx("btn", "softWide")}
                  disabled={busy || !emailOk}
                  onClick={() => {
                    setVerifyOpen(true);
                    goto("verify");
                  }}
                  title={!emailOk ? "先填正確 Email" : ""}
                >
                  我已註冊 / 想驗證 → 打開驗證小視窗
                </button>
              </div>
            </div>
          )}
        </main>

        <div className={cx("drawer", verifyOpen && "open")} aria-hidden={!verifyOpen}>
          <div className="drawerHead">
            <div>
              <div className="dTitle">Email 驗證</div>
              <div className="dSub">
                沒有寄信服務，請先看螢幕顯示的 dev code → 再輸入 code → 點擊確認。成功的話會出現綠色勾勾的浮動提示。
              </div>
            </div>

            <div className="dBtns">
              <button
                className="btn soft"
                onClick={() => {
                  setVerifyOpen(false);
                  goto(tab);
                }}
                disabled={busy}
              >
                X
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
                  <span>建議用你註冊時的 Email。</span>
                )
              }
            />

            <div className="row3">
              <button
                className={cx("btn", "ok")}
                disabled={busy || resendLeft > 0 || !emailOk}
                onClick={handleSendVerify}
              >
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
                狀態：<b>{flow.verifySentEmail ? " 已寄碼" : " 尚未寄碼"}</b>
                {flow.verifySentEmail ? (
                  <span className="muted">（寄到 {flow.verifySentEmail}）</span>
                ) : null}
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
              title={
                !flow.verifySentEmail
                  ? "請先寄驗證碼"
                  : flow.verifySentEmail !== email.trim()
                  ? "Email 要跟寄碼時一致"
                  : ""
              }
            >
              {busy ? <span className="spin" /> : null}
              {busy ? "驗證中…" : "確認驗證"}
            </button>

            <div className="drawerTip">
              常見Q/A: 如果一直說「錯誤或過期」，請重新驗證一次。
            </div>
          </div>
        </div>
      </div>

      <PillToast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}