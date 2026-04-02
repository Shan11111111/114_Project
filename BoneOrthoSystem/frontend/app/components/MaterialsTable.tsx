"use client";

import React, { useEffect, useMemo, useState } from "react";
import { getUser } from "../lib/auth";

const API_BASE =
  process.env.NEXT_PUBLIC_BACKEND_URL || "http://127.0.0.1:8000";

const PAGE_SIZE = 10;

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
  const [currentPage, setCurrentPage] = useState(1);

  const listUrl = useMemo(() => `${API_BASE}/s2/materials/list`, []);
  const materialsBaseUrl = useMemo(() => `${API_BASE}/s2/materials`, []);

  const roleLower = role.toLowerCase();
  const isManager = roleLower === "manager";
  const canDelete = roleLower === "manager" || roleLower === "teacher";
  const canView = roleLower === "manager" || roleLower === "teacher";

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

  const canPreviewType = (type: string) => {
    const t = String(type || "").toLowerCase().trim();
    return ["pdf", "txt", "md"].includes(t);
  };

  const isDownloadOnlyType = (type: string) => {
    const t = String(type || "").toLowerCase().trim();
    return ["docx", "pptx"].includes(t);
  };

  const fetchList = async (keyword?: string) => {
    if (!userId) {
      setErr("請先登入，登入後才能查看教材。");
      setRows([]);
      setCurrentPage(1);
      return;
    }

    const finalQ = (keyword ?? q).trim();

    setLoading(true);
    setErr(null);
    setRawText("");

    try {
      const url =
        `${listUrl}?user_id=${encodeURIComponent(userId)}` +
        `&role=${encodeURIComponent(role)}` +
        (finalQ ? `&q=${encodeURIComponent(finalQ)}` : "");

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
      setCurrentPage(1);
    } catch (e: any) {
      setErr(e?.message ?? "載入失敗");
      setRows([]);
      setCurrentPage(1);
    } finally {
      setLoading(false);
    }
  };

  const onDelete = async (materialId: string) => {
    if (!canDelete) {
      alert("你目前沒有刪除教材的權限");
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

  const onDownloadInfo = (type: string) => {
    if (isDownloadOnlyType(type)) {
      alert("此檔案格式僅支援下載，不支援瀏覽器直接預覽。請先下載後再用對應軟體開啟。");
    }
  };

  useEffect(() => {
    if (!isCheckingLogin && isLoggedIn && userId) {
      fetchList("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCheckingLogin, isLoggedIn, userId, role]);

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));

  const pagedRows = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    const end = start + PAGE_SIZE;
    return rows.slice(start, end);
  }, [rows, currentPage]);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const notLoggedIn = !isCheckingLogin && !isLoggedIn;

  return (
    <div className="card border border-slate-800 rounded-2xl h-full p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">教材清單</h2>
          <div className="mt-1 text-[11px] text-slate-500">
            你的身分是 {role}{" "}
            {isManager
              ? "（可查看全部教材 / 可下載全部教材 / 可刪除全部教材）"
              : "（只能操作自己建立的教材：查看 / 下載 / 刪除）"}
          </div>
        </div>

        <button
          onClick={() => fetchList()}
          disabled={loading || isCheckingLogin || !isLoggedIn}
          className="px-3 py-2 rounded-xl text-xs font-semibold border border-slate-700 hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? "載入中..." : "刷新"}
        </button>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 text-xs">
        <div>
          <div className="text-slate-400 mb-1">
            搜尋（檔案名稱 / 教材代碼{isManager ? " / 使用者系統代碼" : ""}）
          </div>

          <div className="flex gap-2">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  fetchList(e.currentTarget.value);
                }
              }}
              disabled={!isLoggedIn}
              className="w-full rounded-xl border border-slate-700 bg-slate-900/30 px-3 py-2 disabled:opacity-50 disabled:cursor-not-allowed"
              placeholder={
                isLoggedIn
                  ? isManager
                    ? "例如:骨折 / 檔案名稱 / 上傳者的使用者系統代碼 "
                    : "例如:骨折 / 檔案名稱"
                  : "請先登入後再搜尋"
              }
            />

            <button
              type="button"
              onClick={() => fetchList()}
              disabled={!isLoggedIn || loading}
              className="px-3 py-2 rounded-xl border border-slate-700 hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              搜尋
            </button>

            <button
              type="button"
              onClick={() => {
                setQ("");
                fetchList("");
              }}
              disabled={!isLoggedIn || loading}
              className="px-3 py-2 rounded-xl border border-slate-700 hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              清除
            </button>
          </div>
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
              {isManager && <th className="text-left p-3">使用者系統代碼</th>}
              <th className="text-left p-3">檔案名稱</th>
              <th className="text-left p-3">檔案格式</th>
              <th className="text-left p-3">語言</th>
              <th className="text-left p-3">內容分類</th>
              <th className="text-left p-3">建立時間</th>
              <th className="text-left p-3">教材代碼</th>
              <th className="text-left p-3">查看(分頁)</th>
              <th className="text-left p-3">下載</th>
              {canDelete && <th className="text-left p-3">刪除</th>}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td className="p-3 text-slate-500" colSpan={isManager ? 10 : 9}>
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
              pagedRows.map((r) => (
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
                    {canView && canPreviewType(r.Type) ? (
                      <a
                        href={
                          `${materialsBaseUrl}/${encodeURIComponent(r.MaterialId)}/view` +
                          `?user_id=${encodeURIComponent(userId)}` +
                          `&role=${encodeURIComponent(role)}`
                        }
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex rounded-lg border border-emerald-700 px-3 py-1.5 text-emerald-300 hover:bg-emerald-950/40"
                      >
                        查看
                      </a>
                    ) : (
                      <span className="text-slate-500">不支援</span>
                    )}
                  </td>

                  <td className="p-3">
                    <a
                      href={
                        `${materialsBaseUrl}/${encodeURIComponent(r.MaterialId)}/download` +
                        `?user_id=${encodeURIComponent(userId)}` +
                        `&role=${encodeURIComponent(role)}`
                      }
                      onClick={() => onDownloadInfo(r.Type)}
                      className="inline-flex rounded-lg border border-cyan-700 px-3 py-1.5 text-cyan-300 hover:bg-cyan-950/40"
                    >
                      下載
                    </a>
                  </td>

                  {canDelete && (
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

      {rows.length > 0 && (
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-xs text-slate-400">
            第 {currentPage} / {totalPages} 頁，共 {rows.length} 筆資料
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setCurrentPage(1)}
              disabled={currentPage === 1}
              className="px-3 py-1.5 rounded-lg border border-slate-700 text-xs hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              第一頁
            </button>

            <button
              type="button"
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="px-3 py-1.5 rounded-lg border border-slate-700 text-xs hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              上一頁
            </button>

            <span className="px-2 text-xs text-slate-300">
              {currentPage}
            </span>

            <button
              type="button"
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="px-3 py-1.5 rounded-lg border border-slate-700 text-xs hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              下一頁
            </button>

            <button
              type="button"
              onClick={() => setCurrentPage(totalPages)}
              disabled={currentPage === totalPages}
              className="px-3 py-1.5 rounded-lg border border-slate-700 text-xs hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              最後頁
            </button>
          </div>
        </div>
      )}
    </div>
  );
}