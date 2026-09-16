// 沒修好的地方會先放在這裡
"use client";
import "./llm-page.css";

import { useSearchParams, useRouter } from "next/navigation";

import React, {
  FormEvent,
  KeyboardEvent,
  ChangeEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  useCallback,
  memo,
  Suspense,
} from "react";

import S2PrivacyConsent from "./S2PrivacyConsent";
import S2SensitiveInfoModal from "./S2SensitiveInfoModal";
import { getUser, getAccessToken } from "../lib/auth";
import {
  detectSensitiveInfo,
  maskSensitiveInfo,
  normalizeLegacyMaskedText,
  type SensitiveHit,
} from "./piiGuard";
type UploadedFile = {
  id: string;
  name: string;
  size: number;
  type: number | string;
  url: string;
  raw?: File; //真正要上傳的 File
  serverUrl?: string; //新增：後端回來的 url（如果你要記）
};

type ChatResource = {
  title: string;
  display_title?: string;
  url?: string;
  download_url?: string;
  external_url?: string;
  source_type?: string;
  page?: string;
  snippet?: string;
  score?: number;
  material_id?: string;
};

type ChatMessage = {
  id: number;
  role: "user" | "assistant";
  content: string;
  files?: UploadedFile[];
  resources?: ChatResource[];
};

type ViewKey = "llm" | "assets";

type HistoryThread = {
  id: string;
  title: string;
  updatedAt: string;
  preview: string;
  messageCount: number;
  sessionId?: string; //  新增：不顯示，只用於繼續聊天
};

type HistoryMessageWithResources = HistoryMessage & {
  resources?: ChatResource[];
};

type HistoryMessage = {
  id: string;
  threadId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  resources?: ChatResource[];
};

type RagMode = "file_then_vector" | "vector_only" | "file_only" | "pubmed_only" | "soap_only";
/**  S1 bootstrap detections（支援 bbox / poly / PolyJson / P1~P4） */
type Detection = {
  bone_id?: number | null;
  bone_zh?: string | null;
  bone_en?: string | null;
  label41?: number | string | null;
  confidence?: number | null;

  // normalized bbox
  bbox?: [number | null, number | null, number | null, number | null] | null;

  // normalized poly（四點）
  poly?: [number, number][] | null;

  // DB 欄位可能回：PolyJson / P1X..P4Y
  PolyJson?: string | null;
  PolyIsNormalized?: boolean | null;

  P1X?: number | null;
  P1Y?: number | null;
  P2X?: number | null;
  P2Y?: number | null;
  P3X?: number | null;
  P3Y?: number | null;
  P4X?: number | null;
  P4Y?: number | null;

  // 可能還有 Cx/Cy/W/H/AngleDeg（先不處理也沒關係）
  Cx?: number | null;
  Cy?: number | null;
  W?: number | null;
  H?: number | null;
  AngleDeg?: number | null;
};

// 假 LLM 回覆
function fakeLLMReply(prompt: string): string {
  if (prompt.length < 10) {
    return "（Demo 回覆）可以再多描述一點你的問題嗎？例如：哪一塊骨頭、哪一句報告看不懂？";
  }
  if (prompt.includes("骨折")) {
    return "（Demo 回覆）骨折就是骨頭出現裂痕或斷裂，嚴重程度從細小裂縫到完全斷開都有。通常會搭配 X 光判斷位置與型態，治療方式可能包含固定、石膏或手術。";
  }
  return `（Demo 回覆）你剛剛說：「${prompt}」。正式版本會把這段文字送到後端的大語言模型，產生真正的解釋。`;
}

const MIN_HEIGHT = 28;
const MAX_HEIGHT = 120;

const WELCOME_TEXT = `嗨，我是 GalaBone LLM 知識小助手。

我們的目標是成為骨科醫護的好幫手，幫你快速理解醫療報告、病歷記錄，甚至是 X 光影像裡的骨頭狀況。
依據：各大醫院刊登衛教之文件、PubMed 文獻、以及我們團隊整理的骨科專業資料庫。

使用說明：
1. 你可以直接輸入醫療報告裡的文字，或是病歷記錄的內容，我會盡力幫你解釋。
2. 如果你有 X 光影像的分析結果（例如骨折位置、骨頭名稱），也可以輸入給我，我會試著幫你理解那些專業術語。
3. 請注意，GalaBone 的回覆是基於訓練資料和模型推論，可能不完全正確或適用於你的情況。任何醫療決策都應該諮詢專業醫護人員。
4. 請勿輸入任何敏感個資或真實姓名，保護你的隱私安全。
5. 如果你有任何建議或回饋，歡迎告訴我們，讓 GalaBone 變得更好！
期待能成為你在骨科領域的好幫手！
`;

// ==============================
//  後端 API（搬 C 的連線；不影響 D 的 UI）
// ==============================
const API_BASE = (
  process.env.NEXT_PUBLIC_BACKEND_URL ||
  process.env.NEXT_PUBLIC_API_BASE ||
  "http://127.0.0.1:8000"
).replace(/\/+$/, "");

const S2X_BASE = `${API_BASE}/s2x`;
//  新增：檢查是否有設定後端 URL，沒有的話可以直接提示（不影響 UI）
const HAS_BACKEND =
  !!process.env.NEXT_PUBLIC_BACKEND_URL ||
  !!process.env.NEXT_PUBLIC_API_BASE;

//  C 裡的 bootstrap（S1 -> S2）
const BOOT_URL = `${API_BASE}/s2/agent/bootstrap-from-s1`;

//  C 裡集中管理的 API endpoints（conversations 也一起帶過來）
const API = {
  health: `${S2X_BASE}/health`,
  upload: `${S2X_BASE}/upload`,
  chat: `${S2X_BASE}/agent/chat`,
  chatStream: `${S2X_BASE}/agent/chat/stream`,
  exportPdf: `${S2X_BASE}/export/pdf`,
  exportPptx: `${S2X_BASE}/export/pptx`,
  listConvs: (uid: string) =>
    `${S2X_BASE}/agent/conversations?user_id=${encodeURIComponent(uid)}`,
  getMsgs: (cid: string) => `${S2X_BASE}/agent/conversations/${cid}/messages`,

  //   修正：後端正確的 title endpoint（你 main.py 是 /agent/conversations/{id}/title）
  updateConvTitle: (cid: string) =>
    `${S2X_BASE}/agent/conversations/${cid}/title`,

  //  兼容：有些後端可能做在 /agent/conversations/{id}
  updateConvTitleFallback: (cid: string) => `${S2X_BASE}/agent/conversations/${cid}`,
};
// 

function safeJsonParse<T = any>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function toAbsUrl(maybeUrl?: string) {
  if (!maybeUrl) return "";
  if (maybeUrl.startsWith("http://") || maybeUrl.startsWith("https://")) {
    return maybeUrl;
  }

  const path = maybeUrl.startsWith("/") ? maybeUrl : `/${maybeUrl}`;
  return `${API_BASE}${path}`;
}

async function uploadOneFileToBackend(file: File) {
  const fd = new FormData();
  fd.append("file", file);

  const res = await fetch(API.upload, {
    method: "POST",
    headers: buildAuthHeaders(),
    body: fd,
  });

  const raw = await res.text();
  const data = safeJsonParse(raw);

  if (!res.ok || !data) {
    throw new Error(`上傳失敗 ${res.status}：${raw.slice(0, 300)}`);
  }
  return data;
}

async function postChatToBackend(payload: any) {
  const res = await fetch(API.chat, {
    method: "POST",
    headers: buildAuthHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(payload),
  });

  const raw = await res.text();
  const data = safeJsonParse(raw);

  if (!res.ok || !data) {
    // 保留原始 raw，方便你 debug 422/500
    throw new Error(`Chat 失敗 ${res.status}：${raw.slice(0, 300)}`);
  }
  return data;
}

async function postChatStreamToBackend(
  payload: any,
  handlers: {
    onMeta?: (data: any) => void;
    onSources?: (data: any[]) => void;
    onToken?: (token: string) => void;
    onDone?: (data: any) => void;
    onError?: (data: any) => void;
  }
) {
  const res = await fetch(API.chatStream, {
    method: "POST",
    headers: buildAuthHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(payload),
  });

  if (!res.ok || !res.body) {
    const raw = await res.text().catch(() => "");
    throw new Error(`Chat 串流失敗 ${res.status}：${raw.slice(0, 300)}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.trim()) continue;

      let evt: any = null;
      try {
        evt = JSON.parse(line);
      } catch (err) {
        console.error("stream parse failed:", line);
        continue;
      }

      if (evt.type === "meta") handlers.onMeta?.(evt);
      else if (evt.type === "sources") handlers.onSources?.(evt.data || []);
      else if (evt.type === "token") handlers.onToken?.(String(evt.data || ""));
      else if (evt.type === "done") handlers.onDone?.(evt);
      else if (evt.type === "error") handlers.onError?.(evt);
    }
  }

  if (buffer.trim()) {
    try {
      const evt = JSON.parse(buffer);
      if (evt.type === "done") handlers.onDone?.(evt);
    } catch {
      console.warn("最後殘留 buffer 不是完整 JSON:", buffer);
    }
  }
}



async function apiUpdateConversationTitle(conversationId: string, title: string) {
  //   先打 /title；如果後端沒有這條路，再 fallback /{id}
  const body = JSON.stringify({ title });

  // 1) /title
  const r1 = await fetch(API.updateConvTitle(conversationId), {
    method: "PATCH",
    headers: buildAuthHeaders({ "Content-Type": "application/json" }),
    body,
  });

  if (r1.ok) {
    const raw = await r1.text().catch(() => "");
    return safeJsonParse(raw) ?? raw;
  }

  // 2) fallback /{id}（有些人寫成 /agent/conversations/{id}）
  const r2 = await fetch(API.updateConvTitleFallback(conversationId), {
    method: "PATCH",
    headers: buildAuthHeaders({ "Content-Type": "application/json" }),
    body,
  });

  const raw2 = await r2.text().catch(() => "");
  const data2 = safeJsonParse(raw2);

  if (!r2.ok) {
    throw new Error(`update title 失敗 ${r2.status}: ${raw2.slice(0, 200)}`);
  }
  return data2 ?? raw2;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

//  export：沿用 D 現在的 UI，但 endpoint 改用 C 的 API.exportPdf/exportPptx
async function exportToBackend(
  type: "pdf" | "pptx",
  payload: { session_id: string; user_id: string; messages: any[] }
) {
  const url = type === "pdf" ? API.exportPdf : API.exportPptx;

  const res = await fetch(url, {
    method: "POST",
    headers: buildAuthHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const raw = await res.text().catch(() => "");
    throw new Error(`匯出失敗 ${res.status}：${raw.slice(0, 300)}`);
  }

  return await res.blob();
}

// ==============================
//  LocalStorage 快取（方案 A）
// ==============================
const LS_NS = "gab_llm_v1";

function lsKey(uid: string) {
  const safe = (uid || "guest").trim() || "guest";
  return `${LS_NS}::${safe}`;
}

const GUEST_TTL_MS = 24 * 60 * 60 * 1000;

function isGuestUid(uid: string) {
  return !uid || uid === "guest" || uid.startsWith("guest-");
}

function lsRead(uid: string): any | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = localStorage.getItem(lsKey(uid));
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;

    // 訪客資料超過一天就清掉
    if (isGuestUid(uid)) {
      const expireAt = Number(parsed.expireAt || 0);
      if (expireAt && Date.now() > expireAt) {
        localStorage.removeItem(lsKey(uid));
        return null;
      }
    }

    return parsed;
  } catch {
    return null;
  }
}

function lsWrite(uid: string, value: any) {
  if (typeof window === "undefined") return;

  // 訪客不保存聊天歷史
  if (isGuestUid(uid)) {
    try {
      localStorage.removeItem(lsKey(uid));
    } catch { }
    return;
  }

  try {
    const payload = {
      ...value,
      expireAt: null,
    };

    localStorage.setItem(lsKey(uid), JSON.stringify(payload));
  } catch {
    // ignore
  }
}

function lsSafeNow() {
  try {
    return new Date().toLocaleString();
  } catch {
    return "";
  }
}

function getClientIdentity() {
  if (typeof window === "undefined") {
    return {
      mode: "guest" as const,
      userId: "guest",
    };
  }

  try {
    const authUser = getUser();
    if (authUser?.user_id) {
      return {
        mode: "member" as const,
        userId: String(authUser.user_id),
      };
    }

    const GUEST_KEY = "guest_user_id";
    let guestId = localStorage.getItem(GUEST_KEY);

    if (!guestId) {
      guestId =
        typeof crypto !== "undefined" &&
          "randomUUID" in crypto &&
          typeof crypto.randomUUID === "function"
          ? `guest-${crypto.randomUUID()}`
          : `guest-${Date.now()}-${Math.random().toString(16).slice(2)}`;

      localStorage.setItem(GUEST_KEY, guestId);
    }

    return {
      mode: "guest" as const,
      userId: guestId,
    };
  } catch {
    return {
      mode: "guest" as const,
      userId: "guest",
    };
  }
}

// 清理 URL.createObjectURL 產生的 blob URL，避免 memory leak
function cleanupPendingFiles(files: UploadedFile[]) {
  files.forEach((f) => {
    if (f.url?.startsWith("blob:")) {
      URL.revokeObjectURL(f.url);
    }
  });
}



function buildAuthHeaders(extra?: Record<string, string>) {
  const token = getAccessToken() || "";
  return {
    ...(extra || {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

function makeUuid() {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return `tmp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

// ==============================
//  Detection Viewer（最小侵入：只加一張卡片，不動你現有聊天 UI）
// ==============================

const LABEL41_ZH: Record<number, string> = {
  10: "掌骨",
  14: "手指骨",
  16: "腕骨",
};

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function toNum(v: any): number | null {
  const n =
    typeof v === "number" ? v : v === null || v === undefined ? NaN : Number(v);
  return Number.isFinite(n) ? n : null;
}

function formatDetName(d: Detection) {
  const zh = (d.bone_zh ?? "").trim();
  if (zh) return zh;

  const l = d.label41;
  const lid = typeof l === "string" ? Number(l) : l;
  if (typeof lid === "number" && Number.isFinite(lid) && LABEL41_ZH[lid]) {
    return `${LABEL41_ZH[lid]}（${lid}）`;
  }

  if (typeof lid === "number" && Number.isFinite(lid)) return `label41=${lid}`;
  if (typeof l === "string" && l.trim()) return `label41=${l.trim()}`;
  return "Unknown";
}

function parsePolyFromDetection(d: Detection): [number, number][] | null {
  if (Array.isArray(d.poly) && d.poly.length >= 4) {
    const pts = d.poly
      .map((p) => [toNum(p?.[0]), toNum(p?.[1])] as any)
      .filter((p) => p[0] !== null && p[1] !== null)
      .map((p) => [p[0] as number, p[1] as number] as [number, number]);
    if (pts.length >= 4)
      return pts;
  }

  const pj = (d as any).polyJson ?? d.PolyJson;
  if (typeof pj === "string" && pj.trim()) {
    const obj = safeJsonParse(pj.trim());
    if (Array.isArray(obj) && obj.length >= 4) {
      const pts = obj
        .map((p: any) => [toNum(p?.[0]), toNum(p?.[1])] as any)
        .filter((p) => p[0] !== null && p[1] !== null)
        .map((p) => [p[0] as number, p[1] as number] as [number, number]);
      if (pts.length >= 4) return pts;
    }
    if (obj && Array.isArray(obj.poly) && obj.poly.length >= 4) {
      const pts = obj.poly
        .map((p: any) => [toNum(p?.[0]), toNum(p?.[1])] as any)
        .filter((p: [number | null, number | null]) => p[0] !== null && p[1] !== null)
        .map((p: [number | null, number | null]) => [p[0] as number, p[1] as number] as [number, number]);

      if (pts.length >= 4) return pts;
    }
  }

  const p1x = toNum(d.P1X),
    p1y = toNum(d.P1Y);
  const p2x = toNum(d.P2X),
    p2y = toNum(d.P2Y);
  const p3x = toNum(d.P3X),
    p3y = toNum(d.P3Y);
  const p4x = toNum(d.P4X),
    p4y = toNum(d.P4Y);

  if (
    p1x !== null &&
    p1y !== null &&
    p2x !== null &&
    p2y !== null &&
    p3x !== null &&
    p3y !== null &&
    p4x !== null &&
    p4y !== null
  ) {
    return [
      [p1x, p1y],
      [p2x, p2y],
      [p3x, p3y],
      [p4x, p4y],
    ];
  }

  const bb = d.bbox;
  if (Array.isArray(bb) && bb.length === 4) {
    const x1 = toNum(bb[0]),
      y1 = toNum(bb[1]),
      x2 = toNum(bb[2]),
      y2 = toNum(bb[3]);
    if (x1 !== null && y1 !== null && x2 !== null && y2 !== null) {
      return [
        [x1, y1],
        [x2, y1],
        [x2, y2],
        [x1, y2],
      ];
    }
  }

  return null;
}

function isLikelyNormalized(pts: [number, number][]) {
  return pts.every(([x, y]) => Math.abs(x) <= 2 && Math.abs(y) <= 2);
}

function DetectionViewer({
  imageUrl,
  detections,
}: {
  imageUrl: string;
  detections: Detection[];
}) {
  const [imgWidth, setImgWidth] = useState<number>(420);
  const [imgHeight, setImgHeight] = useState<number>(260);
  const [showDetections, setShowDetections] = useState(true);
  const [natural, setNatural] = useState<{ w: number; h: number }>({
    w: 1,
    h: 1,
  });

  useEffect(() => {
    let alive = true;
    const img = new Image();
    img.onload = () => {
      if (!alive) return;
      const w = img.naturalWidth || 1;
      const h = img.naturalHeight || 1;
      setNatural({ w, h });
      setImgHeight(Math.round((imgWidth * h) / w));
    };
    img.src = imageUrl;
    return () => {
      alive = false;
    };
  }, [imageUrl, imgWidth]);

  const dec = () => setImgWidth((v) => clamp(v - 40, 320, 760));
  const inc = () => setImgWidth((v) => clamp(v + 40, 320, 760));

  const renderItems = useMemo(() => {
    return (detections || [])
      .map((d, idx) => {
        const pts = parsePolyFromDetection(d);
        if (!pts || pts.length < 4) return null;

        const norm = isLikelyNormalized(pts);

        const scaled = pts.map(([x, y]) => {
          const xx = norm ? x * imgWidth : (x / natural.w) * imgWidth;
          const yy = norm ? y * imgHeight : (y / natural.h) * imgHeight;
          return [xx, yy] as [number, number];
        });

        const xs = scaled.map((p) => p[0]);
        const ys = scaled.map((p) => p[1]);
        const minX = Math.min(...xs);
        const minY = Math.min(...ys);

        const pointsStr = scaled
          .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
          .join(" ");

        return {
          key: `det-${idx}-${String(d.label41 ?? "")}-${minX.toFixed(
            1
          )}-${minY.toFixed(1)}`,
          pointsStr,
          label: formatDetName(d),
          labelX: minX,
          labelY: minY,
        };
      })
      .filter(Boolean) as {
        key: string;
        pointsStr: string;
        label: string;
        labelX: number;
        labelY: number;
      }[];
  }, [detections, imgWidth, imgHeight, natural.w, natural.h]);

  return (
    <div
      className="mb-4 rounded-2xl border px-4 py-3"
      style={{
        borderColor: "rgba(148,163,184,0.22)",
        backgroundColor: "rgba(148,163,184,0.06)",
      }}
    >
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="text-[12px] font-semibold opacity-80">
          圖片寬度：{imgWidth}px<span className="opacity-60"> ｜ </span>
          偵測框：{detections?.length ?? 0}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={dec}
            className="h-9 w-9 rounded-full border flex items-center justify-center text-lg font-bold"
            style={{
              borderColor: "rgba(148,163,184,0.35)",
              backgroundColor: "rgba(255,255,255,0.55)",
            }}
            aria-label="zoom out"
          >
            −
          </button>
          <button
            type="button"
            onClick={inc}
            className="h-9 w-9 rounded-full border flex items-center justify-center text-lg font-bold"
            style={{
              borderColor: "rgba(148,163,184,0.35)",
              backgroundColor: "rgba(255,255,255,0.55)",
            }}
            aria-label="zoom in"
          >
            +
          </button>

          <button
            type="button"
            onClick={() => setShowDetections((v) => !v)}
            className="h-9 px-4 rounded-full border text-[12px] font-semibold"
            style={{
              borderColor: "rgba(148,163,184,0.35)",
              backgroundColor: "rgba(255,255,255,0.55)",
            }}
          >
            {showDetections ? "隱藏偵測框" : "顯示偵測框"}
          </button>
        </div>
      </div>

      <div
        className="rounded-2xl p-3"
        style={{ backgroundColor: "rgba(15,23,42,0.06)" }}
      >
        <div
          className="mx-auto rounded-xl overflow-hidden"
          style={{
            width: imgWidth,
            height: imgHeight,
            position: "relative",
            backgroundColor: "rgba(0,0,0,0.12)",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageUrl}
            alt="seed"
            style={{
              width: imgWidth,
              height: imgHeight,
              objectFit: "contain",
              display: "block",
            }}
          />

          {showDetections && (
            <svg
              width={imgWidth}
              height={imgHeight}
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                pointerEvents: "none",
              }}
            >
              {renderItems.map((it) => (
                <g key={it.key}>
                  <polygon
                    points={it.pointsStr}
                    fill="rgba(56,189,248,0.12)"
                    stroke="rgba(56,189,248,0.95)"
                    strokeWidth={3}
                    strokeLinejoin="round"
                  />
                  <foreignObject
                    x={clamp(it.labelX, 0, imgWidth - 10)}
                    y={clamp(it.labelY - 28, 0, imgHeight - 10)}
                    width={Math.min(260, imgWidth)}
                    height={32}
                  >
                    <div
                      // xmlns="http://www.w3.org/1999/xhtml"
                      style={{
                        display: "inline-block",
                        maxWidth: "240px",
                        padding: "6px 10px",
                        borderRadius: "999px",
                        backgroundColor: "rgba(56,189,248,0.92)",
                        color: "#fff",
                        fontSize: "12px",
                        fontWeight: 800,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        boxShadow: "0 10px 22px rgba(2,132,199,0.22)",
                      }}
                      title={it.label}
                    >
                      {it.label}
                    </div>
                  </foreignObject>
                </g>
              ))}
            </svg>
          )}
        </div>

        <div className="mt-2 text-[11px] opacity-70">
          Tip：後端若回傳 poly / PolyJson / P1~P4 會畫旋轉框；否則用 bbox 畫正框。
        </div>
      </div>
    </div>
  );
}

// ==============================
//  GPT-style「⋯」選單（分享/刪除）
// ==============================
function MenuItem({
  icon,
  label,
  onClick,
  danger,
  hoverBg,
}: {
  icon: string;
  label: string;
  onClick: () => void;
  danger?: boolean;
  hoverBg: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full px-3 py-2 text-xs flex items-center gap-2"
      style={{
        color: danger ? "#ef4444" : "var(--foreground)",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = hoverBg)}
      onMouseLeave={(e) =>
        (e.currentTarget.style.backgroundColor = "transparent")
      }
    >
      <i className={`${icon} text-[11px]`} />
      {label}
    </button>
  );
}

function ThreadMoreMenu({
  threadId,
  onDelete,
  onShare,
  NAV_HOVER_BG,
}: {
  threadId: string;
  onDelete: () => void;
  onShare: () => void;
  NAV_HOVER_BG: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: globalThis.MouseEvent) {
      const t = e.target as HTMLElement;
      if (!rootRef.current) return;
      if (!rootRef.current.contains(t)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="w-5 h-5 flex items-center justify-center rounded-md opacity-60 hover:opacity-100"
        title="更多"
        aria-label={`More actions for ${threadId}`}
      >
        <i className="fa-solid fa-ellipsis text-xs" />
      </button>

      {open && (
        <div
          className="absolute right-0 top-full mt-1 w-28 rounded-xl border z-50 overflow-hidden"
          style={{
            backgroundColor: "var(--background)",
            borderColor: "var(--navbar-border)",
            boxShadow: "0 12px 30px rgba(0,0,0,0.18)",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <MenuItem
            icon="fa-solid fa-share-nodes"
            label="分享"
            hoverBg={NAV_HOVER_BG}
            onClick={() => {
              setOpen(false);
              onShare();
            }}
          />
          <MenuItem
            icon="fa-solid fa-trash"
            label="刪除"
            danger
            hoverBg={NAV_HOVER_BG}
            onClick={() => {
              setOpen(false);
              onDelete();
            }}
          />
        </div>
      )}
    </div>
  );
}

// ============================================================
//  HistoryOverlay（原樣保留）
// ============================================================
const HistoryOverlay = memo(function HistoryOverlay({
  isOpen,
  onClose,
  historyThreads,
  historyMessages,
  activeThreadId,
  onSelectThread,
  onLoadThreadToMain,
  onNewThread,
  onRenameThread,
  onDeleteThread,
  onShareThread,
  NAV_ACTIVE_BG,
  NAV_HOVER_BG,
  persistedQueryRef,
}: {
  isOpen: boolean;
  onClose: () => void;
  historyThreads: HistoryThread[];
  historyMessages: HistoryMessage[];
  activeThreadId: string;
  onSelectThread: (threadId: string) => void;
  onLoadThreadToMain: (threadId: string) => void;
  onNewThread: () => void;
  onRenameThread: (threadId: string, nextTitle: string) => void;
  onDeleteThread: (threadId: string) => void;
  onShareThread: (threadId: string) => void;
  NAV_ACTIVE_BG: string;
  NAV_HOVER_BG: string;
  persistedQueryRef: React.MutableRefObject<string>;
}) {
  const historyInputRef = useRef<HTMLInputElement | null>(null);
  const historyLiveValueRef = useRef<string>(persistedQueryRef.current || "");
  const composingRef = useRef(false);

  const [query, setQuery] = useState<string>(persistedQueryRef.current || "");
  const [isPending, startTransition] = useTransition();

  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement | null>(null);

  const threadContentIndex = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of historyMessages) {
      const prev = map.get(m.threadId) ?? "";
      map.set(m.threadId, prev + "\n" + m.content);
    }
    return map;
  }, [historyMessages]);

  function threadMatches(t: HistoryThread, qLower: string) {
    if (!qLower) return true;
    const metaText = `${t.title}\n${t.preview}\n${t.updatedAt}`.toLowerCase();
    const msgText = (threadContentIndex.get(t.id) ?? "").toLowerCase();
    return metaText.includes(qLower) || msgText.includes(qLower);
  }

  const filteredThreads = useMemo(() => {
    if (composingRef.current) return historyThreads;

    const q = (query || "").trim().toLowerCase();
    if (!q) return historyThreads;

    return historyThreads.filter((t) => threadMatches(t, q));
  }, [query, historyThreads, threadContentIndex]);

  function clearAll() {
    historyLiveValueRef.current = "";
    persistedQueryRef.current = "";
    if (historyInputRef.current) historyInputRef.current.value = "";
    startTransition(() => setQuery(""));
    requestAnimationFrame(() => historyInputRef.current?.focus());
  }

  useEffect(() => {
    if (!isOpen) return;
    const id = requestAnimationFrame(() => {
      if (historyInputRef.current) {
        historyInputRef.current.value = historyLiveValueRef.current || "";
      }
      historyInputRef.current?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  function beginRename() {
    const t = historyThreads.find((x) => x.id === activeThreadId);
    setRenameValue(t?.title ?? "");
    setIsRenaming(true);
  }

  function commitRename() {
    const next = renameValue.trim();
    if (next) onRenameThread(activeThreadId, next);
    setIsRenaming(false);
  }

  function cancelRename() {
    setIsRenaming(false);
  }

  useEffect(() => {
    if (!isOpen) return;
    if (!isRenaming) return;
    const id = requestAnimationFrame(() => {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    });
    return () => cancelAnimationFrame(id);
  }, [isOpen, isRenaming]);

  if (!isOpen) return null;

  const currentThread = historyThreads.find((t) => t.id === activeThreadId);
  const threadMessages = historyMessages.filter(
    (m) => m.threadId === activeThreadId
  );
  const showClear = (historyLiveValueRef.current || "").trim().length > 0;
  const isShowingDetailOnMobile = !!currentThread;

  return (
    <div className="absolute inset-0 z-[100]">
      <div
        className="absolute inset-0"
        style={{ backgroundColor: "rgba(0,0,0,0.35)" }}
        onClick={onClose}
      />

      <div className="absolute inset-0 flex items-center justify-center p-3 md:p-6">
        <div
          className="history-overlay-panel w-full max-w-5xl h-[88vh] md:h-[82vh] rounded-2xl border overflow-hidden shadow-2xl flex flex-col" style={{
            backgroundColor: "var(--navbar-bg)",
            borderColor: "var(--navbar-border)",
            color: "var(--foreground)",
            backdropFilter: "blur(12px)",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            className="px-4 py-3 border-b flex items-center justify-between"
            style={{ borderColor: "rgba(148,163,184,0.20)" }}
          >
            <div>
              <div className="text-sm font-semibold">對話紀錄</div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                className="w-9 h-9 rounded-xl flex items-center justify-center transition"
                style={{
                  border: "1px solid rgba(148,163,184,0.18)",
                  backgroundColor: "transparent",
                }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.backgroundColor = NAV_HOVER_BG)
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.backgroundColor = "transparent")
                }
                onClick={onClose}
                title="關閉"
                aria-label="Close"
              >
                <i className="fa-solid fa-xmark text-[14px] opacity-70" />
              </button>
            </div>
          </div>

          <div className="history-overlay-body flex-1 min-h-0 grid grid-cols-12 gap-4 p-4">
            <div
              className={`history-thread-list-panel col-span-12 md:col-span-4 min-h-0 rounded-2xl border overflow-hidden flex flex-col ${isShowingDetailOnMobile ? "history-mobile-hide" : ""
                }`}
              style={{ borderColor: "rgba(148,163,184,0.20)" }}
            >
              <div
                className="p-3 border-b"
                style={{ borderColor: "rgba(148,163,184,0.20)" }}
              >
                <div
                  className="flex items-center gap-2 rounded-xl px-3 py-2"
                  style={{
                    border: "2px solid rgba(148,163,184,0.25)",
                    backgroundColor: "rgba(148,163,184,0.10)",
                  }}
                >
                  <input
                    ref={historyInputRef}
                    type="text"
                    placeholder="搜尋對話紀錄"
                    defaultValue={historyLiveValueRef.current}
                    className="flex-1 bg-transparent outline-none text-sm"
                    style={{ color: "var(--foreground)" }}
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck={false}
                    onCompositionStart={() => {
                      composingRef.current = true;
                    }}
                    onCompositionEnd={(e) => {
                      composingRef.current = false;
                      const v = e.currentTarget.value || "";
                      historyLiveValueRef.current = v;
                      persistedQueryRef.current = v;

                      startTransition(() => setQuery(v));
                    }}
                    onChange={(e) => {
                      const v = e.currentTarget.value;
                      historyLiveValueRef.current = v;
                      persistedQueryRef.current = v;

                      if (composingRef.current) return;
                      startTransition(() => setQuery(v));
                    }}
                  />

                  {showClear && (
                    <button
                      type="button"
                      className="w-8 h-8 rounded-lg flex items-center justify-center"
                      style={{ backgroundColor: "transparent" }}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={clearAll}
                      title="清除"
                      aria-label="Clear"
                    >
                      <i className="fa-solid fa-xmark text-[12px] opacity-70" />
                    </button>
                  )}
                </div>

                <div className="mt-2 text-[10px] opacity-50">
                  {isPending ? "更新中…" : " "}
                </div>
              </div>

              <div
                className="min-h-0 overflow-y-scroll p-2"
                style={{ scrollbarGutter: "stable" as any }}
              >
                {filteredThreads.length === 0 ? (
                  <div className="p-4 text-sm opacity-60">沒有符合的對話</div>
                ) : (
                  filteredThreads.map((t) => {
                    const active = t.id === activeThreadId;

                    return (
                      <div
                        key={t.id}
                        className="w-full rounded-lg transition mb-1"
                        style={{
                          backgroundColor: active ? NAV_ACTIVE_BG : "transparent",
                        }}
                        onMouseEnter={(e) => {
                          if (active) return;
                          e.currentTarget.style.backgroundColor = NAV_HOVER_BG;
                        }}
                        onMouseLeave={(e) => {
                          if (active) return;
                          e.currentTarget.style.backgroundColor = "transparent";
                        }}
                      >
                        <div className="flex items-start justify-between gap-1">
                          <button
                            type="button"
                            tabIndex={-1}
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => onSelectThread(t.id)}
                            className="min-w-0 flex-1 text-left px-3 py-2 rounded-lg"                          >
                            <div className="text-sm font-medium truncate">{t.title}</div>

                            <div className="text-[12px] opacity-70 mt-1 line-clamp-1">
                              {t.preview}
                            </div>
                            <div className="text-[11px] opacity-50 mt-2">
                              {t.messageCount} 則訊息
                            </div>
                          </button>

                          <div
                            className="shrink-0 pt-2 pr-2"
                            onClick={(e) => e.stopPropagation()}
                            onMouseDown={(e) => e.stopPropagation()}
                          >
                            <ThreadMoreMenu
                              threadId={t.id}
                              NAV_HOVER_BG={NAV_HOVER_BG}
                              onShare={() => onShareThread(t.id)}
                              onDelete={() => onDeleteThread(t.id)}
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            <div
              className={`history-thread-detail-panel col-span-12 md:col-span-8 min-h-0 rounded-2xl border overflow-hidden flex flex-col ${isShowingDetailOnMobile ? "history-mobile-show" : "history-mobile-hide"
                }`} style={{ borderColor: "rgba(148,163,184,0.20)" }}
            >   <div className="history-mobile-back-wrap">
                <button
                  type="button"
                  className="history-mobile-back-btn"
                  onClick={() => onSelectThread("")}
                >
                  <i className="fa-solid fa-angle-left" />
                  返回列表
                </button>
              </div>

              <div
                className="history-thread-detail-header px-4 py-3 border-b flex items-center justify-between"
                style={{ borderColor: "rgba(148,163,184,0.20)" }}
              >
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] opacity-60 mb-0.5">
                    {formatThreadTime(currentThread?.updatedAt)}
                  </div>

                  {isRenaming ? (
                    <input
                      ref={renameInputRef}
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      className="w-full bg-transparent outline-none text-sm font-semibold"
                      style={{
                        color: "var(--foreground)",
                        borderBottom: "1px solid rgba(148,163,184,0.35)",
                        paddingBottom: 2,
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          commitRename();
                        }
                        if (e.key === "Escape") {
                          e.preventDefault();
                          cancelRename();
                        }
                      }}
                      onBlur={() => commitRename()}
                    />
                  ) : (
                    <div
                      className="text-sm font-semibold truncate cursor-text"
                      title="點一下可重新命名"
                      onClick={beginRename}
                      onDoubleClick={beginRename}
                    >
                      {currentThread?.title || "未選擇對話"}
                    </div>
                  )}
                </div>
                <div className="history-thread-detail-actions flex items-center gap-2">
                  <button
                    type="button"
                    className="text-xs px-3 py-2 rounded-lg transition"
                    style={{ backgroundColor: "transparent" }}
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.backgroundColor = NAV_HOVER_BG)
                    }
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.backgroundColor = "transparent")
                    }
                    onClick={beginRename}
                    title="重新命名此對話"
                  >
                    <i className="fa-solid fa-pen"></i> 重新命名
                  </button>

                  <button
                    type="button"
                    className="text-xs px-3 py-2 rounded-lg transition"
                    style={{ backgroundColor: "transparent" }}
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.backgroundColor = NAV_HOVER_BG)
                    }
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.backgroundColor = "transparent")
                    }
                    onClick={() => onLoadThreadToMain(activeThreadId)}
                    title="回到主畫面並繼續聊天"
                  >
                    <i className="fa-regular fa-comment"></i>
                    繼續聊天
                  </button>
                </div>
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
                {threadMessages.length === 0 ? (
                  <div className="text-sm opacity-60">這個對話目前沒有訊息</div>
                ) : (
                  threadMessages.map((m) => {
                    const isUser = m.role === "user";
                    return (
                      <div
                        key={m.id}
                        className={`flex ${isUser ? "justify-end" : "justify-start"
                          }`}
                      >
                        <div
                          className="max-w-[min(78%,65ch)] rounded-2xl px-4 py-3 text-sm leading-relaxed"
                          style={{
                            backgroundColor: isUser
                              ? "var(--chat-user-bg)"
                              : "var(--chat-assistant-bg)",
                            color: isUser
                              ? "var(--chat-user-text)"
                              : "var(--chat-assistant-text)",
                          }}
                        >
                          <div className="whitespace-pre-wrap break-words">
                            {m.content}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>

          <div
            className="px-4 py-3 border-t text-[11px] opacity-60"
            style={{ borderColor: "rgba(148,163,184,0.20)" }}
          >
            提示：按 ESC 可關閉
          </div>
        </div>
      </div>
    </div>
  );
});

// 統一時間格式
function formatThreadTime(value?: string) {
  if (!value) return "";

  let raw = String(value).trim();

  // 後端若回 2026-04-12T06:40:27 或 2026-04-12T06:40:27.123456
  // 這種「沒時區」字串，這裡一律當成 UTC 來解，再轉成台北時間顯示
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(raw)) {
    raw += "Z";
  }

  const d = new Date(raw);
  if (!Number.isNaN(d.getTime())) {
    return d.toLocaleString("zh-TW", {
      timeZone: "Asia/Taipei",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  }

  return value;
}

function LLMClient() {
  const searchParams = useSearchParams();
  const router = useRouter();

  //   改動 1：由 boolean 改成記錄最後 boot 的 caseId（避免重複 boot）
  const bootOnceRef = useRef<string>("");

  //  seed card（不動原排版：只在聊天區最上方插一張卡）
  const [seedImageUrl, setSeedImageUrl] = useState<string>("");
  const [seedDetections, setSeedDetections] = useState<Detection[]>([]);

  // ===== navbar 狀態 =====
  const [isNavCollapsed, setIsNavCollapsed] = useState(false);
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  //  手勢拖動相關
  const touchStartXRef = useRef<number | null>(null);
  const touchCurrentXRef = useRef<number | null>(null);
  const [mobileDrawerOffsetX, setMobileDrawerOffsetX] = useState(0);
  const [isDraggingDrawer, setIsDraggingDrawer] = useState(false);




  //  目前頁面
  const [activeView, setActiveView] = useState<ViewKey>("llm");

  //  RAG 模式（沿用 pasted.txt：不建立索引）
  const [ragMode, setRagMode] = useState<RagMode>("file_then_vector");

  //  History overlay
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);

  //  正在預覽的 thread（點 history 後會先載入 thread list，點 thread 後才載入訊息內容到 preview）
  const [historyPreviewThreadId, setHistoryPreviewThreadId] = useState<string>("");

  //  搜尋字詞持久化（不觸發 rerender）
  const historyPersistedQueryRef = useRef<string>("");

  // ===== chat 狀態 =====
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 1,
      role: "assistant",
      content: WELCOME_TEXT,
    },
  ]);

  //  儲存最新 messages 到 ref（避免在 streaming 回應時因 state 更新導致的 closure 問題）
  const latestMessagesRef = useRef<ChatMessage[]>([]);
  useEffect(() => {
    latestMessagesRef.current = messages;
  }, [messages]);


  //  主輸入框：受控（中文/英文）
  const [draftText, setDraftText] = useState("");

  const [privacyConsent, setPrivacyConsent] = useState(false);
  const [showSensitiveModal, setShowSensitiveModal] = useState(false);
  const [sensitiveHits, setSensitiveHits] = useState<SensitiveHit[]>([]);

  const [loading, setLoading] = useState(false);
  const [showToolMenu, setShowToolMenu] = useState(false);

  const [pendingFiles, setPendingFiles] = useState<UploadedFile[]>([]);

  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const loadedThreadFromUrlRef = useRef<string>("");

  const baseHeightRef = useRef<number | null>(null);
  const [isMultiLine, setIsMultiLine] = useState(false);
  const [inputBoxHeight, setInputBoxHeight] = useState(MIN_HEIGHT);

  const isExpanded = isMultiLine || pendingFiles.length > 0;

  const [ragOpen, setRagOpen] = useState(false);
  const [mobileRagOpen, setMobileRagOpen] = useState(false);

  //  thread清單  聊天紀錄
  const [historyThreads, setHistoryThreads] = useState<HistoryThread[]>([]);
  const [historyMessages, setHistoryMessages] = useState<HistoryMessage[]>([]);

  //   改動：不要用 t-001 當預設，避免一直送到假 thread
  const [activeThreadId, setActiveThreadId] = useState<string>("");

  const activeThreadIdRef = useRef<string>(activeThreadId);
  useEffect(() => {
    activeThreadIdRef.current = activeThreadId;
  }, [activeThreadId]);

  const [sessionId, setSessionId] = useState<string>("");

  //   重要：避免初始化階段直接碰 localStorage/crypto（防空白/奇怪錯）
  const [userId, setUserId] = useState<string>("guest");
  const [userMode, setUserMode] = useState<"guest" | "member">("guest");
  const uidRef = useRef<string>("guest");
  const uidReadyRef = useRef<boolean>(false);

  //  統一 hover/active 顏色
  const NAV_ACTIVE_BG = "rgba(148,163,184,0.16)";
  const NAV_HOVER_BG = "rgba(148,163,184,0.10)";

  // ==============================
  //  LocalStorage：初始化載入 + 持久化
  // ==============================
  const didHydrateRef = useRef(false);
  const [hydrated, setHydrated] = useState(false);

  const lastModeRef = useRef<"guest" | "member" | "">("");

  useEffect(() => {
    if (!hydrated) return;

    const prevMode = lastModeRef.current;
    const nowMode = userMode;

    if (prevMode === "guest" && nowMode === "member") {
      setHistoryThreads([]);
      setHistoryMessages([]);
      setMessages([
        {
          id: 1,
          role: "assistant",
          content: WELCOME_TEXT,
        },
      ]);
      setActiveThreadId("");
      activeThreadIdRef.current = "";
      setSessionId("");
      setIsHistoryOpen(false);
      setHistoryPreviewThreadId("");

      try {
        localStorage.removeItem("guest_user_id");
        Object.keys(localStorage)
          .filter((k) => k.startsWith("gab_llm_v1::guest"))
          .forEach((k) => localStorage.removeItem(k));
      } catch { }
    }

    lastModeRef.current = nowMode;
  }, [hydrated, userMode]);








  //   新增：確保「讀取快取完成」後才允許 auto-newThread（避免覆蓋快取）
  const cacheLoadedRef = useRef(false);

  //  防連點：避免短時間連續 newThread 造成側邊一直洗牌/狂打後端
  const creatingThreadRef = useRef(false);

  //   新增：避免同一個 conversation 重複 PATCH title
  const autoTitledSetRef = useRef<Set<string>>(new Set());
  //   新增：判斷是否有未儲存的草稿（有則不允許切換 thread 或離開頁面）
  function hasUnsavedDraft() {
    return !!draftText.trim() || pendingFiles.length > 0;
  }
  //   新增：離開前警告（有草稿或正在創建 thread）
  const pendingFilesRef = useRef<UploadedFile[]>([]);
  useEffect(() => {
    return () => {
      cleanupPendingFiles(pendingFilesRef.current);
    };
  }, []);
  //  每次 pendingFiles 更新都同步到 ref（確保離開頁面時能正確清理）
  useEffect(() => {
    pendingFilesRef.current = pendingFiles;
  }, [pendingFiles]);

  //  離開前警告
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (!hasUnsavedDraft() && !loading) return;
      e.preventDefault();
      e.returnValue = "";
    };

    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [draftText, pendingFiles, loading]);

  //  判斷目前 thread 是否仍是「空白新對話」（尚未有 user 訊息）
  function isBlankNewThread(threadId: string) {
    if (!threadId) return false;

    const t = historyThreads.find((x) => x.id === threadId);
    const titleIsNew = (t?.title || "").trim() === "新對話";

    const threadMsgs = historyMessages.filter((m) => m.threadId === threadId);

    const noUserMsgYet = !threadMsgs.some((m) => m.role === "user");

    const onlyWelcome =
      threadMsgs.length === 0 ||
      (threadMsgs.length === 1 &&
        threadMsgs[0]?.role === "assistant" &&
        threadMsgs[0]?.content === WELCOME_TEXT);

    return titleIsNew && (noUserMsgYet || onlyWelcome);
  }
  useEffect(() => {
    const identity = getClientIdentity();

    uidRef.current = identity.userId;
    uidReadyRef.current = true;

    setUserId(identity.userId);
    setUserMode(identity.mode);

    const cached = isGuestUid(identity.userId) ? null : lsRead(identity.userId);

    if (cached && typeof cached === "object") {
      const cRag: RagMode | undefined = cached.ragMode;
      if (cRag) setRagMode(cRag);
    }

    cacheLoadedRef.current = true;
    didHydrateRef.current = true;
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!didHydrateRef.current) return;
    if (!uidReadyRef.current) return;

    const uid = (uidRef.current || "guest").trim() || "guest";

    const payload = {
      version: 1,
      savedAt: lsSafeNow(),
      userId: uid,
      ragMode,
    };

    lsWrite(uid, payload);
  }, [ragMode]);


  function nowText() {
    return new Date().toISOString();
  }

  //   新增：如果 URL 上有 caseId 但沒有 thread 了，就清掉 URL 上的 caseId（避免一直 boot 同一個不存在的 case）
  function clearCaseIdInUrlOnly() {
    const hasCase =
      !!searchParams.get("caseId") ||
      !!searchParams.get("caseld") ||
      !!searchParams.get("caseid");

    if (hasCase) {
      router.replace("/llm");
    }
  }

  //   新增：push 到 historyMessages（讓 overlay / reload 都有內容）
  function pushHistoryMessage(
    threadId: string,
    role: "user" | "assistant",
    content: string,
    resources?: ChatResource[]
  ) {
    if (!threadId) return;
    const createdAt = nowText();
    setHistoryMessages((prev) => [
      ...prev,
      {
        id: `${threadId}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        threadId,
        role,
        content: String(content ?? ""),
        createdAt,
        resources,
      },
    ]);
  }

  function requireLoginForHistory() {
    alert("請先登入後才能查看對話紀錄。");
    router.push("/auth");
  }



  //   新增：用第一句生成 title（跟你 UI 現在的 18 字一致）
  function makeAutoTitleFromText(userText: string) {
    const t = (userText || "").trim().replace(/\s+/g, " ");
    if (!t) return "";
    return t.slice(0, 18);
  }

  //   新增：只在「新對話」時，對真 conversation_id 做一次 PATCH title
  async function ensureBackendAutoTitleOnce(
    conversationId: string,
    userText: string
  ) {
    if (!conversationId) return;
    if (conversationId.startsWith("t-")) return;
    if (autoTitledSetRef.current.has(conversationId)) return;

    const nextTitle = makeAutoTitleFromText(userText);
    if (!nextTitle) return;

    const t = historyThreads.find((x) => x.id === conversationId);
    const titleIsNew = (t?.title || "").trim() === "新對話";
    if (!titleIsNew) return;

    autoTitledSetRef.current.add(conversationId);
    try {
      await apiUpdateConversationTitle(conversationId, nextTitle);
    } catch (e) {
      // 不影響 UI；後端不支援就算了
      console.error(e);
    }
  }

  //   rename：先更新本地，再嘗試同步後端（不影響 UI）
  function renameThread(threadId: string, nextTitle: string) {
    const title = nextTitle.trim();
    if (!title) return;

    // 1) 先更新前端（立即看到）
    setHistoryThreads((prev) =>
      prev.map((t) => (t.id === threadId ? { ...t, title } : t))
    );

    // 2) 同步後端：只有「真的 conversation_id」才打
    (async () => {
      try {
        if (!threadId || threadId.startsWith("t-")) return;
        await apiUpdateConversationTitle(threadId, title);
      } catch (e: any) {
        console.error(e);
      }
    })();
  }

  async function apiDeleteConversation(cid: string) {
    const res = await fetch(`${S2X_BASE}/agent/conversations/${cid}`, {
      method: "DELETE",
      headers: buildAuthHeaders(),
    });

    const raw = await res.text().catch(() => "");
    const data = safeJsonParse(raw);

    if (!res.ok) {
      throw new Error(`deleteConversation 失敗 ${res.status}: ${raw.slice(0, 200)}`);
    }

    return data ?? raw;
  }
  async function deleteThread(threadId: string) {
    if (!confirm("確定要刪除這個對話嗎？")) return;

    const nextThreads = historyThreads.filter((t) => t.id !== threadId);
    const deletingActive = activeThreadIdRef.current === threadId;
    const fallbackId = deletingActive ? nextThreads[0]?.id ?? "" : "";

    // 先更新前端，讓 UI 立即反應
    setHistoryThreads(nextThreads);
    setHistoryMessages((prev) => prev.filter((m) => m.threadId !== threadId));

    if (deletingActive) {
      if (fallbackId) {
        setActiveThreadId(fallbackId);
        void loadThreadToMain(fallbackId);
      } else {
        void newThread();
      }
    }

    // 再同步後端：失敗不回滾 UI，只記錄錯誤
    if (userMode === "member" && threadId && !threadId.startsWith("t-")) {
      try {
        await apiDeleteConversation(threadId);
      } catch (e) {
        console.error("刪除後端 conversation 失敗：", e);
      }
    }
  }

  async function shareThread(threadId: string) {
    if (!threadId || threadId.startsWith("t-")) {
      alert("請先登入才能分享對話");
      return;
    }

    const url = `${location.origin}/llm?thread=${encodeURIComponent(threadId)}`;
    try {
      await navigator.clipboard.writeText(url);
      alert("已複製分享連結");
    } catch {
      prompt("請手動複製連結：", url);
    }
  }

  async function apiFetchConversations(uid: string) {
    const res = await fetch(API.listConvs(uid), {
      method: "GET",
      headers: buildAuthHeaders(),
    });
    const raw = await res.text();
    const data = safeJsonParse(raw);

    if (!res.ok || !data) {
      throw new Error(`listConvs 失敗 ${res.status}: ${raw.slice(0, 200)}`);
    }

    const items = Array.isArray((data as any)?.conversations)
      ? (data as any).conversations
      : Array.isArray(data)
        ? data
        : [];

    return items
      .map((c: any) => ({
        id: String(
          c.id ??
          c.conversation_id ??
          c.conversationId ??
          c.ConversationId ??
          ""
        ),
        title: String(
          c.title ??
          c.name ??
          c.Title ??
          "未命名對話"
        ),
        updatedAt: String(
          c.updatedAt ??
          c.updated_at ??
          c.UpdatedAt ??
          c.createdAt ??
          c.created_at ??
          c.CreatedAt ??
          ""
        ),
        preview: String(
          c.preview ??
          c.last_message ??
          c.Preview ??
          ""
        ),
        messageCount: Number(
          c.messageCount ??
          c.message_count ??
          c.MessageCount ??
          0
        ),
        sessionId: String(
          c.session_id ??
          c.sessionId ??
          c.SessionId ??
          ""
        ),
      }))
      .filter((t: any) => t.id);
  }

  async function fetchConversationMessages(cid: string): Promise<HistoryMessageWithResources[]> {
    const res = await fetch(API.getMsgs(cid), {
      method: "GET",
      headers: buildAuthHeaders(),
    });

    const raw = await res.text();
    const data = safeJsonParse(raw);

    if (!res.ok || !data) {
      throw new Error(`getMsgs 失敗 ${res.status}: ${raw.slice(0, 200)}`);
    }

    const items = Array.isArray((data as any)?.messages)
      ? (data as any).messages
      : Array.isArray(data)
        ? data
        : [];

    const resourcesByMsgIndex =
      (data as any)?.resources_by_msg_index &&
        typeof (data as any).resources_by_msg_index === "object"
        ? (data as any).resources_by_msg_index
        : {};

    const mapped: HistoryMessageWithResources[] = items.map((m: any, idx: number) => {
      const rawResources = Array.isArray(resourcesByMsgIndex?.[idx])
        ? resourcesByMsgIndex[idx]
        : [];

      const resources: ChatResource[] = rawResources.map((r: any) => ({
        title: String(r?.title ?? "未命名來源"),
        display_title: r?.display_title
          ? String(r.display_title)
          : String(r?.title ?? "未命名來源"),
        url: r?.url ? String(r.url) : undefined,
        download_url: r?.download_url ? String(r.download_url) : undefined,
        external_url: r?.external_url ? String(r.external_url) : undefined,
        source_type: r?.source_type ? String(r.source_type) : undefined,
        page: r?.page ? String(r.page) : undefined,
        snippet: r?.snippet ? String(r.snippet) : undefined,
        material_id: r?.material_id ? String(r.material_id) : undefined,
        score:
          typeof r?.score === "number"
            ? r.score
            : r?.score != null
              ? Number(r.score)
              : undefined,
      }));

      return {
        id: String(m.id ?? `${cid}-${idx}`),
        threadId: cid,
        role: m.role === "assistant" ? "assistant" : "user",
        content: String(m.content ?? m.message ?? ""),
        createdAt: String(m.createdAt ?? m.created_at ?? m.time ?? ""),
        resources,
      };
    });

    return mapped;
  }

  function buildChatMessagesFromThread(threadId: string): ChatMessage[] {
    const threadMsgs = historyMessages
      .filter((m) => m.threadId === threadId)
      .map((m, idx) => ({
        id: Date.now() + idx,
        role: m.role,
        content: m.content,
        resources: (m as HistoryMessageWithResources).resources,
      }));

    if (threadMsgs.length === 0) {
      return [
        {
          id: 1,
          role: "assistant",
          content: WELCOME_TEXT,
        },
      ];
    }

    return threadMsgs;
  }

  function resetMainInputBox() {
    setDraftText("");
    baseHeightRef.current = null;
    setIsMultiLine(false);
    setInputBoxHeight(MIN_HEIGHT);

    if (inputRef.current) {
      inputRef.current.style.height = `${MIN_HEIGHT}px`;
      inputRef.current.scrollTop = 0;
    }
  }
  //   新增：當預覽的 thread 變更時，如果是會員且不是 t- 開頭的假 thread，就嘗試載入訊息（避免點開就空空如也）
  useEffect(() => {
    if (!isHistoryOpen) return;
    if (!historyPreviewThreadId) return;
    if (userMode !== "member") return;
    if (historyPreviewThreadId.startsWith("t-")) return;

    const alreadyLoaded = historyMessages.some(
      (m) => m.threadId === historyPreviewThreadId
    );
    if (alreadyLoaded) return;

    let cancelled = false;

    (async () => {
      try {
        const msgs = await fetchConversationMessages(historyPreviewThreadId);
        if (cancelled) return;

        setHistoryMessages((prev) => {
          const others = prev.filter((m) => m.threadId !== historyPreviewThreadId);
          return [...others, ...msgs];
        });
      } catch (err) {
        console.error("載入 history preview messages 失敗：", err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isHistoryOpen, historyPreviewThreadId, userMode]);

  async function loadThreadToMain(threadId: string) {
    if (hasUnsavedDraft()) {
      const ok = confirm("你有尚未送出的內容，確定要切換對話嗎？");
      if (!ok) return;
    }

    clearCaseIdInUrlOnly();

    const t = historyThreads.find((x) => x.id === threadId);
    if (t?.sessionId) setSessionId(t.sessionId);

    activeThreadIdRef.current = threadId;
    setActiveThreadId(threadId);
    setActiveView("llm");
    resetMainInputBox();

    setPendingFiles((prev) => {
      cleanupPendingFiles(prev);
      return [];
    });

    if (userMode === "member" && !threadId.startsWith("t-")) {
      try {
        const remoteMsgs = await fetchConversationMessages(threadId);

        setHistoryMessages((prev) => {
          const others = prev.filter((m) => m.threadId !== threadId);
          return [...others, ...remoteMsgs];
        });

        setMessages(
          remoteMsgs.length > 0
            ? remoteMsgs.map((m, idx) => ({
              id: Date.now() + idx,
              role: m.role,
              content: m.content,
              resources: (m as HistoryMessageWithResources).resources,
            }))
            : [
              {
                id: 1,
                role: "assistant",
                content: WELCOME_TEXT,
              },
            ]
        );
      } catch (err) {
        console.error("載入 conversation messages 失敗，改用本地快取：", err);
        setMessages(buildChatMessagesFromThread(threadId));
      }
    } else {
      setMessages(buildChatMessagesFromThread(threadId));
    }

    setIsHistoryOpen(false);
    setHistoryPreviewThreadId("");
    setTimeout(() => inputRef.current?.focus(), 60);
  }

  function ensureThreadExists(
    threadId: string,
    patch?: Partial<HistoryThread>
  ) {
    setHistoryThreads((prev) => {
      const idx = prev.findIndex((t) => t.id === threadId);

      if (idx >= 0) {
        const updated = { ...prev[idx], ...(patch || {}) };
        const rest = prev.filter((_, i) => i !== idx);
        return [updated, ...rest];
      }

      const created: HistoryThread = {
        id: threadId,
        title: patch?.title ?? "新對話",
        updatedAt: patch?.updatedAt ?? nowText(),
        preview: patch?.preview ?? "",
        messageCount: patch?.messageCount ?? 0,
        sessionId: patch?.sessionId,
      };
      return [created, ...prev];
    });
  }

  function bumpThreadOnMessage(
    threadId: string,
    lastText: string,
    deltaCount = 1
  ) {
    if (!threadId) return;

    setHistoryThreads((prev) => {
      const idx = prev.findIndex((t) => t.id === threadId);
      const updatedAt = nowText();

      if (idx < 0) {
        const created: HistoryThread = {
          id: threadId,
          title: "新對話",
          updatedAt,
          preview: lastText,
          messageCount: deltaCount,
        };
        return [created, ...prev];
      }

      const t = prev[idx];
      const next: HistoryThread = {
        ...t,
        updatedAt,
        preview: lastText || t.preview,
        messageCount: Math.max(0, Number(t.messageCount || 0) + deltaCount),
      };

      const rest = prev.filter((_, i) => i !== idx);
      return [next, ...rest];
    });
  }

  //   新增：自動把「新對話」改成第一句（像 GPT）
  function maybeAutoTitle(threadId: string, userText: string) {
    const title = (userText || "").trim().replace(/\s+/g, " ");
    if (!title) return;

    setHistoryThreads((prev) => {
      const idx = prev.findIndex((t) => t.id === threadId);
      if (idx < 0) return prev;

      const t = prev[idx];
      if ((t.title || "").trim() !== "新對話") return prev;

      const nextTitle = title.slice(0, 18);
      const updated = { ...t, title: nextTitle };
      const rest = prev.filter((_, i) => i !== idx);
      return [updated, ...rest];
    });
  }

  function replaceThreadId(
    oldId: string,
    newId: string,
    sessionIdMaybe?: string
  ) {
    if (!newId || oldId === newId) {
      if (sessionIdMaybe) {
        setHistoryThreads((prev) =>
          prev.map((t) =>
            t.id === oldId ? { ...t, sessionId: sessionIdMaybe } : t
          )
        );
      }
      return;
    }

    setHistoryThreads((prev) => {
      const old = prev.find((t) => t.id === oldId);
      const withoutOld = prev.filter((t) => t.id !== oldId);

      const existingIdx = withoutOld.findIndex((t) => t.id === newId);
      if (existingIdx >= 0) {
        const existing = withoutOld[existingIdx];
        const merged: HistoryThread = {
          ...(old || {}),
          ...existing,
          id: newId,
          sessionId: sessionIdMaybe ?? existing.sessionId ?? old?.sessionId,
        };
        const rest = withoutOld.filter((_, i) => i !== existingIdx);
        return [merged, ...rest];
      }

      const created: HistoryThread = {
        ...(old || {
          title: "新對話",
          updatedAt: nowText(),
          preview: "",
          messageCount: 0,
        }),
        id: newId,
        sessionId: sessionIdMaybe ?? old?.sessionId,
      };

      return [created, ...withoutOld];
    });

    setHistoryMessages((prev) =>
      prev.map((m) => (m.threadId === oldId ? { ...m, threadId: newId } : m))
    );

    activeThreadIdRef.current = newId;
    setActiveThreadId(newId);
  }
  //   新增：保證有 threadId（避免 refresh/初始化時送到空字串）
  function ensureActiveThreadIdForSend() {
    if (activeThreadIdRef.current) return activeThreadIdRef.current;

    const uid = (uidRef.current || userId || "guest").trim() || "guest";
    const localThreadId = `t-${Date.now()}`;
    const localSessionId = `${uid}::${makeUuid()}`;

    // 關鍵：先寫 ref
    activeThreadIdRef.current = localThreadId;

    setActiveThreadId(localThreadId);
    setSessionId(localSessionId);

    ensureThreadExists(localThreadId, {
      title: "新對話",
      updatedAt: nowText(),
      preview: "",
      messageCount: 0,
      sessionId: localSessionId,
    });

    return localThreadId;
  }
  async function newThread() {
    if (hasUnsavedDraft()) {
      const ok = confirm("你有尚未送出的內容，確定要開新對話嗎？");
      if (!ok) return;
    }

    const curId = activeThreadIdRef.current;

    if (curId && isBlankNewThread(curId)) {
      activeThreadIdRef.current = curId;
      setActiveThreadId(curId);
      setActiveView("llm");
      setIsHistoryOpen(false);
      setIsMobileNavOpen(false);

      setMessages([
        {
          id: Date.now(),
          role: "assistant",
          content: WELCOME_TEXT,
          resources: [],
        },
      ]);

      resetMainInputBox();

      setPendingFiles((prev) => {
        cleanupPendingFiles(prev);
        return [];
      });

      setTimeout(() => inputRef.current?.focus(), 60);
      return;
    }

    if (creatingThreadRef.current) return;
    creatingThreadRef.current = true;

    try {
      const uid = (uidRef.current || userId || "guest").trim() || "guest";
      const localThreadId = `t-${Date.now()}`;
      const localSessionId = `${uid}::${makeUuid()}`;
      activeThreadIdRef.current = localThreadId;

      setActiveView("llm");
      setActiveThreadId(localThreadId);
      setSessionId(localSessionId);

      ensureThreadExists(localThreadId, {
        title: "新對話",
        updatedAt: nowText(),
        preview: "",
        messageCount: 0,
        sessionId: localSessionId,
      });

      setMessages([
        {
          id: Date.now(),
          role: "assistant",
          content: WELCOME_TEXT,
        },
      ]);

      resetMainInputBox();

      setPendingFiles((prev) => {
        cleanupPendingFiles(prev);
        return [];
      });

      setIsHistoryOpen(false);
      setIsMobileNavOpen(false);
      setTimeout(() => inputRef.current?.focus(), 60);
    } finally {
      creatingThreadRef.current = false;
    }
  }  //自動抓取會員清單
  useEffect(() => {
    if (!hydrated) return;
    if (userMode !== "member") return;
    if (!userId || isGuestUid(userId)) return;

    let cancelled = false;

    (async () => {
      try {
        const convs = await apiFetchConversations(userId);
        if (cancelled) return;

        let mergedThreads: HistoryThread[] = [];

        setHistoryThreads((prev) => {
          const map = new Map<string, HistoryThread>();

          for (const t of prev) {
            if (userMode === "member" && !isGuestUid(userId) && String(t.id).startsWith("t-")) {
              continue;
            }
            map.set(t.id, t);
          }

          for (const t of convs) {
            map.set(t.id, { ...map.get(t.id), ...t });
          }

          return Array.from(map.values()).sort((a, b) =>
            String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""))
          );
        });

        const activeId = activeThreadIdRef.current;
        const activeExists =
          !!activeId &&
          convs.some((t: { id: any }) => String(t.id) === String(activeId));

        // 有歷史紀錄時：
        // 1) 沒 activeId -> 載第一筆
        // 2) activeId 不在目前清單裡 -> 載第一筆
        // 3) activeId 有效 -> 載 activeId
        const targetId =
          convs.length > 0
            ? (!activeId || !activeExists ? convs[0].id : activeId)
            : "";

        if (!targetId) return;

        activeThreadIdRef.current = targetId;
        setActiveThreadId(targetId);

        try {
          const msgs = await fetchConversationMessages(targetId);
          if (cancelled) return;

          setHistoryMessages((prev) => {
            const others = prev.filter((m) => m.threadId !== targetId);
            return [...others, ...msgs];
          });

          const t = convs.find((x: { id: any }) => String(x.id) === String(targetId));
          if (t?.sessionId) setSessionId(t.sessionId);

          setMessages(
            msgs.length > 0
              ? msgs.map((m, idx) => ({
                id: Date.now() + idx,
                role: m.role,
                content: m.content,
                resources: (m as HistoryMessageWithResources).resources,
              }))
              : [
                {
                  id: 1,
                  role: "assistant",
                  content: WELCOME_TEXT,
                },
              ]
          );
        } catch (err) {
          console.error("載入 conversation messages 失敗：", err);
        }
      } catch (err) {
        console.error("載入會員 conversations 失敗：", err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [hydrated, userId, userMode]);
  //   修掉「hydrate 還沒完成就 newThread 覆蓋快取」的 bug（最重要）
  const bootNewThreadOnceRef = useRef(false);
  useEffect(() => {
    if (!hydrated) return;
    if (!cacheLoadedRef.current) return;
    if (bootNewThreadOnceRef.current) return;

    const hasThread = !!searchParams.get("thread");
    const hasCase =
      !!searchParams.get("caseId") ||
      !!searchParams.get("caseld") ||
      !!searchParams.get("caseid");

    if (hasThread || hasCase) return;

    bootNewThreadOnceRef.current = true;

    if (!activeThreadId) {
      newThread();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, activeThreadId, searchParams]);
  function autoResizeTextarea() {
    const el = inputRef.current;
    if (!el) return;

    const text = el.value;

    if (text.trim().length === 0) {
      baseHeightRef.current = null;
      el.style.height = `${MIN_HEIGHT}px`;
      setIsMultiLine(false);
      setInputBoxHeight(MIN_HEIGHT);
      return;
    }

    el.style.height = "auto";
    const contentHeight = el.scrollHeight;

    if (!isMultiLine) {
      if (baseHeightRef.current === null) baseHeightRef.current = contentHeight;

      const singleLineHeight = baseHeightRef.current;
      if (contentHeight > singleLineHeight + 2) setIsMultiLine(true);

      el.style.height = `${MIN_HEIGHT}px`;
      setInputBoxHeight(MIN_HEIGHT);
      return;
    }

    const newHeight = Math.min(contentHeight, MAX_HEIGHT);
    el.style.height = `${newHeight}px`;
    setInputBoxHeight(newHeight);
  }

  useEffect(() => {
    if (activeView !== "llm") return;
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading, activeView]);

  useEffect(() => {
    requestAnimationFrame(() => autoResizeTextarea());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftText, isMultiLine]);

  useEffect(() => {
    function onDown(e: globalThis.MouseEvent) {
      const target = e.target as HTMLElement;
      if (!target.closest("[data-tool-menu-root]")) setShowToolMenu(false);
      if (!target.closest("[data-rag-dropdown-root]")) {
        setRagOpen(false);
        setMobileRagOpen(false);
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  function handleUploadClick() {
    fileInputRef.current?.click();
  }

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const newFiles: UploadedFile[] = Array.from(files).map((file) => ({
      id: `${Date.now()}-${file.name}-${Math.random().toString(36).slice(2)}`,
      name: file.name,
      size: file.size,
      type: file.type,
      url: URL.createObjectURL(file),
      raw: file,
    }));

    setPendingFiles((prev) => [...prev, ...newFiles]);
    e.target.value = "";
  }





  function removePendingFile(id: string) {
    setPendingFiles((prev) => {
      const target = prev.find((f) => f.id === id);
      if (target?.url?.startsWith("blob:")) {
        URL.revokeObjectURL(target.url);
      }
      return prev.filter((f) => f.id !== id);
    });
  }

  //   上傳完成後，更新 message 中的檔案 URL（從 local blob 換成 server URL）
  function updateMessageFilesToServerUrl(
    messageId: number,
    uploadedMap: Record<string, string>
  ) {
    setMessages((prev) =>
      prev.map((msg) => {
        if (msg.id !== messageId || !msg.files?.length) return msg;

        return {
          ...msg,
          files: msg.files.map((f) => {
            const nextUrl = uploadedMap[f.id];
            if (!nextUrl) return f;

            if (f.url?.startsWith("blob:")) {
              URL.revokeObjectURL(f.url);
            }

            return {
              ...f,
              serverUrl: nextUrl,
              url: nextUrl,
            };
          }),
        };
      })
    );
  }
  //   新增：上傳完成後，立刻丟一則 assistant 訊息（你要的效果）
  function appendAssistantMessage(
    threadId: string,
    text: string,
    resources?: ChatResource[]
  ) {
    const content = String(text ?? "");
    if (!content.trim()) return;

    const msg: ChatMessage = {
      id: Date.now() + Math.floor(Math.random() * 1000),
      role: "assistant",
      content,
      resources,
    };

    setMessages((prev) => [...prev, msg]);
    pushHistoryMessage(threadId, "assistant", content, resources);
    bumpThreadOnMessage(threadId, content.slice(0, 80), 1);
  }




  async function reallySendMessage(
    e?: FormEvent,
    textOverride?: string,
    piiMode: "block" | "mask" = "block"
  ) {
    if (e) e.preventDefault();

    const normalizedInput = normalizeLegacyMaskedText(
      (textOverride ?? draftText).trim()
    );

    if ((!normalizedInput && pendingFiles.length === 0) || loading) return;

    const threadIdAtSend = ensureActiveThreadIdForSend();
    const firstUserText = normalizedInput || "（已上傳檔案）";

    const filesSnapshot = pendingFiles.map((f) => ({
      ...f,
      raw: undefined,
    }));

    const userMessageId = Date.now();

    const userMessage: ChatMessage = {
      id: userMessageId,
      role: "user",
      content: firstUserText,
      files: filesSnapshot.length ? filesSnapshot : undefined,
    };

    setMessages((prev) => [...prev, userMessage]);
    pushHistoryMessage(threadIdAtSend, "user", firstUserText);

    bumpThreadOnMessage(threadIdAtSend, firstUserText, 1);
    maybeAutoTitle(threadIdAtSend, firstUserText);

    const filesToUpload = pendingFiles.slice();

    resetMainInputBox();
    setPendingFiles([]);

    setLoading(true);

    const assistantMessageId = Date.now() + 1;

    try {
      if (!HAS_BACKEND) {
        const answerText = fakeLLMReply(firstUserText);

        const botMessage: ChatMessage = {
          id: assistantMessageId,
          role: "assistant",
          content: String(answerText),
          resources: [],
        };

        setMessages((prev) => [...prev, botMessage]);
        pushHistoryMessage(threadIdAtSend, "assistant", String(answerText));
        bumpThreadOnMessage(
          threadIdAtSend,
          String(answerText).slice(0, 80),
          1
        );
        return;
      }

      const isPubmedOnly = ragMode === "pubmed_only";
      const isSoapOnly = ragMode === "soap_only";

      const wantFile =
        ragMode === "file_then_vector" || ragMode === "file_only";
      const wantVector =
        ragMode === "file_then_vector" || ragMode === "vector_only";

      let fileContextText = "";
      let summaryForUI = "";

      if (wantFile) {
        const uploadedMap: Record<string, string> = {};

        for (const f of filesToUpload) {
          if (!f.raw) continue;

          const up = await uploadOneFileToBackend(f.raw);

          const fn = String(up?.filename ?? up?.name ?? f.name);
          const summary = String(up?.summary ?? "");
          const txt = String(up?.text ?? "");
          const warn = String(up?.extract_warning ?? "");

          const urlRel = String(up?.legacy_url ?? up?.url ?? up?.path ?? "");
          const abs = toAbsUrl(urlRel);
          const finalUrl = abs || urlRel;

          f.serverUrl = finalUrl;
          if (finalUrl) {
            uploadedMap[f.id] = finalUrl;
          }

          if (summary.trim()) {
            summaryForUI += `\n\n【${fn}】摘要\n${summary.trim()}`;
          } else if (warn.trim()) {
            summaryForUI += `\n\n【${fn}】\n⚠️ 無法抽取文字/摘要：${warn.trim()}`;
          } else {
            summaryForUI += `\n\n【${fn}】\n⚠️ 這份檔案沒有回傳摘要（可能是掃描檔或無可抽取文字）`;
          }

          if (summary.trim()) {
            fileContextText += `\n\n---\n[檔案：${fn}]\n摘要：\n${summary.trim()}\n`;
          }
          if (txt.trim()) {
            const maxChars = 12000;
            fileContextText += `\n[檔案：${fn} 內容節錄]\n${txt.slice(
              0,
              maxChars
            )}${txt.length > maxChars ? "\n(…略)" : ""}\n`;
          }
        }

        if (summaryForUI.trim()) {
          appendAssistantMessage(
            threadIdAtSend,
            ` 已解析上傳檔案：${filesToUpload.length} 份\n${summaryForUI.trim()}`
          );
        }

        if (Object.keys(uploadedMap).length > 0) {
          updateMessageFilesToServerUrl(userMessageId, uploadedMap);
        }
      }

      const vectorHint =
        wantVector && !isPubmedOnly
          ? `\n\n---\n【RAG】請先用既有教材向量庫檢索後回答，並附 sources/citations（檔名/頁碼或chunk/score）。找不到就說找不到。`
          : "";

      const uid = (uidRef.current || userId || "guest").trim() || "guest";
      const sid =
        (sessionId || "").trim() ||
        `${uid}::${(threadIdAtSend || `t-${Date.now()}`).trim()}`;

      const safeText = normalizeLegacyMaskedText(firstUserText);



      const payload = {
        session_id: sid,
        user_id: uid,
        conversation_id: threadIdAtSend,
        privacy_consent: true,
        pii_mode: piiMode,
        rag_mode: ragMode,
        pubmed_max_results: 5,



        // 保留舊格式相容，但不要再塞 basePrompt
        messages: [
          {
            role: "user",
            type: "text",
            content: safeText || firstUserText || "（已上傳檔案）",
          },
        ],
      };

      const emptyBotMessage: ChatMessage = {
        id: assistantMessageId,
        role: "assistant",
        content: "",
        resources: [],
      };

      setMessages((prev) => [...prev, emptyBotMessage]);

      let streamedConversationId = "";
      let streamedSessionId = "";
      let streamedResources: ChatResource[] = [];

      await postChatStreamToBackend(payload, {
        onMeta: (meta) => {
          streamedConversationId = String(meta?.conversation_id ?? "");
          streamedSessionId = String(meta?.session_id ?? "");

          if (streamedSessionId) setSessionId(streamedSessionId);

          if (streamedConversationId) {
            replaceThreadId(
              threadIdAtSend,
              streamedConversationId,
              streamedSessionId || sid
            );

            setTimeout(() => {
              ensureBackendAutoTitleOnce(streamedConversationId, firstUserText);
            }, 0);
          }
        },

        onSources: (resources) => {
          streamedResources = Array.isArray(resources)
            ? resources.map((r: any) => ({
              title: String(r?.title ?? "未命名來源"),
              display_title: r?.display_title
                ? String(r.display_title)
                : String(r?.title ?? "未命名來源"),
              url: r?.url ? String(r.url) : undefined,
              download_url: r?.download_url ? String(r.download_url) : undefined,
              external_url: r?.external_url ? String(r.external_url) : undefined,
              source_type: r?.source_type ? String(r.source_type) : undefined,
              page: r?.page ? String(r.page) : undefined,
              snippet: r?.snippet ? String(r.snippet) : undefined,
              material_id: r?.material_id ? String(r.material_id) : undefined,
              score:
                typeof r?.score === "number"
                  ? r.score
                  : r?.score != null
                    ? Number(r.score)
                    : undefined,
            }))
            : [];

          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === assistantMessageId
                ? { ...msg, resources: streamedResources }
                : msg
            )
          );
        },

        onToken: (token) => {
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === assistantMessageId
                ? { ...msg, content: (msg.content || "") + token }
                : msg
            )
          );
        },

        onDone: () => {
          const finalThreadId = streamedConversationId || threadIdAtSend;
          const bot = latestMessagesRef.current.find(
            (m) => m.id === assistantMessageId
          );
          const finalText = bot?.content || "";

          pushHistoryMessage(
            finalThreadId,
            "assistant",
            finalText,
            streamedResources
          );

          bumpThreadOnMessage(
            finalThreadId,
            finalText.slice(0, 80),
            1
          );
        },

        onError: (evt) => {
          throw new Error(evt?.message || "串流失敗");
        },
      });
    } catch (err: any) {
      const msg = `⚠️ 後端呼叫失敗：${err?.message ?? String(err)}`;

      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMessageId
            ? { ...m, content: msg, resources: [] }
            : m
        )
      );

      pushHistoryMessage(threadIdAtSend, "assistant", msg);
      bumpThreadOnMessage(threadIdAtSend, msg, 1);
    } finally {
      setLoading(false);
    }
  }

  async function sendMessage(e?: FormEvent) {
    if (e) e.preventDefault();

    const text = draftText.trim();
    if ((!text && pendingFiles.length === 0) || loading) return;

    // 有命中敏感資訊 => 跳出選擇框
    const hits = detectSensitiveInfo(text);
    if (hits.length > 0) {
      setSensitiveHits(hits);
      setShowSensitiveModal(true);
      return;
    }

    // 沒命中 => 正常送出
    await reallySendMessage(undefined, text, "block");
  }

  async function handleMaskAndSend() {
    const text = draftText.trim();
    if (!text || loading) return;

    const masked = normalizeLegacyMaskedText(maskSensitiveInfo(text));

    setShowSensitiveModal(false);
    setSensitiveHits([]);

    await reallySendMessage(undefined, masked, "mask");
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // @ts-ignore
    if (e.nativeEvent?.isComposing) return;

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  function toBackendMessages(uiMsgs: ChatMessage[]) {
    return uiMsgs.map((m) => ({
      role: m.role,
      type: "text",
      content: m.content,
      url: null,
      filetype: null,
    }));
  }
  async function handleSendWithoutMask() {
    const text = draftText.trim();
    if (!text || loading) return;

    setShowSensitiveModal(false);
    setSensitiveHits([]);

    await reallySendMessage(undefined, text, "block");
  }

  async function handleExport(type: "pdf" | "pptx") {
    setShowToolMenu(false);

    try {
      if (!messages.length) {
        alert("目前沒有可匯出的內容");
        return;
      }
      if (!HAS_BACKEND) {
        alert("尚未設定 NEXT_PUBLIC_BACKEND_URL，無法匯出");
        return;
      }
      const payload = {
        session_id: (sessionId || "").trim(),
        user_id: (uidRef.current || userId || "guest").trim(),
        messages: toBackendMessages(messages),
      };

      if (type === "pdf") {
        const blob = await exportToBackend("pdf", payload);
        downloadBlob(blob, `chat_${Date.now()}.pdf`);
        return;
      }

      const blob = await exportToBackend("pptx", payload);
      downloadBlob(blob, `chat_${Date.now()}.pptx`);
    } catch (e: any) {
      alert(e?.message || "匯出失敗");
    }
  }

  function ToolMenuItem({
    iconClass,
    label,
    onClick,
  }: {
    iconClass: string;
    label: string;
    onClick: () => void;
  }) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="w-full text-left px-3 py-[8px] flex items-center gap-2"
        style={{ cursor: "pointer" }}
        onMouseEnter={(e) =>
          (e.currentTarget.style.backgroundColor = NAV_HOVER_BG)
        }
        onMouseLeave={(e) =>
          (e.currentTarget.style.backgroundColor = "transparent")
        }
      >
        <span className="w-5 h-5 flex items-center justify-center shrink-0">
          <i className={`${iconClass} text-[12px] opacity-70`} />
        </span>
        <span className="leading-none text-[12px]">{label}</span>
      </button>
    );
  }

  function ToolMenuDivider() {
    return (
      <div
        className="mx-3 my-1 h-px"
        style={{ backgroundColor: "rgba(148,163,184,0.22)" }}
      />
    );
  }

  function handleDrawerTouchStart(e: React.TouchEvent<HTMLDivElement>) {
    const x = e.touches[0]?.clientX ?? 0;
    touchStartXRef.current = x;
    touchCurrentXRef.current = x;
    setIsDraggingDrawer(false);
  }

  function handleDrawerTouchMove(e: React.TouchEvent<HTMLDivElement>) {
    if (touchStartXRef.current === null) return;

    const currentX = e.touches[0]?.clientX ?? 0;
    touchCurrentXRef.current = currentX;

    const deltaX = currentX - touchStartXRef.current;

    if (Math.abs(deltaX) > 8) {
      setIsDraggingDrawer(true);
    }

    if (deltaX < 0) {
      setMobileDrawerOffsetX(deltaX);
    } else {
      setMobileDrawerOffsetX(0);
    }
  }

  function handleDrawerTouchEnd() {
    const startX = touchStartXRef.current;
    const endX = touchCurrentXRef.current;

    if (startX === null || endX === null) {
      setIsDraggingDrawer(false);
      setMobileDrawerOffsetX(0);
      touchStartXRef.current = null;
      touchCurrentXRef.current = null;
      return;
    }

    const deltaX = endX - startX;

    // 往左滑超過 80px 就關閉
    if (deltaX < -80) {
      setIsMobileNavOpen(false);
      setMobileRagOpen(false);
    }

    setIsDraggingDrawer(false);
    setMobileDrawerOffsetX(0);
    touchStartXRef.current = null;
    touchCurrentXRef.current = null;
  }

  function ToolMenu() {
    return (
      <div
        className="absolute left-0 bottom-full mb-2 w-36 rounded-xl overflow-hidden z-30 border"
        style={{
          backgroundColor: "var(--background)",
          borderColor: "var(--navbar-border)",
          color: "var(--foreground)",
          boxShadow: "0 18px 40px rgba(15,23,42,0.18)",
        }}
      >
        <ToolMenuItem
          iconClass="fa-solid fa-cloud-arrow-up"
          label="上傳檔案"
          onClick={() => {
            setShowToolMenu(false);
            handleUploadClick();
          }}
        />
        <ToolMenuDivider />
        <ToolMenuItem
          iconClass="fa-solid fa-file-pdf"
          label="匯出 PDF"
          onClick={() => handleExport("pdf")}
        />
        <ToolMenuItem
          iconClass="fa-solid fa-file-powerpoint"
          label="匯出 PPT"
          onClick={() => handleExport("pptx")}
        />
      </div>
    );
  }

  function ResourceCarousel({ resources }: { resources: ChatResource[] }) {
    const [index, setIndex] = useState(0);

    const safeResources = Array.isArray(resources) ? resources : [];
    const total = safeResources.length;

    useEffect(() => {
      if (index > total - 1) {
        setIndex(0);
      }
    }, [index, total]);

    const goPrev = useCallback(() => {
      setIndex((prev) => (prev - 1 + total) % total);
    }, [total]);

    const goNext = useCallback(() => {
      setIndex((prev) => (prev + 1) % total);
    }, [total]);

    if (!total) return null;

    const r = safeResources[index];
    const displayTitle =
      (r.display_title || r.title || `參考資料 ${index + 1}`).trim();

    const isUploadsUrl = (v?: string) =>
      !!v && /\/uploads\//i.test(v);

    const resolvedViewUrl =
      r.material_id
        ? `${API_BASE}/s2/llm/materials/${r.material_id}/view`
        : (r.url && !isUploadsUrl(r.url) ? toAbsUrl(r.url) : "");

    const resolvedDownloadUrl =
      r.material_id
        ? `${API_BASE}/s2/llm/materials/${r.material_id}/download`
        : (r.download_url && !isUploadsUrl(r.download_url) ? toAbsUrl(r.download_url) : "");

    const metaParts = [
      r.page ? `${r.page}` : "",
      typeof r.score === "number" && !Number.isNaN(r.score)
        ? `置信度 ${r.score.toFixed(3)}`
        : "",
    ].filter(Boolean);

    const cleanSnippet = (r.snippet || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 180);

    return (
      <div className="mt-2">
        <div className="flex items-center justify-between mb-2">
          <div className="text-[11px] font-semibold opacity-70">參考資料</div>

          {total > 1 && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={goPrev}
                className="w-7 h-7 rounded-full border flex items-center justify-center text-[11px]"
                style={{ borderColor: "rgba(148,163,184,0.30)" }}
                title="上一張"
              >
                <i className="fa-solid fa-chevron-left" />
              </button>

              <div className="text-[11px] opacity-60 min-w-[52px] text-center">
                {index + 1} / {total}
              </div>

              <button
                type="button"
                onClick={goNext}
                className="w-7 h-7 rounded-full border flex items-center justify-center text-[11px]"
                style={{ borderColor: "rgba(148,163,184,0.30)" }}
                title="下一張"
              >
                <i className="fa-solid fa-chevron-right" />
              </button>
            </div>
          )}
        </div>

        <div
          className="rounded-xl border px-3 py-2 text-xs"
          style={{
            borderColor: "rgba(148,163,184,0.25)",
            backgroundColor: "rgba(148,163,184,0.06)",
          }}
        >
          <div className="font-medium break-words">{displayTitle}</div>

          {metaParts.length > 0 && (
            <div className="mt-1 text-[11px] opacity-60">
              {metaParts.join(" ｜ ")}
            </div>
          )}

          {cleanSnippet && (
            <div
              className="mt-2 break-words opacity-80 text-[12px] leading-relaxed"
              style={{
                display: "-webkit-box",
                WebkitLineClamp: 4,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
            >
              {cleanSnippet}
              {r.snippet && r.snippet.length > 180 ? "…" : ""}
            </div>
          )}

          <div className="mt-2 flex flex-wrap gap-2">
            {resolvedViewUrl ? (
              <a href={resolvedViewUrl} target="_blank" rel="noreferrer">
                查看文件
              </a>
            ) : r.external_url ? (
              <a href={r.external_url} target="_blank" rel="noreferrer">
                前往連結
              </a>
            ) : null}

            {resolvedDownloadUrl ? (
              <a href={resolvedDownloadUrl} target="_blank" rel="noreferrer">
                下載
              </a>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  function renderResources(resources?: ChatResource[]) {
    if (!resources || resources.length === 0) return null;

    const bestByKey = new Map<string, ChatResource>();

    for (const r of resources) {
      const normTitle = (r.display_title || r.title || "")
        .trim()
        .toLowerCase();

      const normPage = String(r.page || "").trim().toLowerCase();
      const normSnippet = String(r.snippet || "")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase()
        .slice(0, 120);

      const normChunk = String((r as any).chunk || "").trim().toLowerCase();

      // 先用內容去重，再退回 url/material_id
      const key =
        (normTitle && (normPage || normChunk || normSnippet))
          ? `content:${normTitle}|${normPage}|${normChunk}|${normSnippet}`
          : (r.url && `url:${r.url}`) ||
          (r.download_url && `download:${r.download_url}`) ||
          (r.external_url && `ext:${r.external_url}`) ||
          (r.material_id && `mid:${r.material_id}`) ||
          (normTitle && `title:${normTitle}`) ||
          `fallback:${Math.random()}`;

      const prev = bestByKey.get(key);

      const prevScore =
        typeof prev?.score === "number" && !Number.isNaN(prev.score)
          ? prev.score
          : -1;

      const nextScore =
        typeof r?.score === "number" && !Number.isNaN(r.score)
          ? r.score
          : -1;

      if (!prev || nextScore > prevScore) {
        bestByKey.set(key, r);
      }
    }

    const deduped = Array.from(bestByKey.values()).sort((a, b) => {
      const aScore =
        typeof a?.score === "number" && !Number.isNaN(a.score) ? a.score : -1;
      const bScore =
        typeof b?.score === "number" && !Number.isNaN(b.score) ? b.score : -1;
      return bScore - aScore;
    });

    const highScore = deduped.filter(
      (r) => typeof r.score === "number" && !Number.isNaN(r.score) && r.score >= 0.5
    );

    const finalResources = (highScore.length > 0 ? highScore : deduped).slice(0, 6);

    if (finalResources.length === 0) return null;

    return <ResourceCarousel resources={finalResources} />;
  }

  function renderMessageFiles(files?: UploadedFile[]) {
    if (!files || files.length === 0) return null;

    return (
      <div className="mt-2 max-h-40 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
        {files.map((file) => {
          const isImage =
            typeof file.type === "string" && file.type.startsWith("image/");
          return (
            <div
              key={file.id}
              className="border rounded-xl px-2 py-2 flex items-center gap-2 bg-black/5"
              style={{ borderColor: "rgba(148,163,184,0.25)" }}
            >
              {isImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={toAbsUrl(file.serverUrl || file.url)}
                  alt={file.name}
                  className="w-8 h-8 object-cover rounded-lg"
                />) : (
                <div className="w-8 h-8 flex items-center justify-center rounded-lg border">
                  <i className="fa-regular fa-file text-[11px]" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="truncate text-[11px]">{file.name}</div>
                <div className="opacity-60 text-[10px]">
                  {(file.size / 1024).toFixed(1)} KB
                </div>
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  function SideIconButton({
    iconClass,
    label,
    active,
    onClick,
  }: {
    iconClass: string;
    label: string;
    active?: boolean;
    onClick?: () => void;
  }) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="w-9 h-9 rounded-lg flex items-center justify-center transition"
        style={{ backgroundColor: active ? NAV_ACTIVE_BG : "transparent" }}
        onMouseEnter={(e) => {
          if (active) return;
          e.currentTarget.style.backgroundColor = NAV_HOVER_BG;
        }}
        onMouseLeave={(e) => {
          if (active) return;
          e.currentTarget.style.backgroundColor = "transparent";
        }}
        title={label}
      >
        <i
          className={`${iconClass} text-[15px] opacity-70 leading-none`}
          style={{ lineHeight: 1 }}
        />
      </button>
    );
  }

  function SideRow({
    iconClass,
    label,
    active,
    onClick,
  }: {
    iconClass: string;
    label: string;
    active?: boolean;
    onClick?: () => void;
  }) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="w-full flex items-center gap-3 px-3 py-2 rounded-lg transition"
        style={{ backgroundColor: active ? NAV_ACTIVE_BG : "transparent" }}
        onMouseEnter={(e) => {
          if (active) return;
          e.currentTarget.style.backgroundColor = NAV_HOVER_BG;
        }}
        onMouseLeave={(e) => {
          if (active) return;
          e.currentTarget.style.backgroundColor = "transparent";
        }}
      >
        <i
          className={`${iconClass} text-[14px] opacity-70 leading-none`}
          style={{ lineHeight: 1 }}
        />
        <span>{label}</span>
      </button>
    );
  }

  function SideThreadItem({
    title,
    meta,
    active,
    onClick,
    threadId,
  }: {
    title: string;
    meta?: string;
    active?: boolean;
    onClick: () => void;
    threadId: string;
  }) {
    return (
      <div
        className="w-full rounded-lg transition"
        style={{ backgroundColor: active ? NAV_ACTIVE_BG : "transparent" }}
        onMouseEnter={(e) => {
          if (active) return;
          e.currentTarget.style.backgroundColor = NAV_HOVER_BG;
        }}
        onMouseLeave={(e) => {
          if (active) return;
          e.currentTarget.style.backgroundColor = "transparent";
        }}
        title={title}
      >
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={onClick}
            className="min-w-0 flex-1 text-left px-3 py-1.5 rounded-lg"
          >
            <div className="text-[13px] font-medium truncate max-w-[180px]">
              {title}
            </div>
            {meta ? <div className="text-[11px] opacity-50 mt-0.5 truncate">{meta}</div> : null}
          </button>

          <div
            className="shrink-0 pr-2"
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <ThreadMoreMenu
              threadId={threadId}
              NAV_HOVER_BG={NAV_HOVER_BG}
              onShare={() => shareThread(threadId)}
              onDelete={() => deleteThread(threadId)}
            />
          </div>
        </div>
      </div>
    );
  }

  async function openHistory() {
    try {
      const uid = (uidRef.current || userId || "guest").trim() || "guest";

      if (userMode === "guest" || isGuestUid(uid)) {
        requireLoginForHistory();
        return;
      }

      const threads = await apiFetchConversations(uid);

      setHistoryThreads((prev) => {
        const map = new Map<string, HistoryThread>();

        for (const t of prev) {
          if (userMode === "member" && !isGuestUid(userId) && String(t.id).startsWith("t-")) {
            continue;
          }
          map.set(t.id, t);
        }

        for (const t of threads) {
          map.set(t.id, { ...map.get(t.id), ...t });
        }

        return Array.from(map.values()).sort((a, b) =>
          String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""))
        );
      });

      setHistoryPreviewThreadId("");
      setIsHistoryOpen(true);
    } catch (e: any) {
      alert(String(e?.message || e));
    }
  }

  function PlaceholderView({ title }: { title: string }) {
    return (
      <section className="flex-1 min-h-0 flex flex-col">
        <div className="mb-3">
          <h2 className="text-sm font-semibold">{title}</h2>
          <p className="text-[11px] opacity-60">（先放佔位，之後再補功能）</p>
        </div>
        <div
          className="flex-1 rounded-2xl border flex items-center justify-center text-sm opacity-70"
          style={{ borderColor: "rgba(148,163,184,0.20)" }}
        >
          這裡是「{title}」頁面（假頁面）
        </div>
      </section>
    );
  }

  // =========================
  //   Bootstrap-from-S1（保持你原邏輯；但 seed 只有帶 caseId 才出現）
  // =========================

  //   這段邏輯只在「網址有 caseId 參數」時觸發，且會把 caseId 當成唯一 seed（不管其他參數），適合從 S1 的「用 AI 解讀影像檢測結果」按鈕點進來的情境
  useEffect(() => {
    const threadId = searchParams.get("thread");

    if (!threadId) {
      loadedThreadFromUrlRef.current = "";
      return;
    }

    if (loadedThreadFromUrlRef.current === threadId) return;
    loadedThreadFromUrlRef.current = threadId;

    loadThreadToMain(threadId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  useEffect(() => {
    const threadId = searchParams.get("thread");
    if (threadId) return;

    const caseIdStr =
      searchParams.get("caseId") ??
      searchParams.get("caseld") ??
      searchParams.get("caseid") ??
      "";

    if (!caseIdStr) {
      bootOnceRef.current = "";
      return;
    }

    if (bootOnceRef.current === caseIdStr) return;
    bootOnceRef.current = caseIdStr;

    const caseId = Number(caseIdStr);
    if (!Number.isFinite(caseId) || caseId <= 0) return;

    if (typeof window !== "undefined") {
      localStorage.setItem("gab_last_case_id", String(caseIdStr));
    }

    const uid = (uidRef.current || userId || "guest").trim() || "guest";
    const localThreadId = `t-${Date.now()}`;
    const localSessionId = `${uid}::${makeUuid()}`;

    activeThreadIdRef.current = localThreadId;
    setActiveThreadId(localThreadId);
    setSessionId(localSessionId);

    ensureThreadExists(localThreadId, {
      title: "新對話",
      updatedAt: nowText(),
      preview: "",
      messageCount: 0,
      sessionId: localSessionId,
    });

    const threadIdAtBoot = localThreadId;

    setSeedImageUrl("");
    setSeedDetections([]);
    setActiveView("llm");
    setMessages([
      {
        id: Date.now(),
        role: "assistant",
        content: WELCOME_TEXT,
      },
    ]);

    setPendingFiles((prev) => {
      cleanupPendingFiles(prev);
      return [];
    });

    resetMainInputBox();

    setIsHistoryOpen(false);

    setHistoryPreviewThreadId("");
    (async () => {
      try {
        let r: Response;

        try {
          r = await fetch(BOOT_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ image_case_id: caseId }),
          });
        } catch (err: any) {
          throw new Error(
            `bootstrap fetch 失敗：${err?.message || String(err)} ｜ BOOT_URL=${BOOT_URL}`
          );
        }

        const raw = await r.text();
        const data = safeJsonParse(raw);

        if (!r.ok) {
          throw new Error(`bootstrap HTTP ${r.status}：${raw.slice(0, 500)}`);
        }

        if (!data) {
          throw new Error(`bootstrap 回傳不是合法 JSON：${raw.slice(0, 500)}`);
        }
        const bootSession = data.session_id ? String(data.session_id) : "";
        if (bootSession) setSessionId(bootSession);

        const seedText = Array.isArray(data.seed_messages)
          ? String(
            data.seed_messages.find(
              (m: any) => m?.type === "text" && (m?.content ?? "").trim()
            )?.content ?? ""
          )
          : "";

        const imgRel = Array.isArray(data.seed_messages)
          ? String(
            data.seed_messages.find((m: any) => m?.type === "image" && m?.url)
              ?.url ?? ""
          )
          : "";

        const imgAbs = toAbsUrl(imgRel);

        if (imgAbs) setSeedImageUrl(imgAbs);
        const dets = Array.isArray(data.detections)
          ? (data.detections as Detection[])
          : [];
        setSeedDetections(dets);

        const seedFiles: UploadedFile[] = imgAbs
          ? [
            {
              id: `seed_${caseId}`,
              name: `ImageCase_${caseId}.png`,
              size: 0,
              type: "image/png",
              url: imgAbs,
            },
          ]
          : [];

        const question =
          seedText.trim() || `請解釋這個 caseId=${caseId} 的影像偵測結果`;

        setMessages((prev) => [
          ...prev,
          {
            id: Date.now(),
            role: "user",
            content: question,
            files: seedFiles.length ? seedFiles : undefined,
          },
        ]);

        pushHistoryMessage(threadIdAtBoot, "user", question);

        bumpThreadOnMessage(threadIdAtBoot, String(question).slice(0, 80), 1);
        maybeAutoTitle(threadIdAtBoot, question);

        const payload = {
          session_id: (bootSession || sessionId || "").trim(),
          user_id: (uidRef.current || userId || "guest").trim(),
          conversation_id: threadIdAtBoot,
          messages: [{ role: "user", type: "text", content: question }],
        };

        const resp = await postChatToBackend(payload);

        const cid = String(resp?.conversation_id ?? "");
        const sidFromServer = String(resp?.session_id ?? "");
        if (sidFromServer) setSessionId(sidFromServer);

        if (cid) {
          replaceThreadId(threadIdAtBoot, cid, sidFromServer || bootSession);

          //   同步 title（只在新對話時做一次）
          setTimeout(() => {
            ensureBackendAutoTitleOnce(cid, question);
          }, 0);
        }

        let answerText = "";
        if (resp?.answer || resp?.content || resp?.message) {
          answerText = String(resp.answer ?? resp.content ?? resp.message);
        } else {
          answerText =
            String(
              resp?.reply ??
              (Array.isArray(resp?.messages)
                ? [...resp.messages]
                  .reverse()
                  .find((m: any) => m?.role === "assistant")?.content ??
                resp.messages[resp.messages.length - 1]?.content ??
                ""
                : "")
            ) || "";
        }

        const botResources: ChatResource[] = Array.isArray(resp?.resources)
          ? resp.resources.map((r: any) => ({
            title: String(r?.title ?? "未命名來源"),
            display_title: r?.display_title
              ? String(r.display_title)
              : String(r?.title ?? "未命名來源"),
            url: r?.url ? String(r.url) : undefined,
            download_url: r?.download_url ? String(r.download_url) : undefined,
            external_url: r?.external_url ? String(r.external_url) : undefined,
            source_type: r?.source_type ? String(r.source_type) : undefined,
            page: r?.page ? String(r.page) : undefined,
            snippet: r?.snippet ? String(r.snippet) : undefined,
            material_id: r?.material_id ? String(r.material_id) : undefined,
            score:
              typeof r?.score === "number"
                ? r.score
                : r?.score != null
                  ? Number(r.score)
                  : undefined,
          }))
          : [];

        setMessages((prev) => [
          ...prev,
          {
            id: Date.now() + 1,
            role: "assistant",
            content: String(answerText),
            resources: botResources,
          },
        ]);

        const finalThreadId = cid || threadIdAtBoot;

        pushHistoryMessage(
          finalThreadId,
          "assistant",
          String(answerText),
          botResources
        );

        bumpThreadOnMessage(
          finalThreadId,
          String(answerText).slice(0, 80),
          1
        );
      } catch (e: any) {
        const msg = `bootstrap 失敗：${e?.message ?? String(e)}`;
        setMessages((prev) => [
          ...prev,
          {
            id: Date.now() + 2,
            role: "assistant",
            content: msg,
            resources: [],
          },
        ]);

        pushHistoryMessage(threadIdAtBoot, "assistant", msg);

        bumpThreadOnMessage(threadIdAtBoot, msg, 1);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // =========================
  //  下面 return UI：完全不動（你原本的 JSX 그대로）
  // =========================
  return (
    <div
      className="llm-page h-[calc(100vh-4rem)] flex overflow-hidden transition-colors duration-500 relative"
      style={{
        backgroundColor: "var(--background)",
        color: "var(--foreground)",
      }}
    >
      <HistoryOverlay
        isOpen={isHistoryOpen}
        onClose={() => {
          setIsHistoryOpen(false);
          setHistoryPreviewThreadId("");
        }}
        historyThreads={
          userMode === "member" && !isGuestUid(userId)
            ? historyThreads.filter((t) => !String(t.id).startsWith("t-"))
            : historyThreads
        }
        historyMessages={historyMessages}
        activeThreadId={historyPreviewThreadId}
        onSelectThread={(id) => setHistoryPreviewThreadId(id)}
        onLoadThreadToMain={(id) => loadThreadToMain(id)}
        onNewThread={() => newThread()}
        onRenameThread={renameThread}
        onDeleteThread={deleteThread}
        onShareThread={shareThread}
        NAV_ACTIVE_BG={NAV_ACTIVE_BG}
        NAV_HOVER_BG={NAV_HOVER_BG}
        persistedQueryRef={historyPersistedQueryRef}
      />

      {!isMobileNavOpen && (
        <button
          type="button"
          className="md:hidden absolute left-3 top-3 z-40 w-9 h-9 rounded-xl flex items-center justify-center bg-white/60 backdrop-blur"
          style={{ border: "1px solid rgba(148,163,184,0.18)" }}
          onClick={() => setIsMobileNavOpen(true)}
          aria-label="Open sidebar"
          title="開啟導覽列"
        >
          <i className="fa-solid fa-bars text-[14px] opacity-70" />
        </button>
      )}

      {/* Desktop sidebar */}
      <div className="hidden md:block">
        <aside
          className={`h-full flex flex-col border-r transition-all duration-300 ease-out ${isNavCollapsed ? "w-[72px]" : "w-64"
            }`}
          style={{
            backgroundColor: "rgba(148,163,184,0.06)",
            borderColor: "rgba(148,163,184,0.20)",
            color: "var(--navbar-text)",
          }}
        >
          {/* Header */}
          <div
            className={`flex ${isNavCollapsed
              ? "justify-center items-center px-3 pt-3 pb-3"
              : "items-start justify-between px-4 pt-4 pb-3"
              }`}
          >
            {!isNavCollapsed && (
              <div>
                <h1 className="text-lg font-semibold tracking-wide">
                  GalaBone
                </h1>
                <p className="text-[11px] mt-1 opacity-70">Your Bone We Care</p>
              </div>
            )}

            <button
              type="button"
              onClick={() => setIsNavCollapsed((v) => !v)}
              title={isNavCollapsed ? "展開導覽列" : "收合導覽列"}
              className="w-9 h-9 rounded-lg grid place-items-center transition"
              style={{
                border: "1px solid rgba(148,163,184,0.18)",
                backgroundColor: "transparent",
              }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.backgroundColor = NAV_HOVER_BG)
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.backgroundColor = "transparent")
              }
            >
              <i
                className={`fa-solid ${isNavCollapsed ? "fa-angle-right" : "fa-angle-left"
                  } text-[13px] opacity-65 leading-none`}
                style={{ lineHeight: 1, transform: "translateY(0.5px)" }}
              />
            </button>
          </div>

          {/* Nav */}
          <nav
            className={`flex-1 min-h-0 ${isNavCollapsed ? "px-2 pt-3" : "px-3 pt-4"
              }`}
          >
            {!isNavCollapsed ? (
              <div className="h-full min-h-0 flex flex-col gap-2 text-sm">
                <div className="space-y-1">
                  <div className="px-3 pt-2">
                    <div className="text-[13px] font-semibold opacity-85 mb-1">
                      RAG 模式{" "}
                      <span className="text-[11px] font-normal opacity-60">
                        （不會建立索引）
                      </span>
                    </div>

                    <div className="pt-0">
                      <div className="relative" data-rag-dropdown-root>
                        <button
                          type="button"
                          onClick={() => setRagOpen((v) => !v)}
                          className="w-full flex items-start justify-between rounded-xl px-3 py-2 text-[12px] border transition gap-2"
                          style={{
                            backgroundColor: "rgba(148,163,184,0.06)",
                            borderColor: ragOpen
                              ? "rgba(148,163,184,0.28)"
                              : "rgba(148,163,184,0.18)",
                            boxShadow: ragOpen
                              ? "0 0 0 2px rgba(148,163,184,0.10)"
                              : "none",
                            color: "var(--foreground)",
                          }}
                        >
                          <span
                            className="block flex-1 text-left"
                            style={{
                              display: "-webkit-box",
                              WebkitLineClamp: 2,
                              WebkitBoxOrient: "vertical",
                              overflow: "hidden",
                              lineHeight: "1.35",
                              whiteSpace: "normal",
                              wordBreak: "break-word",
                              opacity: 0.9,
                            }}
                          >
                            {ragMode === "file_then_vector" &&
                              "查詢上傳檔案與衛教智慧庫"}
                            {/* {ragMode === "vector_only" &&
                              "查詢衛教智慧庫"}
                            {/* {ragMode === "file_only" &&
                              "查詢上傳檔案"} */}
                            {ragMode === "pubmed_only" &&
                              "查詢 PubMed 美國國家醫學圖書館 NLM 開發的免費生醫文獻搜尋引擎"}
                            {ragMode === "soap_only" &&
                              "查詢已授權的輔大醫院之去識別化soap記錄"}


                          </span>

                          <i
                            className={`fa-solid fa-chevron-down mt-[2px] text-[11px] opacity-60 transition ${ragOpen ? "rotate-180" : ""
                              }`}
                          />
                        </button>

                        {ragOpen && (
                          <div
                            className="absolute z-50 mt-2 w-full rounded-xl overflow-hidden border"
                            style={{
                              maxWidth: "360px",
                              backgroundColor: "var(--background)",
                              borderColor: "rgba(148,163,184,0.22)",
                              boxShadow: "0 12px 28px rgba(0,0,0,0.22)",
                              color: "var(--foreground)",
                            }}
                          >
                            {[
                              {
                                value: "file_then_vector",
                                label: "查詢上傳檔案與衛教智慧庫",
                              },
                              // {
                              //   value: "vector_only",
                              //   label: "查詢衛教智慧庫",
                              // },
                              // {
                              //   value: "file_only",
                              //   label: "查詢上傳檔案",
                              // },
                              {
                                value: "pubmed_only",
                                label: "查詢PubMed 美國國家醫學圖書館 NLM 開發的免費生醫文獻搜尋引擎",
                              },
                              {
                                value: "soap_only",
                                label: "查詢已授權的輔大醫院之去識別化soap記錄",
                              },
                            ].map((opt) => {
                              const active = ragMode === opt.value;

                              return (
                                <button
                                  key={opt.value}
                                  type="button"
                                  onClick={() => {
                                    setRagMode(opt.value as RagMode);
                                    setRagOpen(false);
                                  }}
                                  className="w-full text-left px-3 py-2 text-[13px] transition"
                                  style={{
                                    lineHeight: "1.5",
                                    whiteSpace: "normal",
                                    wordBreak: "break-word",
                                    backgroundColor: active
                                      ? NAV_ACTIVE_BG
                                      : "transparent",
                                    fontWeight: active ? 600 : 400,
                                    color: "var(--foreground)",
                                  }}
                                  onMouseEnter={(e) => {
                                    if (active) return;
                                    e.currentTarget.style.backgroundColor =
                                      NAV_HOVER_BG;
                                  }}
                                  onMouseLeave={(e) => {
                                    if (active) return;
                                    e.currentTarget.style.backgroundColor =
                                      "transparent";
                                  }}
                                >
                                  {opt.label}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>

                      <div className="pt-1 pb-2 text-[11px] opacity-50">
                        新對話將使用此 RAG 模式
                      </div>
                    </div>

                    <div
                      className="mt-2"
                      style={{ borderTop: "1px solid rgba(148,163,184,0.18)" }}
                    />
                  </div>

                  <div className="mt-1">
                    <SideRow
                      iconClass="fa-regular fa-message"
                      label="新對話"
                      onClick={() => newThread()}
                    />                  </div>
                  <SideRow
                    iconClass="fa-solid fa-folder-tree"
                    label="資源管理"
                    active={activeView === "assets"}
                    onClick={() => setActiveView("assets")}
                  />
                  <SideRow
                    iconClass="fa-regular fa-clock"
                    label="對話紀錄"
                    active={isHistoryOpen}
                    onClick={() => openHistory()}
                  />
                </div>

                <div className="min-h-0 flex-1 flex flex-col">
                  <div className="flex items-center justify-between px-1 mb-2">
                    <p className="text-[11px] tracking-wide opacity-60">
                      最近對話
                    </p>
                    <button
                      type="button"
                      className="text-[11px] opacity-60 hover:opacity-90 transition"
                      onClick={() => openHistory()}
                      title="搜尋與管理對話"
                    >
                      搜尋
                    </button>
                  </div>

                  <div className="min-h-0 flex-1 overflow-y-auto space-y-1 pr-1">
                    {historyThreads
                      .filter((t) => {
                        // member 只顯示正式 conversation，不顯示前端暫時 t-xxx
                        if (userMode === "member" && !isGuestUid(userId)) {
                          return !!t.id && !String(t.id).startsWith("t-");
                        }

                        // guest 只保留目前 active 那一筆
                        return t.id === activeThreadId;
                      })
                      .slice(0, 8)
                      .map((t) => (
                        <SideThreadItem
                          key={t.id}
                          threadId={t.id}
                          title={t.title}
                          meta={formatThreadTime(t.updatedAt)}
                          active={activeThreadId === t.id}
                          onClick={() => loadThreadToMain(t.id)}
                        />
                      ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3 pt-2">
                <SideIconButton
                  iconClass="fa-regular fa-message"
                  label="新對話"
                  onClick={() => newThread()}
                />

                <SideIconButton
                  iconClass="fa-solid fa-folder-tree"
                  label="資源管理"
                  active={activeView === "assets"}
                  onClick={() => setActiveView("assets")}
                />
                <SideIconButton
                  iconClass="fa-regular fa-clock"
                  label="對話紀錄"
                  active={isHistoryOpen}
                  onClick={() => openHistory()}
                />
              </div>
            )}
          </nav>

          <div
            className={`border-t ${isNavCollapsed ? "px-2 py-3" : "px-4 py-3"}`}
            style={{ borderColor: "rgba(148,163,184,0.20)" }}
          >
            {isNavCollapsed ? (
              <div className="flex justify-center">
                <SideIconButton iconClass="fa-solid fa-gear" label="設定" />
              </div>
            ) : (
              <button
                type="button"
                className="w-full flex items-center gap-2 text-[12px] opacity-75 hover:opacity-100 transition"
              >
                <i
                  className="fa-solid fa-gear text-[11px] opacity-80 leading-none"
                  style={{ lineHeight: 1 }}
                />
                <span>設定</span>
              </button>
            )}
          </div>
        </aside>
      </div>

      {/* Mobile drawer */}
      {isMobileNavOpen && (
        <div className="md:hidden fixed inset-0 z-[60]">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => {
              setIsMobileNavOpen(false);
              setMobileRagOpen(false);
            }}
          />

          <div className="absolute inset-0" onClick={(e) => e.stopPropagation()}>
            <aside
              className="h-full w-full flex flex-col"
              onTouchStart={handleDrawerTouchStart}
              onTouchMove={handleDrawerTouchMove}
              onTouchEnd={handleDrawerTouchEnd}
              style={{
                backgroundColor: "var(--background)",
                color: "var(--navbar-text)",
                transform: `translateX(${mobileDrawerOffsetX}px)`,
                transition: isDraggingDrawer ? "none" : "transform 0.22s ease",
              }}
            >
              <div
                className="shrink-0 px-3 pt-3 pb-2 border-b"
                style={{ borderColor: "rgba(148,163,184,0.20)" }}
              >
                <button
                  type="button"
                  className="w-full flex items-center gap-3 px-3 py-3 rounded-xl transition"
                  style={{
                    border: "1px solid rgba(148,163,184,0.18)",
                    backgroundColor: "rgba(148,163,184,0.06)",
                    color: "var(--foreground)",
                  }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.backgroundColor = NAV_HOVER_BG)
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.backgroundColor = "rgba(148,163,184,0.06)")
                  }
                  onClick={() => {
                    setIsMobileNavOpen(false);
                    setMobileRagOpen(false);
                  }}
                  title="返回聊天頁"
                  aria-label="返回聊天頁"
                >
                  <i className="fa-solid fa-angle-left text-[16px] opacity-80" />
                  <span className="text-sm font-medium">返回聊天頁</span>
                </button>
              </div>
              <div
                className="px-4 pt-4 pb-3 border-b"
                style={{ borderColor: "rgba(148,163,184,0.20)" }}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h1 className="text-lg font-semibold tracking-wide">
                      GalaBone
                    </h1>
                  </div>
                  <button
                    type="button"
                    className="w-9 h-9 rounded-xl flex items-center justify-center transition"
                    style={{
                      border: "1px solid rgba(148,163,184,0.18)",
                      backgroundColor: "transparent",
                    }}
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.backgroundColor = NAV_HOVER_BG)
                    }
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.backgroundColor = "transparent")
                    }
                    onClick={() => {
                      setIsMobileNavOpen(false);
                      setMobileRagOpen(false);
                    }}
                    title="關閉導覽列"
                  >
                    <i className="fa-solid fa-xmark text-[14px] opacity-70" />
                  </button>
                </div>
              </div>

              <nav className="flex-1 min-h-0 overflow-y-auto px-3 pt-4 pb-4 text-sm">
                <div className="space-y-3">
                  <div className="space-y-1">
                    <SideRow
                      iconClass="fa-regular fa-message"
                      label="新對話"
                      onClick={() => {
                        newThread();
                        setIsMobileNavOpen(false);
                      }}
                    />

                    <SideRow
                      iconClass="fa-solid fa-folder-tree"
                      label="資源管理"
                      active={activeView === "assets"}
                      onClick={() => {
                        setActiveView("assets");
                        setIsMobileNavOpen(false);
                      }}
                    />

                    <SideRow
                      iconClass="fa-regular fa-clock"
                      label="對話紀錄"
                      active={isHistoryOpen}
                      onClick={() => {
                        setIsMobileNavOpen(false);
                        openHistory();
                      }}
                    />
                  </div>

                  <div className="px-2">
                    <div className="flex items-center gap-2 px-3 py-2 rounded-xl opacity-90">
                      <i className="fa-solid fa-diagram-project text-[13px] opacity-80" />
                      <div className="text-[13px] font-semibold">RAG 模式</div>
                    </div>

                    <div className="px-3 pb-1 text-[11px] opacity-55">
                      不會建立索引
                    </div>

                    <div className="relative" data-rag-dropdown-root>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setMobileRagOpen((v) => !v);
                        }}
                        className="w-full flex items-center justify-between rounded-xl px-3 py-2 text-[13px] border"
                        style={{
                          backgroundColor: "var(--background)",
                          borderColor: "rgba(148,163,184,0.22)",
                          color: "var(--foreground)",
                        }}
                      >                        <span className="truncate">
                          {ragMode === "file_then_vector" && "查詢上傳檔案與衛教智慧庫"}
                          {ragMode === "pubmed_only" && "查詢PubMed 美國國家醫學圖書館 NLM 開發的免費生醫文獻搜尋引擎"}
                          {ragMode === "soap_only" && "查詢已授權的輔大醫院之去識別化soap記錄"}
                        </span>

                        <i
                          className={`fa-solid fa-chevron-down text-[11px] opacity-60 transition ${mobileRagOpen ? "rotate-180" : ""}`}
                        />
                      </button>

                      {mobileRagOpen && (
                        <div
                          className="absolute z-50 mt-2 w-full rounded-xl border overflow-hidden"
                          style={{
                            backgroundColor: "var(--background)",
                            borderColor: "rgba(148,163,184,0.22)",
                            boxShadow: "0 12px 28px rgba(0,0,0,0.22)",
                          }}
                        >
                          {[
                            { value: "file_then_vector", label: "查詢上傳檔案與衛教智慧庫" },
                            { value: "pubmed_only", label: "查詢PubMed 美國國家醫學圖書館 NLM 開發的免費生醫文獻搜尋引擎" },
                            { value: "soap_only", label: "查詢已授權的輔大醫院之去識別化soap記錄" },
                          ].map((opt) => (
                            <button
                              key={opt.value}
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setRagMode(opt.value as RagMode);
                                setMobileRagOpen(false);
                              }}
                              className="w-full text-left px-3 py-2 text-[13px]"
                              style={{
                                backgroundColor:
                                  ragMode === opt.value ? NAV_ACTIVE_BG : "transparent",
                                color: "var(--foreground)",
                              }}
                            >
                              {opt.label}
                            </button>))}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="pt-2">
                    <div className="flex items-center justify-between px-1 mb-2">
                      <p className="text-[11px] tracking-wide opacity-60">
                        最近對話
                      </p>
                      <button
                        type="button"
                        className="text-[11px] opacity-60 hover:opacity-90 transition"
                        onClick={() => {
                          setIsMobileNavOpen(false);
                          openHistory();
                        }}
                      >
                        搜尋
                      </button>
                    </div>

                    <div className="space-y-1">
                      {historyThreads
                        .filter((t) => {
                          if (userMode === "member" && !isGuestUid(userId)) {
                            return !!t.id && !String(t.id).startsWith("t-");
                          }
                          return t.id === activeThreadId;
                        })
                        .slice(0, 8)
                        .map((t) => (
                          <SideThreadItem
                            key={t.id}
                            threadId={t.id}
                            title={t.title}
                            meta={formatThreadTime(t.updatedAt)}
                            active={activeThreadId === t.id}
                            onClick={() => {
                              loadThreadToMain(t.id);
                              setIsMobileNavOpen(false);
                            }}
                          />
                        ))}
                    </div>
                  </div>
                </div>
              </nav>              <div
                className="px-4 py-3 border-t"
                style={{ borderColor: "rgba(148,163,184,0.20)" }}
              >
                <button
                  type="button"
                  className="w-full flex items-center gap-2 text-[12px] opacity-75 hover:opacity-100 transition"
                >
                  <i className="fa-solid fa-gear text-[12px] opacity-80" />
                  <span>設定</span>
                </button>
              </div>
            </aside>
          </div>
        </div>
      )
      }

      {/* Main */}
      <div className="flex-1 min-h-0 flex flex-col px-6 py-6 gap-4 overflow-hidden llm-main-shell">
        {activeView === "assets" ? (
          <PlaceholderView title="資源管理" />
        ) : (
          <section className="flex-1 min-h-0 flex flex-col relative">
            <div className="flex items-center justify-between mb-2 text-xs opacity-70 px-1" />

            <div
              className="chat-scroll flex-1 min-h-0 overflow-y-auto text-sm break-words"
              style={{ paddingBottom: inputBoxHeight + 40 }}
            >
              <div className="w-full flex justify-center">
                <div className="w-full max-w-3xl pr-1">
                  {seedImageUrl && (
                    <DetectionViewer
                      imageUrl={seedImageUrl}
                      detections={seedDetections}
                    />
                  )}

                  {messages.map((msg) => {
                    const isUser = msg.role === "user";
                    return (
                      <div key={msg.id} className="mb-4">
                        <div
                          className={`flex ${isUser ? "justify-end" : "justify-start"
                            }`}
                        >
                          <div className="flex flex-col items-stretch max-w-[min(70%,60ch)]">
                            <div
                              className="whitespace-pre-wrap break-words leading-relaxed px-4 py-3 rounded-2xl"
                              style={{
                                backgroundColor: isUser
                                  ? "var(--chat-user-bg)"
                                  : "var(--chat-assistant-bg)",
                                color: isUser
                                  ? "var(--chat-user-text)"
                                  : "var(--chat-assistant-text)",
                                wordBreak: "break-word",
                              }}
                            >
                              {msg.content}
                              {!isUser && renderResources(msg.resources)}
                            </div>
                            {renderMessageFiles(msg.files)}
                          </div>
                        </div>
                      </div>
                    );
                  })}

                  {loading && (
                    <div className="flex justify-start mb-4">
                      <div
                        className="text-xs px-4 py-2 max-w-[min(70%,60ch)] rounded-2xl"
                        style={{
                          backgroundColor: "var(--chat-assistant-bg)",
                          color: "var(--chat-assistant-text)",
                          wordBreak: "break-word",
                        }}
                      >
                        正在思考中…
                      </div>
                    </div>
                  )}

                  <div ref={chatEndRef} />
                </div>
              </div>
            </div>

            <div
              className="sticky bottom-0 left-0 right-0 pt-3 pb-4 transition-colors duration-500"
              style={{ backgroundColor: "var(--background)" }}
            >
              <form onSubmit={sendMessage}>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={handleFileChange}
                />

                <div className="w-full flex justify-center">
                  <div className="w-full max-w-3xl">
                    <div className="flex items-end gap-3 w-full">
                      <div className="flex-1 relative">
                        <div
                          className={`relative border px-4 py-2 shadow-lg backdrop-blur-sm ${isExpanded ? "rounded-2xl" : "rounded-full"
                            } transition-colors duration-500 neon-shell`}
                          style={{
                            backgroundColor: "var(--navbar-bg)",
                            borderColor: "var(--navbar-border)",
                            color: "var(--foreground)",
                          }}
                          data-tool-menu-root
                        >
                          {showToolMenu && <ToolMenu />}

                          <div className="flex flex-col gap-2">
                            {pendingFiles.length > 0 && (
                              <div className="flex flex-wrap gap-2 text-[11px]">
                                {pendingFiles.map((file) => (
                                  <div
                                    key={file.id}
                                    className="flex items-center gap-2 px-2 py-1 rounded-full border bg-black/5"
                                    style={{
                                      borderColor: "rgba(148,163,184,0.35)",
                                    }}
                                  >
                                    <i className="fa-regular fa-file text-[10px]" />
                                    <span className="max-w-[160px] truncate">
                                      {file.name}
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => removePendingFile(file.id)}
                                      className="text-[10px] opacity-70 hover:opacity-100"
                                    >
                                      ✕
                                    </button>
                                  </div>
                                ))}
                              </div>
                            )}

                            <div className={isExpanded ? "" : "flex items-center gap-3"}>
                              {!isExpanded && (
                                <div className="flex items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() => setShowToolMenu((v) => !v)}
                                    className="flex items-center gap-1 text-xs"
                                    style={{
                                      backgroundColor: "transparent",
                                      color: "var(--foreground)",
                                    }}
                                  >
                                    <i className="fa-solid fa-sliders text-[11px] opacity-75" />
                                    <span>工具</span>
                                    <span className="text-[10px]">
                                      {showToolMenu ? "▴" : "▾"}
                                    </span>
                                  </button>
                                </div>
                              )}

                              <textarea
                                ref={inputRef}
                                value={draftText}
                                onChange={(e) => {
                                  setDraftText(e.target.value);
                                  requestAnimationFrame(() => autoResizeTextarea());
                                }}
                                onKeyDown={handleKeyDown}
                                placeholder="提出任何問題⋯"
                                rows={1}
                                className={`custom-scroll bg-transparent resize-none border-none outline-none text-sm leading-relaxed overflow-hidden placeholder:text-slate-500 ${isExpanded ? "w-full" : "flex-1"
                                  }`}
                                style={{
                                  color: "var(--foreground)",
                                  caretColor: "var(--foreground)",
                                }}
                                autoComplete="off"
                                autoCorrect="off"
                                spellCheck={false}
                              />

                              {!isExpanded && (
                                <div className="flex items-center gap-3">
                                  <span className="text-[10px] text-emerald-400">●</span>
                                  <button
                                    type="submit"
                                    disabled={
                                      ((!draftText.trim() && pendingFiles.length === 0) ||
                                        loading)
                                    }
                                    className="h-7 w-7 rounded-full flex items-center justify-center text-white text-sm font-semibold disabled:opacity-60"
                                    style={{
                                      background:
                                        "linear-gradient(135deg,#0ea5e9,#22c55e)",
                                      boxShadow:
                                        "0 10px 25px rgba(56,189,248,0.45)",
                                    }}
                                  >
                                    {loading ? (
                                      "…"
                                    ) : (
                                      <i className="fa-solid fa-arrow-up text-[13px]" />
                                    )}
                                  </button>
                                </div>
                              )}
                            </div>

                            {isExpanded && (
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() => setShowToolMenu((v) => !v)}
                                    className="flex items-center gap-1 text-xs"
                                    style={{
                                      backgroundColor: "transparent",
                                      color: "var(--foreground)",
                                    }}
                                  >
                                    <i className="fa-solid fa-sliders text-[11px] opacity-75" />
                                    <span>工具</span>
                                    <span className="text-[10px]">
                                      {showToolMenu ? "▴" : "▾"}
                                    </span>
                                  </button>
                                </div>

                                <div className="flex items-center gap-3">
                                  <span className="text-[10px] text-emerald-400">●</span>
                                  <button
                                    type="submit"
                                    disabled={
                                      ((!draftText.trim() && pendingFiles.length === 0) ||
                                        loading)
                                    }
                                    className="h-7 w-7 rounded-full flex items-center justify-center text-white text-sm font-semibold disabled:opacity-60"
                                    style={{
                                      background:
                                        "linear-gradient(135deg,#0ea5e9,#22c55e)",
                                      boxShadow:
                                        "0 10px 25px rgba(56,189,248,0.45)",
                                    }}
                                  >
                                    {loading ? (
                                      "…"
                                    ) : (
                                      <i className="fa-solid fa-arrow-up text-[13px]" />
                                    )}
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>

                      </div>
                    </div>
                  </div>
                </div>
              </form>
            </div>
          </section>
        )}
        <S2SensitiveInfoModal
          open={showSensitiveModal}
          hits={sensitiveHits}
          onClose={() => setShowSensitiveModal(false)}
          onSendWithoutMask={handleSendWithoutMask}
          onMaskAndSend={handleMaskAndSend}
        />
      </div>
    </div >
  );
}

export default function Page() {
  return (
    <Suspense fallback={<div className="p-6 text-white/70">Loading…</div>}>
      <LLMClient />
    </Suspense>
  );
}

