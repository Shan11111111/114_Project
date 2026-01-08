// frontend/app/lib/auth_api.ts
"use client";

import {
  apiJSON,
  getAccessToken,
  getRefreshToken,
  setTokens,
  clearAuth,
  setUser,
} from "./auth";

const API_BASE = (process.env.NEXT_PUBLIC_BACKEND_URL || "http://127.0.0.1:8000").replace(/\/+$/, "");
const AUTH_BASE = `${API_BASE}/auth`;

export type UserOut = {
  user_id: string;
  username?: string | null;
  email?: string | null;
  roles?: string | null;
  states?: string | null;
};

export type TokenOut = {
  access_token: string;
  refresh_token: string;
  token_type: "bearer";
};

export type RegisterIn = {
  username: string;
  email: string;
  password: string;
};

export type LoginIn = {
  email: string;
  password: string;
};

// ✅ 前端也做 bcrypt 72 bytes 限制（跟你後端一致）
export function assertPassword72Bytes(pw: string) {
  const bytes = new TextEncoder().encode(pw).length;
  if (bytes > 72) {
    throw new Error("密碼太長：bcrypt 最多 72 bytes（英文約 72 字；中文大概 24 字內）。");
  }
}

async function authFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const access = getAccessToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init?.headers as any),
  };

  if (access) headers.Authorization = `Bearer ${access}`;

  const res = await fetch(url, { ...init, headers });

  // ✅ access 過期 → refresh 一次 → 重打一次
  if (res.status === 401 && getRefreshToken()) {
    try {
      await refreshTokens();
      const access2 = getAccessToken();
      const headers2: Record<string, string> = { ...headers };
      if (access2) headers2.Authorization = `Bearer ${access2}`;
      const res2 = await fetch(url, { ...init, headers: headers2 });

      if (!res2.ok) {
        const txt2 = await res2.text().catch(() => "");
        throw new Error(txt2 || `HTTP ${res2.status}`);
      }
      return (await res2.json()) as T;
    } catch {
      clearAuth();
      throw new Error("登入已過期，請重新登入");
    }
  }

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(txt || `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

export async function registerUser(payload: RegisterIn): Promise<UserOut> {
  assertPassword72Bytes(payload.password);
  return await apiJSON<UserOut>(`${AUTH_BASE}/register`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function loginUser(payload: LoginIn): Promise<{ user: UserOut; tokens: TokenOut }> {
  assertPassword72Bytes(payload.password);

  const tokens = await apiJSON<TokenOut>(`${AUTH_BASE}/login`, {
    method: "POST",
    body: JSON.stringify(payload),
  });

  setTokens(tokens.access_token, tokens.refresh_token);

  const user = await me();
  setUser({
    user_id: user.user_id,
    username: user.username ?? undefined,
    email: user.email ?? undefined,
    roles: user.roles ?? undefined,
    states: user.states ?? undefined,
  });

  return { user, tokens };
}

export async function me(): Promise<UserOut> {
  return await authFetch<UserOut>(`${AUTH_BASE}/me`, { method: "GET" });
}

export async function logoutUser(): Promise<void> {
  const rt = getRefreshToken();
  try {
    if (rt) {
      await apiJSON<{ ok: boolean }>(`${AUTH_BASE}/logout`, {
        method: "POST",
        body: JSON.stringify({ refresh_token: rt }),
      });
    }
  } finally {
    clearAuth();
  }
}

export async function refreshTokens(): Promise<TokenOut> {
  const rt = getRefreshToken();
  if (!rt) throw new Error("缺少 refresh_token");

  const tokens = await apiJSON<TokenOut>(`${AUTH_BASE}/refresh`, {
    method: "POST",
    body: JSON.stringify({ refresh_token: rt }),
  });

  // refresh 回來通常沿用同一顆 refresh_token，但你後端會回傳 refresh_token=rt
  setTokens(tokens.access_token, tokens.refresh_token);
  return tokens;
}
