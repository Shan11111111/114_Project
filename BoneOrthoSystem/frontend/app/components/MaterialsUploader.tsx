"use client";

import React, { useEffect, useMemo, useState } from "react";
import { getUser } from "../lib/auth";

const API_BASE =
  process.env.NEXT_PUBLIC_BACKEND_URL || "http://127.0.0.1:8000";

function inferTypeFromFileName(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  if (["pdf", "txt", "docx", "pptx", "md"].includes(ext)) {
    return ext;
  }
  return "file";
}

export default function MaterialsUploader() {
  const [file, setFile] = useState<File | null>(null);

  const [userId, setUserId] = useState("");
  const [isCheckingLogin, setIsCheckingLogin] = useState(true);
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [raw, setRaw] = useState<any>(null);

  const uploadUrl = useMemo(() => `${API_BASE}/s2/materials/upload`, []);

  useEffect(() => {
    const syncAuth = () => {
      const user = getUser();

      console.log("=== MaterialsUploader syncAuth vUPLOADER-20260326-02 ===");
      console.log("user =", user);
      console.log("user_id =", user?.user_id);
      console.log("id =", user?.id);

      const uid = user?.user_id ?? (user?.id != null ? String(user.id) : "");

      if (uid) {
        setUserId(String(uid));
        setIsLoggedIn(true);
      } else {
        setUserId("");
        setIsLoggedIn(false);
      }

      setIsCheckingLogin(false);
    };

    syncAuth();
    window.addEventListener("auth-changed", syncAuth);
    return () => window.removeEventListener("auth-changed", syncAuth);
  }, []);

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setErrorMsg(null);
    setRaw(null);
  };

  const onUpload = async () => {
    if (!isLoggedIn || !userId) {
      setErrorMsg("請先登入，未登入不可上傳教材");
      return;
    }

    if (!file) {
      setErrorMsg("請先選擇檔案");
      return;
    }

    setLoading(true);
    setErrorMsg(null);
    setRaw(null);

    try {
      const title = file.name.replace(/\.[^/.]+$/, "");
      const type = inferTypeFromFileName(file.name);
      const language = "zh-TW";
      const style = "edu";

      const fd = new FormData();
      fd.append("file", file);
      fd.append("title", title);
      fd.append("type", type);
      fd.append("language", language);
      fd.append("style", style);
      fd.append("user_id", userId);
      fd.append("structure_json", "{}");

      const res = await fetch(uploadUrl, {
        method: "POST",
        body: fd,
        credentials: "include",
      });

      const contentType = res.headers.get("content-type") || "";
      const text = await res.text();

      if (!res.ok) {
        throw new Error(`後端錯誤 ${res.status}：${text.slice(0, 300)}`);
      }

      const data = contentType.includes("application/json")
        ? JSON.parse(text)
        : text;

      setRaw(data);
      setFile(null);

      const input = document.getElementById(
        "materials-upload-input"
      ) as HTMLInputElement | null;
      if (input) input.value = "";
    } catch (e: any) {
      setErrorMsg(e?.message ?? "上傳失敗");
    } finally {
      setLoading(false);
    }
  };

  const notLoggedIn = !isCheckingLogin && !isLoggedIn;

  return (
    <div className="materials-card w-full min-w-0 max-w-full overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <h2 className="text-sm font-semibold mb-3 text-slate-900 dark:text-slate-100">
        上傳教材並建立索引
      </h2>

      <label className="block">
        <span className="text-xs text-slate-400">選擇檔案（pdf/txt/docx/pptx/md/）</span>
        <input
          id="materials-upload-input"
          type="file"
          onChange={onPick}
          disabled={!isLoggedIn}
          className="mt-2 block w-full text-sm text-slate-200
                     file:mr-4 file:py-2 file:px-4
                     file:rounded-full file:border-0
                     file:text-sm file:font-semibold
                     file:bg-cyan-500 file:text-slate-900
                     hover:file:bg-cyan-400 cursor-pointer
                     disabled:opacity-50 disabled:cursor-not-allowed"
        />
      </label>

      <div className="mt-3 rounded-xl border border-white/10 bg-white/5 p-3 text-xs text-slate-300">
        <div>檔名：{file?.name || "尚未選擇檔案"}</div>
        <div className="break-all">
          登入者：{isCheckingLogin ? "檢查登入中..." : userId || "請先登入"}
        </div>
      </div>

      {notLoggedIn && (
        <div className="mt-3 rounded-xl border border-amber-900/50 bg-amber-950/30 p-3">
          <div className="text-xs text-amber-200">
            請先登入，未登入不可上傳教材。
          </div>
        </div>
      )}

      <button
        onClick={onUpload}
        disabled={loading || !file || !isLoggedIn || isCheckingLogin}
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

      <div className="mt-4 rounded-xl border border-white/10 bg-white/5 p-3 text-xs">
        <div className="mb-2 text-slate-400">請確認下列欄位中是否顯示上傳成功</div>
        <pre className="whitespace-pre-wrap text-[11px] text-green-400">
          {raw ? "上傳成功!!!\n" + JSON.stringify(raw, null, 2) : "// 尚無上傳檔案成功的回應資料"}
        </pre>
      </div>
    </div>
  );
}