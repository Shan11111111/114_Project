"use client";

import React, { useMemo, useState } from "react";

const API_BASE =
  process.env.NEXT_PUBLIC_BACKEND_URL || "http://127.0.0.1:8000";

export default function MaterialsUploader() {
  const [file, setFile] = useState<File | null>(null);

  const [title, setTitle] = useState("測試教材");
  const [type, setType] = useState("pdf");
  const [language, setLanguage] = useState("zh-TW");
  const [style, setStyle] = useState("edu");
  const [userId, setUserId] = useState("teacher01");
  const [boneId, setBoneId] = useState<string>("");
  const [boneSmallId, setBoneSmallId] = useState<string>("");
  const [conversationId, setConversationId] = useState<string>("");

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [raw, setRaw] = useState<any>(null);

  const uploadUrl = useMemo(() => `${API_BASE}/s2/materials/upload`, []);

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setErrorMsg(null);
    setRaw(null);

    // 預設 title 用檔名（你也可以自己改）
    const base = f.name.replace(/\.[^/.]+$/, "");
    setTitle(base);
  };

  const onUpload = async () => {
    if (!file) {
      setErrorMsg("請先選擇檔案");
      return;
    }

    setLoading(true);
    setErrorMsg(null);
    setRaw(null);

    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("title", title);
      fd.append("type", type);
      fd.append("language", language);
      fd.append("style", style);
      fd.append("user_id", userId);

      // ✅ 不要送空字串給後端（讓後端拿到 None）
      if (boneId.trim()) fd.append("bone_id", boneId.trim());
      if (boneSmallId.trim()) fd.append("bone_small_id", boneSmallId.trim());
      if (conversationId.trim())
        fd.append("conversation_id", conversationId.trim());

      // 先塞空的 structure_json 就好
      fd.append("structure_json", "{}");

      const res = await fetch(uploadUrl, { method: "POST", body: fd });

      // 如果你又打到 3000，這裡會回 HTML（直接抓出來讓你看清楚）
      const contentType = res.headers.get("content-type") || "";
      const text = await res.text();

      if (!res.ok) {
        throw new Error(`後端錯誤 ${res.status}：${text.slice(0, 300)}`);
      }

      const data = contentType.includes("application/json")
        ? JSON.parse(text)
        : text;

      setRaw(data);
    } catch (e: any) {
      setErrorMsg(e?.message ?? "上傳失敗");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card border border-slate-800 rounded-2xl">
      <h2 className="text-sm font-semibold mb-3">上傳教材並建立索引</h2>

      <label className="block">
        <span className="text-xs text-slate-400">選擇檔案（pdf/txt/docx…）</span>
        <input
          type="file"
          onChange={onPick}
          className="mt-2 block w-full text-sm text-slate-200
                     file:mr-4 file:py-2 file:px-4
                     file:rounded-full file:border-0
                     file:text-sm file:font-semibold
                     file:bg-cyan-500 file:text-slate-900
                     hover:file:bg-cyan-400 cursor-pointer"
        />
      </label>

      <div className="mt-4 grid grid-cols-1 gap-3 text-xs">
        <div>
          <div className="text-slate-400 mb-1">title</div>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full rounded-xl border border-slate-700 bg-slate-900/30 px-3 py-2"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="text-slate-400 mb-1">type</div>
            <input
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="w-full rounded-xl border border-slate-700 bg-slate-900/30 px-3 py-2"
            />
          </div>

          <div>
            <div className="text-slate-400 mb-1">language</div>
            <input
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className="w-full rounded-xl border border-slate-700 bg-slate-900/30 px-3 py-2"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="text-slate-400 mb-1">style</div>
            <input
              value={style}
              onChange={(e) => setStyle(e.target.value)}
              className="w-full rounded-xl border border-slate-700 bg-slate-900/30 px-3 py-2"
            />
          </div>

          <div>
            <div className="text-slate-400 mb-1">user_id</div>
            <input
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              className="w-full rounded-xl border border-slate-700 bg-slate-900/30 px-3 py-2"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="text-slate-400 mb-1">bone_id（可空）</div>
            <input
              value={boneId}
              onChange={(e) => setBoneId(e.target.value)}
              placeholder="例如 8"
              className="w-full rounded-xl border border-slate-700 bg-slate-900/30 px-3 py-2"
            />
          </div>
          <div>
            <div className="text-slate-400 mb-1">bone_small_id（可空）</div>
            <input
              value={boneSmallId}
              onChange={(e) => setBoneSmallId(e.target.value)}
              placeholder="例如 206 細項"
              className="w-full rounded-xl border border-slate-700 bg-slate-900/30 px-3 py-2"
            />
          </div>
        </div>

        <div>
          <div className="text-slate-400 mb-1">conversation_id（可空 GUID）</div>
          <input
            value={conversationId}
            onChange={(e) => setConversationId(e.target.value)}
            placeholder="例如 3fa85f64-5717-4562-b3fc-2c963f66afa6"
            className="w-full rounded-xl border border-slate-700 bg-slate-900/30 px-3 py-2"
          />
        </div>
      </div>

      <button
        onClick={onUpload}
        disabled={loading || !file}
        className="mt-4 w-full rounded-xl py-3 text-sm font-semibold
                   bg-cyan-500 text-slate-900 shadow-lg shadow-cyan-500/40
                   disabled:opacity-50 disabled:cursor-not-allowed
                   hover:bg-cyan-400 transition-colors"
      >
        {loading ? "上傳中..." : "上傳並建立索引"}
      </button>

      {errorMsg && (
        <p className="mt-3 text-xs text-red-400 whitespace-pre-wrap">
          {errorMsg}
        </p>
      )}

      <div className="mt-4 border border-slate-800 rounded-xl p-3 text-xs">
        <div className="text-slate-400 mb-2">回傳（debug）</div>
        <pre className="whitespace-pre-wrap text-[11px] text-green-400">
          {raw ? JSON.stringify(raw, null, 2) : "// 尚無回傳"}
        </pre>
      </div>

      <p className="mt-3 text-[11px] text-slate-500">
        如果你看到一整坨 HTML（This page could not be found）= 你打到前端 3000，不是後端 8000。
      </p>
    </div>
  );
}
