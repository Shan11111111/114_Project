"use client";

import React, { useEffect, useMemo, useState } from "react";
import { getUser } from "../lib/auth";

import {
  Eye,
  Download,
  Trash2,
  Search,
  RefreshCcw,
} from "lucide-react";

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
    <div className="materials-table-card w-full min-w-0 max-w-full rounded-2xl border border-slate-200 bg-white p-4 shadow-sm
                dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">教材清單</h2>
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
          className="px-3 py-2 rounded-xl text-xs font-semibold border border-slate-300 text-slate-700 dark:text-slate-300 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <span className="flex items-center gap-1">
            <RefreshCcw className="w-4 h-4" />
            {loading ? "載入中..." : "刷新"}
          </span>
        </button>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 text-xs">
        <div>
          <div className="text-slate-500 mb-1">
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
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-slate-800 dark:text-slate-100 
           placeholder:text-slate-400 disabled:opacity-50 
           dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500"              placeholder={
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
              className="px-3 py-2 rounded-xl border border-slate-300 text-slate-700 dark:text-slate-300 hover:bg-slate-50 
           dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"            >
              <span className="flex items-center gap-1">
                <Search className="w-4 h-4" />
                搜尋
              </span>
            </button>

            <button
              type="button"
              onClick={() => {
                setQ("");
                fetchList("");
              }}
              disabled={!isLoggedIn || loading}
              className="px-3 py-2 rounded-xl border border-slate-300 text-slate-700 dark:text-slate-300 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              清除
            </button>
          </div>
        </div>
      </div>

      {notLoggedIn && (
        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
          <div className="text-xs text-amber-700">
            請先登入，未登入不可上傳或查看教材。
          </div>
        </div>
      )}

      {err && (
        <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3">
          <div className="text-xs text-red-600 whitespace-pre-wrap">{err}</div>
          {rawText && (
            <pre className="mt-2 text-[11px] text-red-500 whitespace-pre-wrap">
              {rawText}
            </pre>
          )}
        </div>
      )}

      <div className="mt-4 w-full min-w-0 max-w-full overflow-x-auto 
                    border border-slate-200 rounded-xl bg-white
                    dark:border-slate-700 dark:bg-slate-950">
        <table className="min-w-[820px] w-full text-xs">
          <thead className="bg-slate-50 text-slate-600 border-b border-slate-200
                 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700">
            <tr>
              {isManager && (
                <th className="px-4 py-3 text-left text-xs font-semibold whitespace-nowrap">
                  使用者系統代碼
                </th>
              )}
              <th className="px-4 py-3 text-left text-xs font-semibold whitespace-nowrap">檔案名稱</th>
              <th className="px-4 py-3 text-left text-xs font-semibold whitespace-nowrap">檔案格式</th>
              <th className="px-4 py-3 text-left text-xs font-semibold whitespace-nowrap">語言</th>
              <th className="px-4 py-3 text-left text-xs font-semibold whitespace-nowrap">內容分類</th>
              <th className="px-4 py-3 text-left text-xs font-semibold whitespace-nowrap">建立時間</th>
              <th className="px-4 py-3 text-left text-xs font-semibold whitespace-nowrap">教材代碼</th>

              <th className="sticky right-0 z-10 bg-slate-50 dark:bg-slate-800 px-4 py-3 text-center text-xs font-semibold whitespace-nowrap shadow-[-8px_0_12px_-12px_rgba(15,23,42,0.35)]">
                操作
              </th>
            </tr>
          </thead>

          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  className="px-4 py-3 text-slate-500"
                  colSpan={isManager ? 8 : 7}
                >
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
                <tr
                  key={r.MaterialId}
                  className="border-t border-slate-200 dark:border-slate-700 
                  bg-white dark:bg-slate-950 
                  hover:bg-slate-50 dark:hover:bg-slate-800">
                  {isManager && (
                    <td className="px-4 py-2 text-slate-700 dark:text-slate-300 align-middle font-mono max-w-[150px] truncate">
                      {r.UserId}
                    </td>
                  )}

                  <td className="px-4 py-2 text-slate-800 dark:text-slate-100 dark:text-slate-300 align-middle max-w-[170px] truncate">
                    {r.Title}
                  </td>

                  <td className="px-4 py-2 text-slate-700 dark:text-slate-300 align-middle whitespace-nowrap">
                    {r.Type}
                  </td>

                  <td className="px-4 py-2 text-slate-700 dark:text-slate-300 align-middle whitespace-nowrap">
                    {r.Language}
                  </td>

                  <td className="px-4 py-2 text-slate-700 dark:text-slate-300 align-middle whitespace-nowrap">
                    {r.Style}
                  </td>

                  <td className="px-4 py-2 text-slate-700 dark:text-slate-300 align-middle whitespace-nowrap">
                    {String(r.CreatedAt || "").slice(0, 19).replace("T", " ")}
                  </td>

                  <td className="px-4 py-2 text-slate-700 dark:text-slate-300 align-middle font-mono max-w-[170px] truncate">
                    {r.MaterialId}
                  </td>

                  <td className="sticky right-0 bg-white dark:bg-slate-950 px-4 py-2 align-middle 
                                  shadow-[-8px_0_12px_-12px_rgba(15,23,42,0.35)]">
                    <div className="flex items-center justify-center gap-2 whitespace-nowrap">
                      {canView && canPreviewType(r.Type) ? (
                        <a
                          href={
                            `${materialsBaseUrl}/${encodeURIComponent(r.MaterialId)}/view` +
                            `?user_id=${encodeURIComponent(userId)}` +
                            `&role=${encodeURIComponent(role)}`
                          }
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-emerald-500 bg-white text-emerald-600 hover:bg-emerald-50 dark:bg-slate-900 dark:text-emerald-400 dark:hover:bg-emerald-900/20" title="查看"
                        >
                          <Eye className="h-4 w-4" />
                        </a>
                      ) : (
                        <span className="inline-flex h-8 w-8 items-center justify-center text-slate-300">
                          -
                        </span>
                      )}

                      <a
                        href={
                          `${materialsBaseUrl}/${encodeURIComponent(r.MaterialId)}/download` +
                          `?user_id=${encodeURIComponent(userId)}` +
                          `&role=${encodeURIComponent(role)}`
                        }
                        onClick={() => onDownloadInfo(r.Type)}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-sky-500 bg-white text-sky-600 hover:bg-sky-50 dark:bg-slate-900 dark:text-sky-400 dark:hover:bg-sky-900/20" title="下載"
                      >
                        <Download className="h-4 w-4" />
                      </a>

                      {canDelete && (
                        <button
                          onClick={() => onDelete(r.MaterialId)}
                          disabled={deletingId === r.MaterialId}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-red-500 bg-white text-red-600 hover:bg-red-50 disabled:opacity-50 dark:bg-slate-900 dark:text-red-400 dark:hover:bg-red-900/20" title={deletingId === r.MaterialId ? "刪除中..." : "刪除"}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {rows.length > 0 && (
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-xs text-slate-500">
            第 {currentPage} / {totalPages} 頁，共 {rows.length} 筆資料
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setCurrentPage(1)}
              disabled={currentPage === 1}
              className="px-3 py-1.5 rounded-lg border border-slate-300 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"            >
              第一頁
            </button>

            <button
              type="button"
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="px-3 py-1.5 rounded-lg border border-slate-300 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"            >
              上一頁
            </button>

            <span className="px-2 text-xs text-slate-500">{currentPage}</span>

            <button
              type="button"
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="px-3 py-1.5 rounded-lg border border-slate-300 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"            >
              下一頁
            </button>

            <button
              type="button"
              onClick={() => setCurrentPage(totalPages)}
              disabled={currentPage === totalPages}
              className="px-3 py-1.5 rounded-lg border border-slate-300 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"            >
              最後頁
            </button>
          </div>
        </div>
      )}
    </div>
  );
}