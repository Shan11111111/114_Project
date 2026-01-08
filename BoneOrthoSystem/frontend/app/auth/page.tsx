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
function cx(...cls: Array<string | false | null | undefined>) {
  return cls.filter(Boolean).join(" ");
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
      const rx = (0.5 - py) * 8;
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

export default function Page() {
  const router = useRouter();
  const sp = useSearchParams();

  const mode = (sp.get("mode") as Mode) || "login";
  const isLogin = mode === "login";
  const isRegister = mode === "register";
  const isVerify = mode === "verify";

  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ type: "ok" | "err" | "info"; msg: string } | null>(null);

  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [role, setRole] = useState<Role>("user");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");

  const [code, setCode] = useState("");
  const [lastSentAt, setLastSentAt] = useState<number | null>(null);
  const [devCodeHint, setDevCodeHint] = useState<string | null>(null);

  const bookRef = useRef<HTMLDivElement>(null);
  useTilt(bookRef, true);

  const bytes = useMemo(() => utf8BytesLen(pw), [pw]);
  const pwOver = bytes > 72;

  const resendLeft = useMemo(() => {
    if (!lastSentAt) return 0;
    const diff = Math.floor((Date.now() - lastSentAt) / 1000);
    return Math.max(0, 30 - diff);
  }, [lastSentAt]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4200);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (!lastSentAt) return;
    const t = setInterval(() => setToast((x) => (x ? { ...x } : x)), 1000);
    return () => clearInterval(t);
  }, [lastSentAt]);

  function goto(next: Mode) {
    router.push(`/auth?mode=${next}`);
  }

  function onPwChange(v: string, which: "pw" | "pw2") {
    const clipped = truncateUtf8ToBytes(v, 72);
    if (which === "pw") setPw(clipped);
    else setPw2(clipped);
  }

  async function handleRegister() {
    setBusy(true);
    setToast(null);
    try {
      if (!username.trim()) throw new Error("請填使用者名稱 (username)");
      if (!email.trim()) throw new Error("請填 Email");
      if (!pw) throw new Error("請填密碼");
      if (pw !== pw2) throw new Error("兩次密碼不一致");
      if (utf8BytesLen(pw) > 72) throw new Error("密碼超過 72 bytes（bcrypt 限制），請縮短。");

      await apiJSON<AuthUser>(EP.register, {
        method: "POST",
        body: JSON.stringify({
          username: username.trim(),
          email: email.trim(),
          password: pw,
          role, // ✅ 你要的是 role（不是 roles）
        }),
      });

      setToast({ type: "ok", msg: "註冊成功 ✅ 但還沒驗證 email。下一步：寄驗證碼 → 輸入驗證碼。" });
      goto("verify");
    } catch (e: any) {
      setToast({ type: "err", msg: String(e?.message || e) });
    } finally {
      setBusy(false);
    }
  }

  async function handleLogin() {
    setBusy(true);
    setToast(null);
    try {
      if (!email.trim()) throw new Error("請填 Email");
      if (!pw) throw new Error("請填密碼");
      if (utf8BytesLen(pw) > 72) throw new Error("密碼超過 72 bytes（bcrypt 限制），請縮短。");

      const out = await apiJSON<LoginOut>(EP.login, {
        method: "POST",
        body: JSON.stringify({ email: email.trim(), password: pw }),
      });

      setTokens(out.access_token, out.refresh_token);

      const me = await apiJSON<AuthUser>(EP.me, {
        method: "GET",
        headers: { Authorization: `Bearer ${out.access_token}` },
      });
      setUser(me);

      setToast({ type: "ok", msg: "登入成功 ✅（你終於不是訪客了）" });
      router.push("/");
    } catch (e: any) {
      const msg = String(e?.message || e);
      if (msg.includes("尚未完成") || msg.includes("驗證") || msg.includes("403")) {
        setToast({ type: "info", msg: "你還沒驗證 Email。先驗證，系統才會放行。" });
        goto("verify");
      } else {
        setToast({ type: "err", msg });
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
      if (!email.trim()) throw new Error("請先填 Email，才能寄驗證碼。");

      const { data, url } = await postWithFallback<any>(EP.sendVerify, { email: email.trim() });
      const maybe = (data?.dev_code || data?.code || null) as string | null;
      if (maybe) setDevCodeHint(String(maybe));

      setLastSentAt(Date.now());
      setToast({
        type: "ok",
        msg: `已送出驗證碼 ✅（用 ${url.replace(API_BASE, "")}）` + (maybe ? "（dev_code 已顯示）" : ""),
      });
    } catch (e: any) {
      setToast({ type: "err", msg: String(e?.message || e) });
    } finally {
      setBusy(false);
    }
  }

  async function handleVerify() {
    setBusy(true);
    setToast(null);
    try {
      if (!email.trim()) throw new Error("請先填 Email");
      if (!code.trim()) throw new Error("請輸入驗證碼");
      const cleanCode = code.replace(/\s+/g, "");

      const { url } = await postWithFallback<any>(EP.verify, { email: email.trim(), code: cleanCode });
      setToast({ type: "ok", msg: `驗證成功 ✅（用 ${url.replace(API_BASE, "")}）現在可以登入了。` });
      goto("login");
    } catch (e: any) {
      setToast({ type: "err", msg: String(e?.message || e) });
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

  const step = isRegister ? 0 : isVerify ? 1 : 2;

  return (
    <div className="authRoot">
      <div className="bgBlobs" aria-hidden="true" />

      <div className="wrap">
        <div className="topBar">
          <div className="brand">
            <span className="dot" />
            <span className="title">GalaBone Auth</span>
            <span className="sub">翻書登入・有點炫但不裝逼</span>
          </div>

          <div className="stepper" title="Register → Verify → Login">
            {["Register", "Verify", "Login"].map((t, i) => (
              <div key={t} className={cx("step", i <= step && "on")}>
                <span className="n">{i + 1}</span>
                <span className="t">{t}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="book3d" ref={bookRef}>
          <div className={cx("book", isRegister && "flipR", isLogin && "flipL")}>
            {/* LEFT: LOGIN */}
            <section className="page left">
              <div className="pad">
                <h1>登入</h1>
                <p className="hint">你可以很酷，但先登入。沒驗證的帳號會被擋（合理）。</p>

                <label className="lab">Email</label>
                <input className="inp" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" autoComplete="email" />

                <label className="lab">密碼</label>
                <div className="pwRow">
                  <input className="inp" value={pw} onChange={(e) => onPwChange(e.target.value, "pw")} placeholder="輸入密碼" type="password" autoComplete="current-password" />
                  <span className={cx("bytes", pwOver && "bad")}>{bytes}/72</span>
                </div>
                <div className="micro">bcrypt 上限 72 bytes：前端直接卡住，後端就不會再 422 你。</div>

                <button className="btn main" disabled={busy} onClick={handleLogin}>
                  {busy ? "處理中…" : "登入"}
                </button>

                <div className="row">
                  <Link href="/" className="link">回首頁</Link>
                  <button className="btn ghost" onClick={() => goto("register")} disabled={busy}>
                    去註冊 →
                  </button>
                </div>

                <button className="link tiny" onClick={handleLogout} disabled={busy}>
                  （我已登入）點我登出
                </button>
              </div>
            </section>

            {/* RIGHT: REGISTER */}
            <section className="page right">
              <div className="pad">
                <div className="headRow">
                  <div>
                    <h1>註冊</h1>
                    <p className="hint">欄位你嫌少？這版把「username + role」都補齊。</p>
                  </div>
                  <button className="btn ghost" onClick={() => goto("login")} disabled={busy}>
                    去登入 →
                  </button>
                </div>

                <label className="lab">使用者名稱</label>
                <input className="inp" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="user_name（dbo.users.username）" autoComplete="username" />

                <label className="lab">角色（role → 寫入 DB roles）</label>
                <div className="chips">
                  {(["user", "student", "teacher", "doctor", "assistant"] as Role[]).map((r) => (
                    <button
                      key={r}
                      type="button"
                      className={cx("chip", role === r && "on")}
                      onClick={() => setRole(r)}
                      disabled={busy}
                      title={r === "teacher" || r === "doctor" ? "這種通常要審核，但你現在先存起來展示" : ""}
                    >
                      {r}
                    </button>
                  ))}
                </div>
                <div className="micro">後端會白名單檢查：只允許 user/student/teacher/doctor/assistant。</div>

                <label className="lab">Email</label>
                <input className="inp" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" autoComplete="email" />

                <div className="grid2">
                  <div>
                    <label className="lab">密碼</label>
                    <div className="pwRow">
                      <input className="inp" value={pw} onChange={(e) => onPwChange(e.target.value, "pw")} placeholder="至少 8 碼" type="password" autoComplete="new-password" />
                      <span className={cx("bytes", pwOver && "bad")}>{bytes}/72</span>
                    </div>
                  </div>
                  <div>
                    <label className="lab">確認密碼</label>
                    <input className="inp" value={pw2} onChange={(e) => onPwChange(e.target.value, "pw2")} placeholder="再打一次" type="password" autoComplete="new-password" />
                    <div className="micro">{pw2 && pw !== pw2 ? <span className="badTxt">兩次密碼不一致</span> : <span>OK</span>}</div>
                  </div>
                </div>

                <button className="btn main" disabled={busy} onClick={handleRegister}>
                  {busy ? "建立中…" : "建立帳號"}
                </button>

                <button className="btn glow" disabled={busy} onClick={() => goto("verify")}>
                  我已註冊，去驗證 →
                </button>
              </div>
            </section>
          </div>

          {/* VERIFY MODAL */}
          {isVerify && (
            <div className="veil" role="dialog" aria-modal="true">
              <div className="modal">
                <div className="mHead">
                  <div>
                    <h2>Email 驗證</h2>
                    <p>流程：先寄驗證碼 → 再輸入驗證碼。你如果跳步，系統不背鍋。</p>
                  </div>
                  <button className="btn ghost" onClick={() => goto("login")} disabled={busy}>
                    回登入
                  </button>
                </div>

                <div className="mGrid">
                  <div>
                    <label className="lab">Email</label>
                    <input className="inp" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" autoComplete="email" />

                    <div className="row2">
                      <button className="btn ok" disabled={busy || resendLeft > 0} onClick={handleSendVerify}>
                        {resendLeft > 0 ? `請稍等 ${resendLeft}s` : "寄驗證碼"}
                      </button>
                      <button className="btn ghost" disabled={busy} onClick={() => { setDevCodeHint(null); setCode(""); }}>
                        清空
                      </button>
                    </div>

                    {devCodeHint && (
                      <div className="devHint">
                        dev_code：<code>{devCodeHint}</code>
                        <span>（正式上線要改成寄信，不回傳 code）</span>
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="lab">驗證碼</label>
                    <input className="inp code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="例如：123456" inputMode="numeric" />

                    <button className="btn main" disabled={busy} onClick={handleVerify}>
                      {busy ? "驗證中…" : "確認驗證"}
                    </button>

                    <div className="micro">如果一直說「錯誤或過期」：重寄一次，你可能拿到舊碼。</div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {toast && (
          <div className={cx("toast", toast.type)}>
            {toast.msg}
          </div>
        )}
      </div>

      <style jsx global>{`
        .authRoot { min-height: calc(100vh - 64px); padding: 40px 16px; display: grid; place-items: center; position: relative; overflow: hidden; }
        .bgBlobs {
          position: absolute; inset: -40%;
          background:
            radial-gradient(closest-side at 20% 20%, rgba(56,189,248,0.35), transparent 60%),
            radial-gradient(closest-side at 80% 30%, rgba(16,185,129,0.28), transparent 55%),
            radial-gradient(closest-side at 40% 80%, rgba(168,85,247,0.22), transparent 60%);
          filter: blur(14px);
          animation: floaty 10s ease-in-out infinite alternate;
          pointer-events: none;
        }
        @keyframes floaty { from { transform: translate3d(-10px,-12px,0) scale(1); } to { transform: translate3d(14px,10px,0) scale(1.04); } }

        .wrap { width: min(1040px, 100%); position: relative; z-index: 2; }
        .topBar { display: flex; gap: 14px; justify-content: space-between; align-items: center; margin-bottom: 14px; flex-wrap: wrap; }
        .brand { display: flex; align-items: baseline; gap: 10px; }
        .dot { width: 10px; height: 10px; border-radius: 999px; background: rgba(16,185,129,1); box-shadow: 0 0 0 6px rgba(16,185,129,0.15); }
        .title { font-weight: 800; letter-spacing: -0.02em; }
        .sub { opacity: .65; font-size: 12px; }

        .stepper { display: flex; gap: 10px; }
        .step { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-radius: 999px; border: 1px solid rgba(2,6,23,.10); background: rgba(255,255,255,.55); backdrop-filter: blur(8px); opacity: .65; }
        .step.on { opacity: 1; }
        .step .n { width: 22px; height: 22px; border-radius: 999px; display: grid; place-items: center; font-size: 12px; background: rgba(56,189,248,.18); }
        .step .t { font-size: 12px; }

        .book3d {
          --rx: 0deg; --ry: 0deg; --mx: 50%; --my: 50%;
          border-radius: 28px;
          border: 1px solid rgba(2,6,23,.10);
          box-shadow: 0 24px 90px rgba(2,6,23,.16);
          background: linear-gradient(180deg, rgba(56,189,248,.14), rgba(255,255,255,.62));
          overflow: hidden;
          transform: perspective(1200px) rotateX(var(--rx)) rotateY(var(--ry));
          transition: transform .18s ease;
          position: relative;
        }
        .book3d::after{
          content:"";
          position:absolute; inset:0;
          background: radial-gradient(700px 300px at var(--mx) var(--my), rgba(255,255,255,.55), transparent 60%);
          mix-blend-mode: overlay;
          pointer-events:none;
          opacity:.7;
        }

        .book { display: grid; grid-template-columns: 1fr 1fr; min-height: 620px; }
        .page { background: rgba(255,255,255,.74); backdrop-filter: blur(10px); position: relative; }
        .page.left { border-right: 1px solid rgba(2,6,23,.10); }
        .page.right { border-left: 1px solid rgba(2,6,23,.10); }
        .pad { padding: 28px; }
        .page h1 { font-size: 36px; font-weight: 900; letter-spacing: -0.03em; margin: 0; }
        .hint { margin-top: 6px; opacity: .7; font-size: 13px; }

        .lab { display:block; font-size: 12px; font-weight: 700; margin-top: 16px; opacity: .8; }
        .inp {
          width: 100%;
          margin-top: 8px;
          border-radius: 18px;
          border: 1px solid rgba(2,6,23,.12);
          background: rgba(255,255,255,.78);
          padding: 12px 14px;
          outline: none;
          transition: box-shadow .15s ease, transform .15s ease;
        }
        .inp:focus { box-shadow: 0 0 0 3px rgba(56,189,248,.25); transform: translateY(-1px); }
        .inp.code { letter-spacing: .35em; font-weight: 800; text-align: center; }

        .pwRow { position: relative; }
        .bytes { position:absolute; right: 12px; top: 50%; transform: translateY(-50%); font-size: 12px; opacity:.65; }
        .bytes.bad { color: rgb(220,38,38); opacity: 1; }

        .micro { font-size: 12px; opacity: .7; margin-top: 8px; }
        .badTxt { color: rgb(220,38,38); font-weight: 700; }

        .btn {
          border: 1px solid rgba(2,6,23,.12);
          border-radius: 18px;
          padding: 12px 14px;
          font-weight: 900;
          cursor: pointer;
          transition: transform .12s ease, box-shadow .12s ease, opacity .12s ease;
          user-select: none;
        }
        .btn:disabled { opacity: .6; cursor: not-allowed; }
        .btn:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 12px 30px rgba(2,6,23,.10); }
        .btn.main { width: 100%; margin-top: 18px; background: rgba(6,182,212,1); color: white; border-color: rgba(6,182,212,1); }
        .btn.ghost { background: rgba(2,6,23,.04); }
        .btn.ok { background: rgba(16,185,129,1); color: white; border-color: rgba(16,185,129,1); }
        .btn.glow { width: 100%; margin-top: 10px; background: rgba(168,85,247,1); color: white; border-color: rgba(168,85,247,1); }

        .row { display:flex; justify-content: space-between; align-items:center; margin-top: 14px; gap: 10px; }
        .row2 { display:flex; gap: 10px; margin-top: 10px; flex-wrap: wrap; }
        .link { font-size: 13px; opacity: .75; }
        .link:hover { opacity: 1; }
        .link.tiny { margin-top: 14px; font-size: 12px; background: transparent; border: none; padding: 0; cursor: pointer; text-align:left; }

        .headRow { display:flex; align-items:flex-start; justify-content: space-between; gap: 12px; }

        .grid2 { display:grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        @media (max-width: 880px){ .book { grid-template-columns: 1fr; } .page.left{ border-right:none; border-bottom: 1px solid rgba(2,6,23,.10);} .page.right{ border-left:none; } .grid2{ grid-template-columns:1fr;} }

        .chips { display:flex; gap: 8px; flex-wrap: wrap; margin-top: 8px; }
        .chip {
          border-radius: 999px; padding: 10px 12px;
          border: 1px solid rgba(2,6,23,.12);
          background: rgba(255,255,255,.65);
          font-weight: 900; font-size: 12px;
          transition: transform .12s ease, box-shadow .12s ease, background .12s ease;
        }
        .chip.on { background: rgba(56,189,248,.22); border-color: rgba(56,189,248,.35); }
        .chip:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 12px 30px rgba(2,6,23,.08); }

        .veil { position:absolute; inset:0; background: rgba(2,6,23,.20); backdrop-filter: blur(8px); display:grid; place-items:center; padding: 16px; z-index: 30; }
        .modal {
          width: min(920px, 100%);
          border-radius: 24px;
          border: 1px solid rgba(2,6,23,.12);
          background: rgba(255,255,255,.92);
          box-shadow: 0 26px 90px rgba(2,6,23,.18);
          padding: 18px;
        }
        .mHead { display:flex; justify-content: space-between; gap: 12px; align-items:flex-start; }
        .mHead h2 { margin: 0; font-size: 22px; font-weight: 950; letter-spacing: -0.02em; }
        .mHead p { margin: 6px 0 0; opacity: .72; font-size: 12px; }
        .mGrid { display:grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-top: 14px; }
        @media (max-width: 880px){ .mGrid{ grid-template-columns:1fr; } }

        .devHint { margin-top: 10px; font-size: 12px; display:flex; gap: 10px; align-items:center; flex-wrap: wrap; }
        .devHint code { padding: 6px 10px; border-radius: 999px; background: rgba(2,6,23,.06); font-weight: 950; }
        .devHint span { opacity: .7; }

        .toast {
          margin-top: 14px;
          border-radius: 18px;
          border: 1px solid rgba(2,6,23,.10);
          background: rgba(255,255,255,.70);
          padding: 12px 14px;
          font-size: 13px;
          backdrop-filter: blur(8px);
        }
        .toast.ok { border-color: rgba(16,185,129,.35); background: rgba(16,185,129,.10); }
        .toast.err { border-color: rgba(220,38,38,.35); background: rgba(220,38,38,.10); }
        .toast.info { border-color: rgba(6,182,212,.35); background: rgba(6,182,212,.10); }
      `}</style>
    </div>
  );
}
