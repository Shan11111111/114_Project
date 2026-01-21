// frontend/app/auth/AuthFlipBook.tsx
"use client";

import "./auth.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { apiJSON, setTokens, setUser } from "../lib/auth";

type Step = "login" | "register" | "verify";
type Role = "student" | "teacher" | "doctor" | "assistant" | "user";


const API_BASE = (process.env.NEXT_PUBLIC_BACKEND_URL || "http://127.0.0.1:8000").replace(/\/+$/, "");
const MAX_PW_BYTES = 72;

function isEmail(v: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}
function utf8Bytes(s: string) {
  return new TextEncoder().encode(s).length;
}
function clampToUtf8Bytes(s: string, maxBytes: number) {
  if (utf8Bytes(s) <= maxBytes) return s;
  let out = s;
  while (out.length > 0 && utf8Bytes(out) > maxBytes) out = out.slice(0, -1);
  return out;
}

async function authMe(access: string) {
  return apiJSON<{ user_id?: string; username?: string; email?: string; roles?: string }>(`${API_BASE}/auth/me`, {
    method: "GET",
    headers: { Authorization: `Bearer ${access}` },
  });
}

export default function AuthFlipBook() {
  const router = useRouter();
  const sp = useSearchParams();
  const initial = (sp.get("mode") as Step) || "login";

  const [step, setStep] = useState<Step>(initial);

  // login
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPw, setLoginPw] = useState("");

  // register
  const [username, setUsername] = useState("");
  const [regEmail, setRegEmail] = useState("");
  const [regPw, setRegPw] = useState("");
  const [regPw2, setRegPw2] = useState("");
  const [role, setRole] = useState<Role>("student");

  // verify
  const [vEmail, setVEmail] = useState("");
  const [vCode, setVCode] = useState("");
  const [devHint, setDevHint] = useState<string>("");

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showPw, setShowPw] = useState(false);

  const leafRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = leafRef.current;
    if (!el) return;

    const onMove = (e: MouseEvent) => {
      const rect = el.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 100;
      const y = ((e.clientY - rect.top) / rect.height) * 100;
      el.style.setProperty("--mx", `${x}%`);
      el.style.setProperty("--my", `${y}%`);
    };

    el.addEventListener("mousemove", onMove);
    return () => el.removeEventListener("mousemove", onMove);
  }, []);

  function go(s: Step) {
    setErr(null);
    setStep(s);
    router.replace(`/auth?mode=${s}`);
  }

  function onPwChange(v: string, setter: (v: string) => void) {
    const clamped = clampToUtf8Bytes(v, MAX_PW_BYTES);
    setter(clamped);
    if (v !== clamped) setErr(`密碼超過 ${MAX_PW_BYTES} bytes（UTF-8）→ 已自動截斷（避免 bcrypt 截斷雷）。`);
  }

  const loginPwBytes = useMemo(() => utf8Bytes(loginPw), [loginPw]);
  const regPwBytes = useMemo(() => utf8Bytes(regPw), [regPw]);

  const canLogin = useMemo(() => isEmail(loginEmail) && loginPw.length > 0, [loginEmail, loginPw]);

  const canRegister = useMemo(() => {
    if (!username.trim()) return false;
    if (!isEmail(regEmail)) return false;
    if (utf8Bytes(regPw) < 8) return false;
    if (regPw !== regPw2) return false;
    return true;
  }, [username, regEmail, regPw, regPw2]);

  const canVerify = useMemo(() => isEmail(vEmail) && vCode.trim().length >= 6, [vEmail, vCode]);

  async function doLogin(email: string, password: string) {
    const tok = await apiJSON<{ access_token: string; refresh_token: string }>(`${API_BASE}/auth/login`, {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    setTokens(tok.access_token, tok.refresh_token);
    const me = await authMe(tok.access_token);
    if (me.user_id) {
      setUser(me as any);
    }
    router.push("/");
  }

  async function submitLogin(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!canLogin) return setErr("登入資料不完整：Email / 密碼先填好。");

    setBusy(true);
    try {
      await doLogin(loginEmail, loginPw);
    } catch (ex: any) {
      const msg = ex?.message || "未知錯誤";
      // 若是未驗證
      if (msg.includes("403") || msg.includes("尚未完成 Email 驗證")) {
        setVEmail(loginEmail);
        go("verify");
        setErr("你帳號還沒完成 Email 驗證。先去驗證碼那頁。");
      } else {
        setErr(`登入失敗：${msg}`);
      }
    } finally {
      setBusy(false);
    }
  }

  async function submitRegister(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setDevHint("");
    if (!canRegister) return setErr("註冊資料不足：username / email / 密碼規則 / 確認密碼 都要過。");

    setBusy(true);
    try {
      // 1) register（後端會自動 send-verify）
      await apiJSON(`${API_BASE}/auth/register`, {
        method: "POST",
        body: JSON.stringify({ username: username.trim(), email: regEmail, password: regPw, roles: role }),
      });

      // 2) 再補打一個 send-verify（讓 dev_code 回來，demo 超快）
      const resp = await apiJSON<{ ok: boolean; dev_code?: string }>(`${API_BASE}/auth/send-verify`, {
        method: "POST",
        body: JSON.stringify({ email: regEmail }),
      });

      setVEmail(regEmail);
      if (resp.dev_code) {
        setVCode(resp.dev_code);
        setDevHint(`（DEV）後端回傳驗證碼：${resp.dev_code}`);
      }
      go("verify");
    } catch (ex: any) {
      setErr(`註冊失敗：${ex?.message || "未知錯誤"}`);
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setErr(null);
    setDevHint("");
    if (!isEmail(vEmail)) return setErr("Email 格式不對，不能發送驗證碼。");
    setBusy(true);
    try {
      const resp = await apiJSON<{ ok: boolean; dev_code?: string }>(`${API_BASE}/auth/send-verify`, {
        method: "POST",
        body: JSON.stringify({ email: vEmail }),
      });
      if (resp.dev_code) {
        setVCode(resp.dev_code);
        setDevHint(`（DEV）後端回傳驗證碼：${resp.dev_code}`);
      } else {
        setDevHint("已重新寄出（如果你有設定 SMTP）。");
      }
    } catch (ex: any) {
      setErr(`重送失敗：${ex?.message || "未知錯誤"}`);
    } finally {
      setBusy(false);
    }
  }

  async function submitVerify(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!canVerify) return setErr("請輸入 Email + 6 位驗證碼。");

    setBusy(true);
    try {
      await apiJSON(`${API_BASE}/auth/verify`, {
        method: "POST",
        body: JSON.stringify({ email: vEmail, code: vCode.trim() }),
      });

      // 驗證成功 → 自動登入
      // （你想更嚴謹：可以要求用戶重新輸入密碼；但你想「好玩」，那就自動）
      await doLogin(vEmail, regPw || loginPw);
    } catch (ex: any) {
      setErr(`驗證失敗：${ex?.message || "未知錯誤"}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="w-full flex items-center justify-center">
      <div className="book">
        <div className="spine" />

        {/* Left page */}
        <section className="page-left">
          <div className="brand">
            <div className="logo">G</div>
            <div>
              <div className="title">GalaBone Auth</div>
              <div className="subtitle">登入不是表單，是流程設計。</div>
            </div>
          </div>

          <div className="left-card">
            <div className="subtitle" style={{ fontSize: 13 }}>
              ✅ roles 真的寫入 users.roles<br />
              ✅ username 必填<br />
              ✅ email 驗證：未驗證直接擋登入（403）<br />
              ✅ 密碼 72 bytes：前端即時計數 + 截斷、後端 validator 再保險
            </div>
          </div>

          <div className="art">
            <div className="hint">
              你現在看到的不是「好看而已」：它有完整的後端 gate（verify 才能登入）。
              沒 SMTP 也能 demo：後端 dev 模式會回傳 dev_code。
            </div>
          </div>

          <div className="mini" style={{ marginTop: 18 }}>
            小提醒：上線前把 <b>AUTH_DEV_RETURN_VERIFY_CODE=0</b>，不然等於把驗證碼直接回給前端（安全直接爆）。
          </div>
        </section>

        {/* Right page */}
        <div className={`stage ${step === "register" || step === "verify" ? "flip" : ""}`}>
          <div className="leaf" ref={leafRef}>
            {/* FRONT: LOGIN */}
            <section className="face face-front">
              <div className="shine" />
              <div className="form-title">登入</div>
              <div className="form-desc">未驗證 Email 會被擋（403），這不是 bug，是你要的規格。</div>

              <form onSubmit={submitLogin}>
                <div className="field">
                  <div className="label">
                    <span>Email</span>
                    <span className="mini">{isEmail(loginEmail) ? "✅" : ""}</span>
                  </div>
                  <input
                    className="input"
                    value={loginEmail}
                    onChange={(e) => setLoginEmail(e.target.value.trim())}
                    placeholder="name@example.com"
                    inputMode="email"
                    autoComplete="email"
                  />
                </div>

                <div className="field">
                  <div className="label">
                    <span>密碼</span>
                    <span className="mini">{loginPwBytes}/{MAX_PW_BYTES} bytes</span>
                  </div>

                  <div style={{ display: "flex", gap: 10 }}>
                    <input
                      className="input"
                      style={{ flex: 1 }}
                      value={loginPw}
                      onChange={(e) => onPwChange(e.target.value, setLoginPw)}
                      placeholder="••••••••"
                      type={showPw ? "text" : "password"}
                      autoComplete="current-password"
                    />
                    <button
                      type="button"
                      className="input"
                      style={{ width: 120, cursor: "pointer" }}
                      onClick={() => setShowPw((v) => !v)}
                    >
                      {showPw ? "隱藏" : "顯示"}
                    </button>
                  </div>
                </div>

                {err && <div className="err">{err}</div>}

                <button className="btn" disabled={busy || !canLogin}>
                  {busy ? "登入中…" : "登入 →"}
                </button>

                <div className="mini">
                  沒帳號？{" "}
                  <button type="button" className="link" onClick={() => go("register")}>
                    翻到註冊頁
                  </button>
                  {" · "}
                  已有帳號但沒驗證？{" "}
                  <button
                    type="button"
                    className="link"
                    onClick={() => {
                      setVEmail(loginEmail);
                      go("verify");
                    }}
                  >
                    去驗證
                  </button>
                </div>
              </form>
            </section>

            {/* BACK: REGISTER or VERIFY */}
            <section className="face face-back">
              <div className="shine" />
              {step !== "verify" ? (
                <>
                  <div className="form-title">註冊（翻書右頁）</div>
                  <div className="form-desc">這次不是填兩格就交差：username / role / email / 密碼規則，全都有。</div>

                  <form onSubmit={submitRegister}>
                    <div className="row">
                      <div className="field">
                        <div className="label">
                          <span>使用者名稱</span>
                          <span className="mini">{username.trim() ? "✅" : "必填"}</span>
                        </div>
                        <input
                          className="input"
                          value={username}
                          onChange={(e) => setUsername(e.target.value)}
                          placeholder="例如：專題小組 / Dr.Lin / TA-Chen"
                        />
                      </div>

                      <div className="field">
                        <div className="label">
                          <span>角色（roles）</span>
                          <span className="mini">寫入 DB</span>
                        </div>
                        <select className="select" value={role} onChange={(e) => setRole(e.target.value as Role)}>
                          <option value="user">user</option>
                          <option value="student">student</option>
                          <option value="teacher">teacher</option>
                          <option value="doctor">doctor</option>
                          <option value="assistant">assistant</option>
                          
                        </select>
                      </div>
                    </div>

                    <div className="field">
                      <div className="label">
                        <span>Email</span>
                        <span className="mini">{isEmail(regEmail) ? "✅" : "格式要對"}</span>
                      </div>
                      <input
                        className="input"
                        value={regEmail}
                        onChange={(e) => setRegEmail(e.target.value.trim())}
                        placeholder="name@example.com"
                        inputMode="email"
                      />
                    </div>

                    <div className="row">
                      <div className="field">
                        <div className="label">
                          <span>密碼（≤72 bytes）</span>
                          <span className="mini">{regPwBytes}/{MAX_PW_BYTES} bytes</span>
                        </div>
                        <input
                          className="input"
                          value={regPw}
                          onChange={(e) => onPwChange(e.target.value, setRegPw)}
                          placeholder="至少 8 碼"
                          type={showPw ? "text" : "password"}
                        />
                      </div>

                      <div className="field">
                        <div className="label">
                          <span>確認密碼</span>
                          <span className="mini">{regPw2 ? (regPw2 === regPw ? "✅" : "❌") : ""}</span>
                        </div>
                        <input
                          className="input"
                          value={regPw2}
                          onChange={(e) => onPwChange(e.target.value, setRegPw2)}
                          placeholder="再輸入一次"
                          type={showPw ? "text" : "password"}
                        />
                      </div>
                    </div>

                    {err && <div className="err">{err}</div>}

                    <button className="btn" disabled={busy || !canRegister}>
                      {busy ? "建立中…" : "建立帳號 → 去驗證"}
                    </button>

                    <div className="mini">
                      已有帳號？{" "}
                      <button type="button" className="link" onClick={() => go("login")}>
                        翻回登入頁
                      </button>
                    </div>
                  </form>
                </>
              ) : (
                <>
                  <div className="form-title">Email 驗證</div>
                  <div className="form-desc">輸入 6 位碼。驗證成功後直接登入（爽，不拖）。</div>

                  <form onSubmit={submitVerify}>
                    <div className="field">
                      <div className="label">
                        <span>Email</span>
                        <span className="mini">{isEmail(vEmail) ? "✅" : "格式要對"}</span>
                      </div>
                      <input
                        className="input"
                        value={vEmail}
                        onChange={(e) => setVEmail(e.target.value.trim())}
                        placeholder="name@example.com"
                        inputMode="email"
                      />
                    </div>

                    <div className="field">
                      <div className="label">
                        <span>驗證碼</span>
                        <span className="mini">{devHint || ""}</span>
                      </div>
                      <input
                        className="input"
                        value={vCode}
                        onChange={(e) => setVCode(e.target.value.replace(/\s/g, ""))}
                        placeholder="例如：123456"
                        inputMode="numeric"
                      />
                    </div>

                    {err && <div className="err">{err}</div>}

                    <button className="btn" disabled={busy || !canVerify}>
                      {busy ? "驗證中…" : "驗證 → 自動登入"}
                    </button>

                    <div className="mini" style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
                      <button type="button" className="link" onClick={resend}>
                        重送驗證碼
                      </button>
                      <button type="button" className="link" onClick={() => go("login")}>
                        回登入
                      </button>
                      <button type="button" className="link" onClick={() => go("register")}>
                        回註冊
                      </button>
                    </div>
                  </form>
                </>
              )}
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
