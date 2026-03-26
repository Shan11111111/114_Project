"use client";

import React, { useEffect, useMemo, useState } from "react";
import { getUser } from "../lib/auth";

const API_BASE =
  process.env.NEXT_PUBLIC_BACKEND_URL || "http://127.0.0.1:8000";

type MaterialRow = {
  MaterialId: string;
  UserId: string;
  Type: string;
  Language: string;
  Style: string;
  Title: string;
  FilePath: string;
  CreatedAt: string;
};

export default function MaterialsTable() {
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState("teacher");
  const [isCheckingLogin, setIsCheckingLogin] = useState(true);
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  const [q, setQ] = useState("");
  const [rows, setRows] = useState<MaterialRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [rawText, setRawText] = useState<string>("");

  const listUrl = useMemo(() => `${API_BASE}/s2/materials/list`, []);
  const materialsBaseUrl = useMemo(() => `${API_BASE}/s2/materials`, []);

  const isManager = role.toLowerCase() === "manager";

  useEffect(() => {
    const syncAuth = () => {
      const user = getUser();
      const uid = user?.user_id ?? (user?.id != null ? String(user.id) : "");
      const r = String(user?.roles || "teacher");

      if (uid) {
        setUserId(String(uid));
        setRole(r);
        setIsLoggedIn(true);
      } else {
        setUserId("");
        setRole("teacher");
        setIsLoggedIn(false);
      }

      setIsCheckingLogin(false);
    };

    syncAuth();
    window.addEventListener("auth-changed", syncAuth);
    return () => window.removeEventListener("auth-changed", syncAuth);
  }, []);

  const fetchList = async () => {
    if (!userId) {
      setErr("請先登入，登入後才能查看教材。");
      setRows([]);
      return;
    }

    setLoading(true);
    setErr(null);
    setRawText("");

    try {
      const url =
        `${listUrl}?user_id=${encodeURIComponent(userId)}` +
        `&role=${encodeURIComponent(role)}` +
        (q.trim() ? `&q=${encodeURIComponent(q.trim())}` : "");

      const res = await fetch(url, {
        cache: "no-store",
        credentials: "include",
      });

      const ct = res.headers.get("content-type") || "";
      const text = await res.text();

      if (!res.ok) {
        throw new Error(`list API ${res.status}：${text.slice(0, 300)}`);
      }

      if (!ct.includes("application/json")) {
        setRawText(text.slice(0, 600));
        throw new Error("回傳不是 JSON（你可能打到前端/路徑錯了）");
      }

      const data = JSON.parse(text);
      setRows(data.materials || []);
    } catch (e: any) {
      setErr(e?.message ?? "載入失敗");
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  const onDelete = async (materialId: string) => {
    if (!isManager) {
      alert("只有 manager 可以刪除教材");
      return;
    }

    const ok = window.confirm(`確定要刪除教材 ${materialId} 嗎？`);
    if (!ok) return;

    setDeletingId(materialId);
    setErr(null);

    try {
      const url =
        `${materialsBaseUrl}/${encodeURIComponent(materialId)}` +
        `?user_id=${encodeURIComponent(userId)}` +
        `&role=${encodeURIComponent(role)}`;

      const res = await fetch(url, {
        method: "DELETE",
        credentials: "include",
      });

      const text = await res.text();
      if (!res.ok) {
        throw new Error(text || `刪除失敗 ${res.status}`);
      }

      await fetchList();
    } catch (e: any) {
      setErr(e?.message ?? "刪除失敗");
    } finally {
      setDeletingId(null);
    }
  };

  useEffect(() => {
    if (!isCheckingLogin && isLoggedIn && userId) {
      fetchList();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCheckingLogin, isLoggedIn, userId, role]);

  const notLoggedIn = !isCheckingLogin && !isLoggedIn;

  return (
    <div className="card border border-slate-800 rounded-2xl h-full p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">教材清單</h2>
          <div className="mt-1 text-[11px] text-slate-500">
            目前角色：{role} {isManager ? "（可看全部 / 可刪除）" : "（只看自己的）"}
          </div>
        </div>

        <button
          onClick={fetchList}
          disabled={loading || isCheckingLogin || !isLoggedIn}
          className="px-3 py-2 rounded-xl text-xs font-semibold border border-slate-700 hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? "載入中..." : "刷新"}
        </button>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 text-xs">
        <div>
          <div className="text-slate-400 mb-1">
            搜尋（Title / MaterialId{isManager ? " / UserId" : ""}）
          </div>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            disabled={!isLoggedIn}
            className="w-full rounded-xl border border-slate-700 bg-slate-900/30 px-3 py-2 disabled:opacity-50 disabled:cursor-not-allowed"
            placeholder={
              isLoggedIn
                ? isManager
                  ? "例如 骨折 / BDD983 / 某個 user_id"
                  : "例如 骨折 / BDD983..."
                : "請先登入後再搜尋"
            }
          />
        </div>
      </div>

      {notLoggedIn && (
        <div className="mt-3 rounded-xl border border-amber-900/50 bg-amber-950/30 p-3">
          <div className="text-xs text-amber-200">
            請先登入，未登入不可上傳或查看教材。
          </div>
        </div>
      )}

      {err && (
        <div className="mt-3 rounded-xl border border-red-900/50 bg-red-950/30 p-3">
          <div className="text-xs text-red-300 whitespace-pre-wrap">{err}</div>
          {rawText && (
            <pre className="mt-2 text-[11px] text-red-200 whitespace-pre-wrap">
              {rawText}
            </pre>
          )}
        </div>
      )}

      <div className="mt-4 overflow-auto border border-slate-800 rounded-xl">
        <table className="w-full text-xs">
          <thead className="bg-slate-900/40 text-slate-300">
            <tr>
              {isManager && <th className="text-left p-3">UserId</th>}
              <th className="text-left p-3">Title</th>
              <th className="text-left p-3">Type</th>
              <th className="text-left p-3">Lang</th>
              <th className="text-left p-3">Style</th>
              <th className="text-left p-3">CreatedAt</th>
              <th className="text-left p-3">MaterialId</th>
              <th className="text-left p-3">下載</th>
              {isManager && <th className="text-left p-3">刪除</th>}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td className="p-3 text-slate-500" colSpan={isManager ? 9 : 7}>
                  {isCheckingLogin
                    ? "檢查登入狀態中..."
                    : loading
                    ? "載入中..."
                    : notLoggedIn
                    ? "請先登入"
                    : "目前沒有資料"}
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.MaterialId} className="border-t border-slate-800">
                  {isManager && (
                    <td className="p-3 text-slate-300 font-mono">{r.UserId}</td>
                  )}
                  <td className="p-3 text-slate-100">{r.Title}</td>
                  <td className="p-3 text-slate-300">{r.Type}</td>
                  <td className="p-3 text-slate-300">{r.Language}</td>
                  <td className="p-3 text-slate-300">{r.Style}</td>
                  <td className="p-3 text-slate-400">
                    {String(r.CreatedAt || "").slice(0, 19).replace("T", " ")}
                  </td>
                  <td className="p-3 text-slate-400 font-mono">
                    {r.MaterialId}
                  </td>
                  <td className="p-3">
                    <a
                      href={
                        `${materialsBaseUrl}/${encodeURIComponent(r.MaterialId)}/download` +
                        `?user_id=${encodeURIComponent(userId)}` +
                        `&role=${encodeURIComponent(role)}`
                      }
                      className="inline-flex rounded-lg border border-cyan-700 px-3 py-1.5 text-cyan-300 hover:bg-cyan-950/40"
                    >
                      下載
                    </a>
                  </td>
                  {isManager && (
                    <td className="p-3">
                      <button
                        onClick={() => onDelete(r.MaterialId)}
                        disabled={deletingId === r.MaterialId}
                        className="inline-flex rounded-lg border border-red-700 px-3 py-1.5 text-red-300 hover:bg-red-950/40 disabled:opacity-50"
                      >
                        {deletingId === r.MaterialId ? "刪除中..." : "刪除"}
                      </button>
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}