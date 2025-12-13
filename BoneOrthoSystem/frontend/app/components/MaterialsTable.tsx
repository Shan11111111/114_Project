"use client";

import React, { useEffect, useMemo, useState } from "react";

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
  BoneId: number | null;
  BoneSmallId: number | null;
};

export default function MaterialsTable() {
  const [userId, setUserId] = useState("teacher01");
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<MaterialRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [rawText, setRawText] = useState<string>("");

  const listUrl = useMemo(() => `${API_BASE}/s2/materials/list`, []);

  const fetchList = async () => {
    setLoading(true);
    setErr(null);
    setRawText("");

    try {
      const url =
        `${listUrl}?user_id=${encodeURIComponent(userId)}` +
        (q.trim() ? `&q=${encodeURIComponent(q.trim())}` : "");

      const res = await fetch(url, { cache: "no-store" });
      const ct = res.headers.get("content-type") || "";
      const text = await res.text();

      if (!res.ok) {
        throw new Error(`list API ${res.status}：${text.slice(0, 300)}`);
      }

      if (!ct.includes("application/json")) {
        // 通常代表你又打錯地方拿到 HTML
        setRawText(text.slice(0, 600));
        throw new Error("回傳不是 JSON（你可能打到前端/路徑錯了）");
      }

      const data = JSON.parse(text);
      setRows(data.materials || []);
    } catch (e: any) {
      setErr(e?.message ?? "載入失敗");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="card border border-slate-800 rounded-2xl h-full">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">教材清單</h2>
        <button
          onClick={fetchList}
          className="px-3 py-2 rounded-xl text-xs font-semibold
                     border border-slate-700 hover:bg-slate-800"
        >
          {loading ? "載入中..." : "刷新"}
        </button>
      </div>

      <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
        <div>
          <div className="text-slate-400 mb-1">user_id</div>
          <input
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            className="w-full rounded-xl border border-slate-700 bg-slate-900/30 px-3 py-2"
          />
        </div>
        <div>
          <div className="text-slate-400 mb-1">搜尋（Title / MaterialId）</div>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="w-full rounded-xl border border-slate-700 bg-slate-900/30 px-3 py-2"
            placeholder="例如 骨折 / BDD983..."
          />
        </div>
      </div>

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
              <th className="text-left p-3">Title</th>
              <th className="text-left p-3">Type</th>
              <th className="text-left p-3">Lang</th>
              <th className="text-left p-3">Style</th>
              <th className="text-left p-3">CreatedAt</th>
              <th className="text-left p-3">MaterialId</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td className="p-3 text-slate-500" colSpan={6}>
                  {loading ? "載入中..." : "目前沒有資料（或 list API 尚未完成）"}
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.MaterialId} className="border-t border-slate-800">
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
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-[11px] text-slate-500">
        若這裡一直顯示 HTML/404，請確認 NEXT_PUBLIC_BACKEND_URL 是 8000，且後端有 /s2/materials/list。
      </p>
    </div>
  );
}
