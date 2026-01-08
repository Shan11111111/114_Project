// frontend/lib/auth.ts
"use client";

export type AuthTokens = {
  access_token: string;
  refresh_token: string;
  token_type?: string;
};

const KEY_ACCESS = "gb_access_token";
const KEY_REFRESH = "gb_refresh_token";

export function setTokens(t: AuthTokens) {
  localStorage.setItem(KEY_ACCESS, t.access_token);
  localStorage.setItem(KEY_REFRESH, t.refresh_token);
}

export function getAccessToken(): string | null {
  return typeof window === "undefined" ? null : localStorage.getItem(KEY_ACCESS);
}

export function getRefreshToken(): string | null {
  return typeof window === "undefined" ? null : localStorage.getItem(KEY_REFRESH);
}

export function clearTokens() {
  localStorage.removeItem(KEY_ACCESS);
  localStorage.removeItem(KEY_REFRESH);
}

export function authHeader(): Record<string, string> {
  const token = getAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function backendBase(): string {
  const base = (process.env.NEXT_PUBLIC_BACKEND_URL || "http://127.0.0.1:8000").replace(/\/+$/, "");
  return base;
}
