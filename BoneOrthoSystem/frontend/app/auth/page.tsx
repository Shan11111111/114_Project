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
  // 你們命名可能不同：我做 fallback
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
      // 如果是 404 或 "Not Found" 之類，再試下一個
      const msg = String(e?.message || "");
      if (msg.includes("404") || msg.toLowerCase().includes("not found") || msg.includes("Cannot POST")) {
        continue;
      }
      // 不是 404：直接丟出（避免把真正錯誤吞掉）
      throw e;
    }
  }
  throw lastErr || new Error("No endpoint matched.");
}

/** =========================
 *  Helpers: 72 bytes password guard
 *  ========================= */
function utf8BytesLen(s: string) {
  return new TextEncoder().encode(s).length;
}

function truncateUtf8ToBytes(s: string, maxBytes: number) {
  const enc = new TextEncoder();
  const bytes = enc.encode(s);
  if (bytes.length <= maxBytes) return s;

  // 逐步縮短（保守但穩）
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
 *  Types
 *  ========================= */
type Mode = "login" | "register" | "verify";

type LoginOut = {
  access_token: string;
  refresh_token: string;
  token_type?: string;
};

export default function AuthPage() {
  const router = useRouter();
  const sp = useSearchParams();

  const mode = (sp.get("mode") as Mode) || "login";
  const isLogin = mode === "login";
  const isRegister = mode === "register";
  const isVerify = mode === "verify";

  // UI state
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ type: "ok" | "err" | "info"; msg: string } | null>(null);

  // form state
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [roleWish, setRoleWish] = useState<"user" | "teacher" | "admin">("user");

  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");

  // verify state
  const [code, setCode] = useState("");
  const [lastSentAt, setLastSentAt] = useState<number | null>(null);
  const [devCodeHint, setDevCodeHint] = useState<string | null>(null);

  const bytes = useMemo(() => utf8BytesLen(pw), [pw]);
  const bytes2 = useMemo(() => utf8BytesLen(pw2), [pw2]);
  const pwOver = bytes > 72;
  const pw2Over = bytes2 > 72;

  // countdown for resend
  const resendLeft = useMemo(() => {
    if (!lastSentAt) return 0;
    const diff = Math.floor((Date.now() - lastSentAt) / 1000);
    return Math.max(0, 30 - diff); // 30 秒冷卻
  }, [lastSentAt, toast]); // toast 變動會促發重新 render

  // tiny timer tick (for resend countdown)
  useEffect(() => {
    if (!lastSentAt) return;
    const t = setInterval(() => {
      // force rerender
      setToast((x) => x ? { ...x } : x);
    }, 1000);
    return () => clearInterval(t);
  }, [lastSentAt]);

  // clear toast after a while
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3800);
    return () => clearTimeout(t);
  }, [toast]);

  function goto(next: Mode) {
    router.push(`/auth?mode=${next}`);
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
          // 你後端目前不會吃 roles，我保留讓你日後可升級
          roles: roleWish,
        }),
      });

      setToast({ type: "ok", msg: "註冊成功 ✅ 但還沒驗證 email，先去驗證。" });
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

      // 拿 /me
      const me = await apiJSON<AuthUser>(EP.me, {
        method: "GET",
        headers: { Authorization: `Bearer ${out.access_token}` },
      });
      setUser(me);

      setToast({ type: "ok", msg: "登入成功 ✅ 你現在是主角。" });
      router.push("/");
    } catch (e: any) {
      const msg = String(e?.message || e);

      // 後端擋未驗證：直接引導到 verify
      if (msg.includes("尚未完成") || msg.includes("驗證")) {
        setToast({ type: "info", msg: "你還沒驗證 email。先驗證，才讓你上車。" });
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

      // 開發模式可能回 dev_code
      const maybe = (data?.dev_code || data?.code || null) as string | null;
      if (maybe) setDevCodeHint(String(maybe));

      setLastSentAt(Date.now());
      setToast({
        type: "ok",
        msg: `已送出驗證碼 ✅（用的是 ${url.replace(API_BASE, "")}）` + (maybe ? "（dev_code 已顯示在下方）" : ""),
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
      if (cleanCode.length < 4) throw new Error("驗證碼太短（你真的有收到嗎…）");

      const { url } = await postWithFallback<any>(EP.verify, {
        email: email.trim(),
        code: cleanCode,
      });

      setToast({ type: "ok", msg: `驗證成功 ✅（用的是 ${url.replace(API_BASE, "")}）可以登入了。` });
      // 驗證成功 → 回登入
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

  // input handlers with 72 bytes clamp
  function onPwChange(v: string, which: "pw" | "pw2") {
    const clipped = truncateUtf8ToBytes(v, 72);
    if (which === "pw") setPw(clipped);
    else setPw2(clipped);
  }

  return (
    <div className="min-h-[calc(100vh-64px)] flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-[980px]">
        {/* Title strip */}
        <div className="flex items-center justify-between mb-4">
          <div className="text-sm opacity-80">
            <span className="inline-flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              {isLogin && "登入模式"}
              {isRegister && "註冊模式"}
              {isVerify && "Email 驗證"}
            </span>
          </div>

          <div className="text-xs opacity-70">
            提示：<code className="px-2 py-1 rounded bg-black/5">/auth?mode=login</code>{" "}
            <code className="px-2 py-1 rounded bg-black/5">/auth?mode=register</code>{" "}
            <code className="px-2 py-1 rounded bg-black/5">/auth?mode=verify</code>
          </div>
        </div>

        {/* Flip Book */}
        <div className="relative">
          <div className="bookShell">
            <div className={cx("book", isRegister && "isFlipped")}>
              {/* Left Page: Login */}
              <section className="page pageLeft">
                <div className="pagePad">
                  <h1 className="text-4xl font-bold tracking-tight">登入</h1>
                  <p className="mt-2 text-sm opacity-70">
                    左頁登入 / 右頁註冊。想要翻書感？我給你翻到起飛 📚✨
                  </p>

                  <div className="mt-6 space-y-4">
                    <div>
                      <label className="text-sm font-medium">Email</label>
                      <input
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="mt-1 w-full rounded-2xl border px-4 py-3 bg-white/70 outline-none focus:ring-2 focus:ring-cyan-400"
                        placeholder="name@example.com"
                        autoComplete="email"
                      />
                    </div>

                    <div>
                      <label className="text-sm font-medium">密碼</label>
                      <div className="mt-1 relative">
                        <input
                          value={pw}
                          onChange={(e) => onPwChange(e.target.value, "pw")}
                          className="w-full rounded-2xl border px-4 py-3 bg-white/70 outline-none focus:ring-2 focus:ring-cyan-400"
                          placeholder="輸入密碼"
                          type="password"
                          autoComplete="current-password"
                        />
                        <div className="absolute right-3 top-1/2 -translate-y-1/2 text-xs opacity-60">
                          {utf8BytesLen(pw)}/72 bytes
                        </div>
                      </div>
                      <div className="mt-2 text-xs opacity-70">
                        bcrypt 上限 72 bytes（前端幫你卡住，避免後端 422）。
                      </div>
                    </div>

                    <button
                      disabled={busy}
                      onClick={handleLogin}
                      className={cx(
                        "w-full rounded-2xl py-3 font-semibold text-white shadow-lg",
                        busy ? "opacity-60" : "hover:opacity-95",
                        "bg-cyan-500"
                      )}
                    >
                      {busy ? "處理中…" : "登入"}
                    </button>

                    <div className="flex items-center justify-between text-sm">
                      <Link href="/" className="opacity-70 hover:opacity-100">
                        回首頁
                      </Link>
                      <button
                        onClick={() => goto("register")}
                        className="inline-flex items-center gap-2 rounded-full px-4 py-2 bg-black/5 hover:bg-black/10"
                      >
                        沒帳號？去註冊 →
                      </button>
                    </div>

                    <div className="pt-3">
                      <button
                        onClick={handleLogout}
                        className="text-xs opacity-70 hover:opacity-100"
                        disabled={busy}
                        title="如果你目前已登入，這顆會登出"
                      >
                        （我已登入）點我登出
                      </button>
                    </div>
                  </div>
                </div>
              </section>

              {/* Right Page: Register */}
              <section className="page pageRight">
                <div className="pagePad">
                  <div className="flex items-start justify-between">
                    <div>
                      <h1 className="text-4xl font-bold tracking-tight">註冊</h1>
                      <p className="mt-2 text-sm opacity-70">
                        我知道你想要「Figma 等級」的互動——先把流程做對，再來加煙火 🎆
                      </p>
                    </div>

                    <button
                      onClick={() => goto("login")}
                      className="inline-flex items-center gap-2 rounded-full px-4 py-2 bg-cyan-500 text-white hover:opacity-95"
                    >
                      去登入 →
                    </button>
                  </div>

                  <div className="mt-6 space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="text-sm font-medium">使用者名稱</label>
                        <input
                          value={username}
                          onChange={(e) => setUsername(e.target.value)}
                          className="mt-1 w-full rounded-2xl border px-4 py-3 bg-white/70 outline-none focus:ring-2 focus:ring-cyan-400"
                          placeholder="user_name（要寫進 dbo.users.username）"
                          autoComplete="username"
                        />
                      </div>

                      <div>
                        <label className="text-sm font-medium">期望角色（展示用）</label>
                        <select
                          value={roleWish}
                          onChange={(e) => setRoleWish(e.target.value as any)}
                          className="mt-1 w-full rounded-2xl border px-4 py-3 bg-white/70 outline-none focus:ring-2 focus:ring-cyan-400"
                        >
                          <option value="user">一般使用者 user</option>
                          <option value="teacher">教學 / 教師 teacher（通常要審核）</option>
                          <option value="admin">管理員 admin（需要邀請）</option>
                        </select>
                        <div className="mt-1 text-xs opacity-60">
                          目前後端 create_user() 會固定 roles='user'；你要真的寫入 roles，需要後端一起改。
                        </div>
                      </div>
                    </div>

                    <div>
                      <label className="text-sm font-medium">Email</label>
                      <input
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="mt-1 w-full rounded-2xl border px-4 py-3 bg-white/70 outline-none focus:ring-2 focus:ring-cyan-400"
                        placeholder="name@example.com"
                        autoComplete="email"
                      />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="text-sm font-medium">密碼</label>
                        <div className="mt-1 relative">
                          <input
                            value={pw}
                            onChange={(e) => onPwChange(e.target.value, "pw")}
                            className="w-full rounded-2xl border px-4 py-3 bg-white/70 outline-none focus:ring-2 focus:ring-cyan-400"
                            placeholder="至少 8 碼"
                            type="password"
                            autoComplete="new-password"
                          />
                          <div className={cx("absolute right-3 top-1/2 -translate-y-1/2 text-xs", pwOver ? "text-red-600" : "opacity-60")}>
                            {utf8BytesLen(pw)}/72
                          </div>
                        </div>
                        <div className="mt-2 text-xs opacity-70">
                          72 bytes 限制：英文約 72 字；中文大約 24 字內。
                        </div>
                      </div>

                      <div>
                        <label className="text-sm font-medium">確認密碼</label>
                        <div className="mt-1 relative">
                          <input
                            value={pw2}
                            onChange={(e) => onPwChange(e.target.value, "pw2")}
                            className="w-full rounded-2xl border px-4 py-3 bg-white/70 outline-none focus:ring-2 focus:ring-cyan-400"
                            placeholder="再打一次"
                            type="password"
                            autoComplete="new-password"
                          />
                          <div className={cx("absolute right-3 top-1/2 -translate-y-1/2 text-xs", pw2Over ? "text-red-600" : "opacity-60")}>
                            {utf8BytesLen(pw2)}/72
                          </div>
                        </div>

                        <div className="mt-2 text-xs">
                          {pw2 && pw !== pw2 ? (
                            <span className="text-red-600">兩次密碼不一致</span>
                          ) : (
                            <span className="opacity-70">OK</span>
                          )}
                        </div>
                      </div>
                    </div>

                    <button
                      disabled={busy}
                      onClick={handleRegister}
                      className={cx(
                        "w-full rounded-2xl py-3 font-semibold text-white shadow-lg",
                        busy ? "opacity-60" : "hover:opacity-95",
                        "bg-cyan-500"
                      )}
                    >
                      {busy ? "建立中…" : "建立帳號"}
                    </button>

                    <div className="text-xs opacity-70">
                      註冊完成後會要求 Email 驗證；不驗證就不給登入（合理，安全、也比較像真的系統）。
                    </div>
                  </div>
                </div>
              </section>
            </div>

            {/* Verify overlay (same page, separate mode) */}
            {isVerify && (
              <div className="verifyOverlay">
                <div className="verifyCard">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h2 className="text-2xl font-bold">Email 驗證</h2>
                      <p className="mt-1 text-sm opacity-70">
                        先「寄驗證碼」→ 再「輸入驗證碼」。<br />
                        如果你連送碼都沒按就來驗證，當然會被拒絕（系統不是通靈王）。
                      </p>
                    </div>
                    <button
                      onClick={() => goto("login")}
                      className="rounded-full px-4 py-2 bg-black/5 hover:bg-black/10"
                    >
                      回登入
                    </button>
                  </div>

                  <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="text-sm font-medium">Email</label>
                      <input
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="mt-1 w-full rounded-2xl border px-4 py-3 bg-white outline-none focus:ring-2 focus:ring-cyan-400"
                        placeholder="name@example.com"
                        autoComplete="email"
                      />
                      <div className="mt-2 flex items-center gap-2">
                        <button
                          disabled={busy || resendLeft > 0}
                          onClick={handleSendVerify}
                          className={cx(
                            "rounded-full px-4 py-2 text-sm font-semibold text-white",
                            busy || resendLeft > 0 ? "opacity-60" : "hover:opacity-95",
                            "bg-emerald-500"
                          )}
                        >
                          {resendLeft > 0 ? `請稍等 ${resendLeft}s` : "寄驗證碼"}
                        </button>

                        <button
                          onClick={() => { setDevCodeHint(null); setCode(""); }}
                          className="rounded-full px-4 py-2 text-sm bg-black/5 hover:bg-black/10"
                          disabled={busy}
                        >
                          清空
                        </button>
                      </div>

                      {devCodeHint && (
                        <div className="mt-3 text-xs">
                          <span className="opacity-70">dev_code：</span>
                          <code className="px-2 py-1 rounded bg-black/5">{devCodeHint}</code>
                          <span className="opacity-70">（正式上線要把 dev_code 拿掉，改寄信）</span>
                        </div>
                      )}
                    </div>

                    <div>
                      <label className="text-sm font-medium">驗證碼</label>
                      <input
                        value={code}
                        onChange={(e) => setCode(e.target.value)}
                        className="mt-1 w-full rounded-2xl border px-4 py-3 bg-white outline-none focus:ring-2 focus:ring-cyan-400 tracking-widest"
                        placeholder="例如：123456"
                        inputMode="numeric"
                      />

                      <button
                        disabled={busy}
                        onClick={handleVerify}
                        className={cx(
                          "mt-3 w-full rounded-2xl py-3 font-semibold text-white shadow-lg",
                          busy ? "opacity-60" : "hover:opacity-95",
                          "bg-cyan-500"
                        )}
                      >
                        {busy ? "驗證中…" : "確認驗證"}
                      </button>

                      <div className="mt-2 text-xs opacity-70">
                        若你一直看到「錯誤或過期」：請重新寄一次（你可能拿到舊碼了）。
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Toast */}
          {toast && (
            <div
              className={cx(
                "mt-4 rounded-2xl border px-4 py-3 text-sm",
                toast.type === "ok" && "border-emerald-200 bg-emerald-50 text-emerald-800",
                toast.type === "err" && "border-red-200 bg-red-50 text-red-800",
                toast.type === "info" && "border-cyan-200 bg-cyan-50 text-cyan-900"
              )}
            >
              {toast.msg}
            </div>
          )}
        </div>
      </div>

      {/* Styles (no extra files needed) */}
      <style jsx global>{`
        .bookShell {
          position: relative;
          border-radius: 28px;
          overflow: hidden;
          box-shadow: 0 18px 60px rgba(2, 6, 23, 0.12);
          background: linear-gradient(180deg, rgba(56,189,248,0.16), rgba(255,255,255,0.55));
          border: 1px solid rgba(2, 6, 23, 0.08);
        }

        .book {
          display: grid;
          grid-template-columns: 1fr 1fr;
          transform-style: preserve-3d;
          perspective: 1600px;
          min-height: 560px;
          position: relative;
        }

        .page {
          position: relative;
          background: rgba(255,255,255,0.72);
          backdrop-filter: blur(10px);
        }

        .pagePad {
          padding: 28px;
        }

        .pageLeft {
          border-right: 1px solid rgba(2, 6, 23, 0.08);
        }

        .pageRight {
          border-left: 1px solid rgba(2, 6, 23, 0.08);
        }

        /* Flip effect */
        .book.isFlipped .pageLeft {
          transform: rotateY(-6deg);
          transform-origin: right center;
        }
        .book.isFlipped .pageRight {
          transform: rotateY(6deg);
          transform-origin: left center;
        }

        .verifyOverlay {
          position: absolute;
          inset: 0;
          display: grid;
          place-items: center;
          background: rgba(2, 6, 23, 0.18);
          backdrop-filter: blur(6px);
          z-index: 20;
          padding: 16px;
        }

        .verifyCard {
          width: min(900px, 100%);
          border-radius: 26px;
          background: rgba(255, 255, 255, 0.88);
          border: 1px solid rgba(2, 6, 23, 0.10);
          box-shadow: 0 28px 90px rgba(2, 6, 23, 0.18);
          padding: 22px;
        }
      `}</style>
    </div>
  );
}
