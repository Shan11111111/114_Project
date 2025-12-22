"use client";

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
  memo,
} from "react";

type UploadedFile = {
  id: string;
  name: string;
  size: number;
  type: number | string;
  url: string;
  raw?: File; //真正要上傳的 File
  serverUrl?: string; //新增：後端回來的 url（如果你要記）
};

type ChatMessage = {
  id: number;
  role: "user" | "assistant";
  content: string;
  files?: UploadedFile[];
};

type ViewKey = "llm" | "assets";

type HistoryThread = {
  id: string;
  title: string;
  updatedAt: string;
  preview: string;
  messageCount: number;
  sessionId?: string; // ✅ 新增：不顯示，只用於繼續聊天
};

type HistoryMessage = {
  id: string;
  threadId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
};

type RagMode = "file_then_vector" | "vector_only" | "file_only";

/** ✅ S1 bootstrap detections（支援 bbox / poly / PolyJson / P1~P4） */
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

const WELCOME_TEXT = `嗨，我是 GalaBone LLM。

你可以直接問，我會用你已建好的向量資料庫做 RAG，並盡量附上來源。

依據：本次未提供可追溯來源
（你可以要求後端「必回傳 sources/citations」才算合格 RAG。）`;

// ==============================
// ✅ 後端 API（搬 C 的連線；不影響 D 的 UI）
// ==============================
const API_BASE = (
  process.env.NEXT_PUBLIC_BACKEND_URL ||
  process.env.NEXT_PUBLIC_API_BASE ||
  "http://127.0.0.1:8000"
).replace(/\/+$/, "");

const S2X_BASE = `${API_BASE}/s2x`;

// ✅ C 裡的 bootstrap（S1 -> S2）
const BOOT_URL = `${API_BASE}/s2/agent/bootstrap-from-s1`;

// ✅ C 裡集中管理的 API endpoints（conversations 也一起帶過來）
const API = {
  health: `${S2X_BASE}/health`,
  upload: `${S2X_BASE}/upload`,
  chat: `${S2X_BASE}/agent/chat`,
  exportPdf: `${S2X_BASE}/export/pdf`,
  exportPptx: `${S2X_BASE}/export/pptx`,
  listConvs: (uid: string) =>
    `${S2X_BASE}/agent/conversations?user_id=${encodeURIComponent(uid)}`,
  getMsgs: (cid: string) => `${S2X_BASE}/agent/conversations/${cid}/messages`,
};

function safeJsonParse(raw: string) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function toAbsUrl(maybeUrl?: string) {
  if (!maybeUrl) return "";
  if (maybeUrl.startsWith("http://") || maybeUrl.startsWith("https://"))
    return maybeUrl;

  const path = maybeUrl.startsWith("/") ? maybeUrl : `/${maybeUrl}`;
  // 常見：後端回傳 /uploads/xxx
  if (path.startsWith("/uploads/")) return `${API_BASE}/s2x${path}`;
  return `${API_BASE}${path}`;
}

async function uploadOneFileToBackend(file: File) {
  const fd = new FormData();
  fd.append("file", file);

  const res = await fetch(API.upload, { method: "POST", body: fd });
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
    headers: { "Content-Type": "application/json" },
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

// ✅ export：沿用 D 現在的 UI，但 endpoint 改用 C 的 API.exportPdf/exportPptx
async function exportToBackend(
  type: "pdf" | "pptx",
  payload: { session_id: string; user_id: string; messages: any[] }
) {
  const url = type === "pdf" ? API.exportPdf : API.exportPptx;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const raw = await res.text().catch(() => "");
    throw new Error(`匯出失敗 ${res.status}：${raw.slice(0, 300)}`);
  }

  return await res.blob();
}

// ==============================
// ✅ LocalStorage 快取（方案 A）
// ==============================
const LS_NS = "gab_llm_v1";

function lsKey(uid: string) {
  const safe = (uid || "guest").trim() || "guest";
  return `${LS_NS}::${safe}`;
}

function lsRead(uid: string): any | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(lsKey(uid));
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function lsWrite(uid: string, value: any) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(lsKey(uid), JSON.stringify(value));
  } catch {
    // ignore quota / privacy mode
  }
}

function lsSafeNow() {
  try {
    return new Date().toLocaleString();
  } catch {
    return "";
  }
}

function getUserIdFromLS() {
  if (typeof window === "undefined") return "guest";
  try {
    const KEY = "tmp_user_id";
    const existing = localStorage.getItem(KEY);
    if (existing && existing.trim()) return existing.trim();

    const uid =
      typeof crypto !== "undefined" &&
      "randomUUID" in crypto &&
      typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `tmp-${Date.now()}-${Math.random().toString(16).slice(2)}`;

    localStorage.setItem(KEY, uid);
    return uid;
  } catch {
    return "guest";
  }
}

// ==============================
// ✅ Detection Viewer（最小侵入：只加一張卡片，不動你現有聊天 UI）
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
      .map((p) => [p[0] as number, p[1] as number]);
    if (pts.length >= 4) return pts;
  }

  const pj = (d as any).polyJson ?? d.PolyJson;
  if (typeof pj === "string" && pj.trim()) {
    const obj = safeJsonParse(pj.trim());
    if (Array.isArray(obj) && obj.length >= 4) {
      const pts = obj
        .map((p: any) => [toNum(p?.[0]), toNum(p?.[1])] as any)
        .filter((p) => p[0] !== null && p[1] !== null)
        .map((p) => [p[0] as number, p[1] as number]);
      if (pts.length >= 4) return pts;
    }
    if (obj && Array.isArray(obj.poly) && obj.poly.length >= 4) {
      const pts = obj.poly
        .map((p: any) => [toNum(p?.[0]), toNum(p?.[1])] as any)
        .filter((p) => p[0] !== null && p[1] !== null)
        .map((p) => [p[0] as number, p[1] as number]);
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
                      xmlns="http://www.w3.org/1999/xhtml"
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
// ✅ GPT-style「⋯」選單（分享/刪除）
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
    function onDown(e: MouseEvent) {
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
// ✅ HistoryOverlay（原樣保留）
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

  return (
    <div className="fixed inset-0 z-[60]">
      <div
        className="absolute inset-0"
        style={{ backgroundColor: "rgba(0,0,0,0.35)" }}
        onClick={onClose}
      />

      <div className="absolute inset-0 flex items-start justify-center p-3 md:p-6">
        <div
          className="w-full max-w-5xl h-[88vh] md:h-[82vh] rounded-2xl border overflow-hidden shadow-2xl flex flex-col"
          style={{
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

          <div className="flex-1 min-h-0 grid grid-cols-12 gap-4 p-4">
            <div
              className="col-span-12 md:col-span-4 min-h-0 rounded-2xl border overflow-hidden flex flex-col"
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
                      <button
                        type="button"
                        key={t.id}
                        tabIndex={-1}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => onSelectThread(t.id)}
                        className="w-full text-left px-3 py-1.5 rounded-lg transition mb-1"
                        style={{
                          backgroundColor: active
                            ? NAV_ACTIVE_BG
                            : "transparent",
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
                        <div className="flex items-center justify-between gap-1">
                          <div className="text-sm font-medium truncate">
                            {t.title}
                          </div>

                          <ThreadMoreMenu
                            threadId={t.id}
                            NAV_HOVER_BG={NAV_HOVER_BG}
                            onShare={() => onShareThread(t.id)}
                            onDelete={() => onDeleteThread(t.id)}
                          />
                        </div>

                        <div className="text-[12px] opacity-70 mt-1 line-clamp-1">
                          {t.preview}
                        </div>
                        <div className="text-[11px] opacity-50 mt-2">
                          {t.messageCount} 則訊息
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>

            <div
              className="col-span-12 md:col-span-8 min-h-0 rounded-2xl border overflow-hidden flex flex-col"
              style={{ borderColor: "rgba(148,163,184,0.20)" }}
            >
              <div
                className="px-4 py-3 border-b flex items-center justify-between"
                style={{ borderColor: "rgba(148,163,184,0.20)" }}
              >
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] opacity-60 mb-0.5">
                    {currentThread?.updatedAt || ""}
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
                <div className="flex items-center gap-2">
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
                        className={`flex ${
                          isUser ? "justify-end" : "justify-start"
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

export default function LLMPage() {
  const searchParams = useSearchParams();
  const router = useRouter();

  // ✅✅ 改動 1：由 boolean 改成記錄最後 boot 的 caseId（避免重複 boot）
  const bootOnceRef = useRef<string>("");

  // ✅ seed card（不動原排版：只在聊天區最上方插一張卡）
  const [seedImageUrl, setSeedImageUrl] = useState<string>("");
  const [seedDetections, setSeedDetections] = useState<Detection[]>([]);

  // ===== navbar 狀態 =====
  const [isNavCollapsed, setIsNavCollapsed] = useState(false);
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);

  // ✅ 目前頁面
  const [activeView, setActiveView] = useState<ViewKey>("llm");

  // ✅ RAG 模式（沿用 pasted.txt：不建立索引）
  const [ragMode, setRagMode] = useState<RagMode>("file_then_vector");

  // ✅ History overlay
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);

  // ✅ 搜尋字詞持久化（不觸發 rerender）
  const historyPersistedQueryRef = useRef<string>("");

  // ===== chat 狀態 =====
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 1,
      role: "assistant",
      content: WELCOME_TEXT,
    },
  ]);

  // ✅ 主輸入框：受控（中文/英文）
  const [draftText, setDraftText] = useState("");

  const [loading, setLoading] = useState(false);
  const [showToolMenu, setShowToolMenu] = useState(false);

  const [pendingFiles, setPendingFiles] = useState<UploadedFile[]>([]);

  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const baseHeightRef = useRef<number | null>(null);
  const [isMultiLine, setIsMultiLine] = useState(false);
  const [inputBoxHeight, setInputBoxHeight] = useState(MIN_HEIGHT);

  const isExpanded = isMultiLine || pendingFiles.length > 0;

  const [ragOpen, setRagOpen] = useState(false);

  // ✅ thread清單  聊天紀錄
  const [historyThreads, setHistoryThreads] = useState<HistoryThread[]>([]);
  const [historyMessages, setHistoryMessages] = useState<HistoryMessage[]>([]);

  // ✅✅ 改動：不要用 t-001 當預設，避免一直送到假 thread
  const [activeThreadId, setActiveThreadId] = useState<string>("");

  const activeThreadIdRef = useRef<string>(activeThreadId);
  useEffect(() => {
    activeThreadIdRef.current = activeThreadId;
  }, [activeThreadId]);

  const [sessionId, setSessionId] = useState<string>("");

  // ✅✅ 重要：避免初始化階段直接碰 localStorage/crypto（防空白/奇怪錯）
  const [userId, setUserId] = useState<string>("guest");

  // ✅ 統一 hover/active 顏色
  const NAV_ACTIVE_BG = "rgba(148,163,184,0.16)";
  const NAV_HOVER_BG = "rgba(148,163,184,0.10)";

  // ==============================
  // ✅ LocalStorage：初始化載入 + 持久化
  // ==============================
  const didHydrateRef = useRef(false);

  useEffect(() => {
    // 1) 先確定 userId
    const uid = getUserIdFromLS();
    setUserId(uid);

    // 2) 載入快取
    const cached = lsRead(uid);
    if (cached && typeof cached === "object") {
      // 這裡只載入「不影響 UI」的資料
      const cRag: RagMode | undefined = cached.ragMode;
      const cThreads: HistoryThread[] | undefined = cached.historyThreads;
      const cMsgs: HistoryMessage[] | undefined = cached.historyMessages;
      const cActive: string | undefined = cached.activeThreadId;
      const cSession: string | undefined = cached.sessionId;
      const cMain: ChatMessage[] | undefined = cached.messages;

      if (cRag) setRagMode(cRag);
      if (Array.isArray(cThreads)) setHistoryThreads(cThreads);
      if (Array.isArray(cMsgs)) setHistoryMessages(cMsgs);

      if (typeof cSession === "string") setSessionId(cSession);

      // 主畫面訊息（刷新不消失的重點）
      if (Array.isArray(cMain) && cMain.length > 0) {
        // 避免 pendingFiles 的 blob URL 被存進去（只保留純文本 + serverUrl）
        const safeMain = cMain.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          files: Array.isArray(m.files)
            ? m.files.map((f) => ({
                id: f.id,
                name: f.name,
                size: f.size,
                type: f.type,
                // 注意：如果是本地 blob:，刷新會失效；只保留 serverUrl 或 http(s)
                url:
                  (f.serverUrl && f.serverUrl.startsWith("http"))
                    ? f.serverUrl
                    : (f.url && (f.url.startsWith("http") || f.url.startsWith("/")))
                    ? f.url
                    : "",
                serverUrl: f.serverUrl,
              }))
            : undefined,
        }));
        setMessages(safeMain);
      }

      if (typeof cActive === "string") setActiveThreadId(cActive);
    }

    didHydrateRef.current = true;
  }, []);

  useEffect(() => {
    if (!didHydrateRef.current) return;
    const uid = (userId || "guest").trim() || "guest";

    // 不存 pendingFiles（blob）+ 不存 seed 圖（可能很大/也可能是臨時）
    const payload = {
      version: 1,
      savedAt: lsSafeNow(),
      userId: uid,
      ragMode,
      sessionId,
      activeThreadId,
      historyThreads,
      historyMessages,
      messages,
    };

    lsWrite(uid, payload);
  }, [
    userId,
    ragMode,
    sessionId,
    activeThreadId,
    historyThreads,
    historyMessages,
    messages,
  ]);

  // ✅✅ 新增：reset seed + 清除 URL 的 caseId（不動 UI）
  function resetSeedAndCaseIdInUrl() {
    bootOnceRef.current = "";
    setSeedImageUrl("");
    setSeedDetections([]);

    const hasCase =
      !!searchParams.get("caseId") ||
      !!searchParams.get("caseld") ||
      !!searchParams.get("caseid");

    if (hasCase) {
      router.replace("/llm"); // 只改 URL，不改 UI
    }
  }

  // ✅ rename：只更新 title（最小改動）
  function renameThread(threadId: string, nextTitle: string) {
    const title = nextTitle.trim();
    if (!title) return;

    setHistoryThreads((prev) =>
      prev.map((t) => (t.id === threadId ? { ...t, title } : t))
    );
  }

  function deleteThread(threadId: string) {
    if (!confirm("確定要刪除這個對話嗎？")) return;

    setHistoryThreads((prev) => {
      const next = prev.filter((t) => t.id !== threadId);

      if (activeThreadIdRef.current === threadId) {
        const fallbackId = next[0]?.id ?? "";
        setActiveThreadId(fallbackId);

        if (fallbackId) {
          loadThreadToMain(fallbackId);
        } else {
          newThread();
        }
      }

      return next;
    });

    // 也把 messages 清掉（避免 UI 顯示已刪除 thread 的訊息）
    setHistoryMessages((prev) => prev.filter((m) => m.threadId !== threadId));
  }

  function shareThread(threadId: string) {
    const url = `${location.origin}/llm?thread=${encodeURIComponent(threadId)}`;
    navigator.clipboard.writeText(url);
    alert("已複製分享連結");
  }

  async function apiFetchConversations(uid: string) {
    const res = await fetch(API.listConvs(uid), { method: "GET" });
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
        id: String(c.id ?? c.conversation_id ?? c.conversationId ?? ""),
        title: String(c.title ?? c.name ?? "未命名對話"),
        updatedAt: String(
          c.updatedAt ?? c.updated_at ?? c.createdAt ?? c.created_at ?? ""
        ),
        preview: String(c.preview ?? c.last_message ?? ""),
        messageCount: Number(c.messageCount ?? c.message_count ?? 0),
        sessionId: String(c.session_id ?? c.sessionId ?? ""),
      }))
      .filter((t: any) => t.id);
  }

  async function apiCreateConversation(uid: string) {
    const res = await fetch(`${S2X_BASE}/agent/conversations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: uid, title: "新對話" }),
    });

    const raw = await res.text();
    const data = safeJsonParse(raw);
    if (!res.ok || !data) {
      throw new Error(
        `createConversation 失敗 ${res.status}: ${raw.slice(0, 200)}`
      );
    }
    return data as {
      conversation_id: string;
      session_id?: string;
      title?: string;
    };
  }

  async function fetchConversationMessages(cid: string) {
    const res = await fetch(API.getMsgs(cid), { method: "GET" });
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

    const mapped: HistoryMessage[] = items.map((m: any, idx: number) => ({
      id: String(m.id ?? `${cid}-${idx}`),
      threadId: cid,
      role: m.role === "assistant" ? "assistant" : "user",
      content: String(m.content ?? m.message ?? ""),
      createdAt: String(m.createdAt ?? m.created_at ?? m.time ?? ""),
    }));

    return mapped;
  }

  function buildChatMessagesFromThread(threadId: string): ChatMessage[] {
    const threadMsgs = historyMessages
      .filter((m) => m.threadId === threadId)
      .map((m, idx) => ({
        id: Date.now() + idx,
        role: m.role,
        content: m.content,
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

  function loadThreadToMain(threadId: string) {
    resetSeedAndCaseIdInUrl(); // ✅ 切對話也清掉 seed / caseId

    const t = historyThreads.find((x) => x.id === threadId);
    if (t?.sessionId) setSessionId(t.sessionId);

    setActiveThreadId(threadId);
    setActiveView("llm");
    setMessages(buildChatMessagesFromThread(threadId));
    resetMainInputBox();

    setPendingFiles((prev) => {
      prev.forEach((f) => URL.revokeObjectURL(f.url));
      return [];
    });

    setIsHistoryOpen(false);
    setTimeout(() => inputRef.current?.focus(), 60);
  }

  function nowText() {
    return new Date().toLocaleString();
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

  // ✅✅ 新增：自動把「新對話」改成第一句（像 GPT）
  function maybeAutoTitle(threadId: string, userText: string) {
    const title = (userText || "").trim().replace(/\s+/g, " ");
    if (!title) return;

    setHistoryThreads((prev) => {
      const idx = prev.findIndex((t) => t.id === threadId);
      if (idx < 0) return prev;

      const t = prev[idx];
      if ((t.title || "").trim() !== "新對話") return prev; // 避免蓋掉你手動改名

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
        const merged: HistoryThread = {
          ...withoutOld[existingIdx],
          ...(old || {}),
          id: newId,
          sessionId:
            sessionIdMaybe ??
            withoutOld[existingIdx].sessionId ??
            old?.sessionId,
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

    // ✅ 歷史訊息也把 threadId 一起換掉（不然切換會空）
    setHistoryMessages((prev) =>
      prev.map((m) => (m.threadId === oldId ? { ...m, threadId: newId } : m))
    );

    setActiveThreadId(newId);
  }

  async function newThread() {
    resetSeedAndCaseIdInUrl(); // ✅ 新對話就不該保留 seed / caseId

    const uid = (userId || "guest").trim() || "guest";

    const localThreadId = `t-${Date.now()}`;
    const localSessionId = `${uid}::${
      // @ts-ignore
      crypto?.randomUUID?.() ?? `tmp-${Date.now()}`
    }`;

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
      prev.forEach((f) => URL.revokeObjectURL(f.url));
      return [];
    });

    setIsHistoryOpen(false);
    setTimeout(() => inputRef.current?.focus(), 60);

    try {
      const created = await apiCreateConversation(uid);
      const realId = String(created.conversation_id || "");
      const realSession = String(created.session_id || "");

      if (realId) {
        replaceThreadId(localThreadId, realId, realSession || localSessionId);
      } else if (realSession) {
        setSessionId(realSession);
        ensureThreadExists(localThreadId, { sessionId: realSession });
      }
    } catch {
      // 後端沒好：維持本地即可
    }
  }

  const bootNewThreadOnceRef = useRef(false);
  useEffect(() => {
    if (bootNewThreadOnceRef.current) return;
    bootNewThreadOnceRef.current = true;

    if (!activeThreadIdRef.current) {
      newThread();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    function onDown(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (!target.closest("[data-tool-menu-root]")) setShowToolMenu(false);
      if (!target.closest("[data-rag-dropdown-root]")) setRagOpen(false);
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
      const t = prev.find((f) => f.id === id);
      if (t) URL.revokeObjectURL(t.url);
      return prev.filter((f) => f.id !== id);
    });
  }

  async function sendMessage(e?: FormEvent) {
    if (e) e.preventDefault();

    const text = draftText.trim();
    if ((!text && pendingFiles.length === 0) || loading) return;

    const threadIdAtSend = activeThreadIdRef.current;

    const userMessage: ChatMessage = {
      id: Date.now(),
      role: "user",
      content: text,
      files: pendingFiles.length ? pendingFiles : undefined,
    };

    setMessages((prev) => [...prev, userMessage]);
    bumpThreadOnMessage(threadIdAtSend, text || "（已上傳檔案）", 1);
    maybeAutoTitle(threadIdAtSend, text || "（已上傳檔案）"); // ✅ 自動標題

    const filesToUpload = pendingFiles.slice();

    resetMainInputBox();

    setPendingFiles((prev) => {
      prev.forEach((f) => URL.revokeObjectURL(f.url));
      return [];
    });

    setLoading(true);

    try {
      if (!API_BASE) {
        const answerText = fakeLLMReply(text || "（已上傳檔案）");
        const botMessage: ChatMessage = {
          id: Date.now() + 1,
          role: "assistant",
          content: answerText,
        };
        setMessages((prev) => [...prev, botMessage]);
        bumpThreadOnMessage(threadIdAtSend, String(answerText).slice(0, 80), 1);

        setLoading(false);
        return;
      }

      const wantFile = ragMode !== "vector_only";
      const wantVector = ragMode !== "file_only";

      let fileContextText = "";
      if (wantFile) {
        for (const f of filesToUpload) {
          if (!f.raw) continue;

          const up = await uploadOneFileToBackend(f.raw);

          const fn = String(up?.filename ?? up?.name ?? f.name);
          const summary = String(up?.summary ?? "");
          const txt = String(up?.text ?? "");
          const urlRel = String(up?.legacy_url ?? up?.url ?? up?.path ?? "");
          const abs = toAbsUrl(urlRel);

          f.serverUrl = abs || urlRel;

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
      }

      const vectorHint = wantVector
        ? `\n\n---\n【RAG】請先用既有教材向量庫檢索後回答，並附 sources/citations（檔名/頁碼或chunk/score）。找不到就說找不到。`
        : "";

      const uid = (userId || "guest").trim() || "guest";
      const sid =
        (sessionId || "").trim() ||
        `${uid}::${(threadIdAtSend || `t-${Date.now()}`).trim()}`;

      const basePrompt =
        (text ? text : "（已上傳檔案，請根據檔案內容協助）") +
        (wantFile && fileContextText ? `\n\n${fileContextText}` : "") +
        vectorHint;

      const payload = {
        session_id: sid,
        user_id: uid,
        conversation_id: threadIdAtSend,
        messages: [{ role: "user", type: "text", content: basePrompt }],
      };

      const data = await postChatToBackend(payload);

      const cid = String(data?.conversation_id ?? "");
      const sidFromServer = String(data?.session_id ?? "");

      if (sidFromServer) setSessionId(sidFromServer);

      if (cid) {
        replaceThreadId(threadIdAtSend, cid, sidFromServer || sessionId);
      }

      let answerText = "";
      if (data?.answer || data?.content || data?.message) {
        answerText = String(data.answer ?? data.content ?? data.message);
      } else {
        answerText =
          String(
            data?.reply ??
              (Array.isArray(data?.messages)
                ? [...data.messages]
                    .reverse()
                    .find((m: any) => m?.role === "assistant")?.content ??
                  data.messages[data.messages.length - 1]?.content ??
                  ""
                : "")
          ) ||
          (typeof data === "string" ? data : "") ||
          `⚠️ chat 回傳格式看不懂：${JSON.stringify(data).slice(0, 200)}`;
      }

      const botMessage: ChatMessage = {
        id: Date.now() + 1,
        role: "assistant",
        content: String(answerText),
      };

      setMessages((prev) => [...prev, botMessage]);

      bumpThreadOnMessage(
        activeThreadIdRef.current || threadIdAtSend,
        String(answerText).slice(0, 80),
        1
      );
    } catch (err: any) {
      const msg = `⚠️ 後端呼叫失敗：${err?.message ?? String(err)}`;

      setMessages((prev) => [
        ...prev,
        {
          id: Date.now() + 2,
          role: "assistant",
          content: msg,
        },
      ]);

      bumpThreadOnMessage(activeThreadIdRef.current || threadIdAtSend, msg, 1);
    } finally {
      setLoading(false);
    }
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

  async function handleExport(type: "pdf" | "ppt") {
    setShowToolMenu(false);

    try {
      if (!messages.length) {
        alert("目前沒有可匯出的內容");
        return;
      }
      if (!API_BASE) {
        alert("尚未設定 NEXT_PUBLIC_BACKEND_URL，無法匯出");
        return;
      }

      const payload = {
        session_id: (sessionId || "").trim(),
        user_id: (userId || "guest").trim(),
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
          onClick={() => handleExport("ppt")}
        />
      </div>
    );
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
                  src={file.url}
                  alt={file.name}
                  className="w-8 h-8 object-cover rounded-lg"
                />
              ) : (
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
      <button
        type="button"
        onClick={onClick}
        className="w-full text-left px-3 py-1.5 rounded-lg transition"
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
          <div className="text-[13px] font-medium truncate">{title}</div>

          <div className="shrink-0">
            <ThreadMoreMenu
              threadId={threadId}
              NAV_HOVER_BG={NAV_HOVER_BG}
              onShare={() => shareThread(threadId)}
              onDelete={() => deleteThread(threadId)}
            />
          </div>
        </div>
      </button>
    );
  }

  async function openHistory() {
    try {
      const uid = userId || "guest";
      const threads = await apiFetchConversations(uid);

      // ✅ 不覆蓋本地：合併（避免刷新後本地快取被清空）
      setHistoryThreads((prev) => {
        const map = new Map<string, HistoryThread>();
        for (const t of prev) map.set(t.id, t);
        for (const t of threads) map.set(t.id, { ...map.get(t.id), ...t });
        return Array.from(map.values()).sort((a, b) =>
          String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""))
        );
      });

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
  // ✅✅ Bootstrap-from-S1（保持你原邏輯；但 seed 只有帶 caseId 才出現）
  // =========================
  useEffect(() => {
    const caseIdStr =
      searchParams.get("caseId") ??
      searchParams.get("caseld") ??
      searchParams.get("caseid") ??
      "";

    if (!caseIdStr) {
      bootOnceRef.current = "";
      setSeedImageUrl("");
      setSeedDetections([]);
      return;
    }

    if (bootOnceRef.current === caseIdStr) return;
    bootOnceRef.current = caseIdStr;

    const caseId = Number(caseIdStr);
    if (!Number.isFinite(caseId) || caseId <= 0) return;

    if (typeof window !== "undefined") {
      localStorage.setItem("gab_last_case_id", String(caseIdStr));
    }

    const ensureThreadIdForBoot = () => {
      if (activeThreadIdRef.current) return activeThreadIdRef.current;

      const uid = (userId || "guest").trim() || "guest";
      const localThreadId = `t-${Date.now()}`;
      const localSessionId = `${uid}::${
        // @ts-ignore
        crypto?.randomUUID?.() ?? `tmp-${Date.now()}`
      }`;

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

      return localThreadId;
    };

    const threadIdAtBoot = ensureThreadIdForBoot();

    (async () => {
      try {
        const r = await fetch(BOOT_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image_case_id: caseId }),
        });

        const raw = await r.text();
        const data = safeJsonParse(raw);

        if (!r.ok || !data) {
          throw new Error(`bootstrap 失敗 ${r.status}：${raw.slice(0, 250)}`);
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
        bumpThreadOnMessage(threadIdAtBoot, String(question).slice(0, 80), 1);
        maybeAutoTitle(threadIdAtBoot, question); // ✅ bootstrap 的第一句也會自動標題

        const payload = {
          session_id: (bootSession || sessionId || "").trim(),
          user_id: (userId || "guest").trim(),
          conversation_id: threadIdAtBoot,
          messages: [{ role: "user", type: "text", content: question }],
        };

        const resp = await postChatToBackend(payload);

        const cid = String(resp?.conversation_id ?? "");
        const sidFromServer = String(resp?.session_id ?? "");
        if (sidFromServer) setSessionId(sidFromServer);

        if (cid) {
          replaceThreadId(threadIdAtBoot, cid, sidFromServer || bootSession);
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

        setMessages((prev) => [
          ...prev,
          {
            id: Date.now() + 1,
            role: "assistant",
            content: String(answerText),
          },
        ]);

        bumpThreadOnMessage(
          activeThreadIdRef.current || threadIdAtBoot,
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
          },
        ]);
        bumpThreadOnMessage(activeThreadIdRef.current || threadIdAtBoot, msg, 1);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // =========================
  // ✅ 下面 return UI：完全不動（你原本的 JSX 그대로）
  // =========================
  return (
    <div
      className="h-[calc(100vh-4rem)] flex overflow-hidden transition-colors duration-500 relative"
      style={{
        backgroundColor: "var(--background)",
        color: "var(--foreground)",
      }}
    >
      <HistoryOverlay
        isOpen={isHistoryOpen}
        onClose={() => setIsHistoryOpen(false)}
        historyThreads={historyThreads}
        historyMessages={historyMessages}
        activeThreadId={activeThreadId}
        onSelectThread={async (id) => {
          setActiveThreadId(id);
          try {
            const msgs = await fetchConversationMessages(id);

            setHistoryMessages((prev) => {
              const withoutThis = prev.filter((m) => m.threadId !== id);
              return [...withoutThis, ...msgs];
            });
          } catch (e: any) {
            console.error(e);
            alert(e?.message || "讀取對話內容失敗");
          }
        }}
        onLoadThreadToMain={(id) => loadThreadToMain(id)}
        onNewThread={() => newThread()}
        onRenameThread={renameThread}
        onDeleteThread={deleteThread}
        onShareThread={shareThread}
        NAV_ACTIVE_BG={NAV_ACTIVE_BG}
        NAV_HOVER_BG={NAV_HOVER_BG}
        persistedQueryRef={historyPersistedQueryRef}
      />

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

      {/* Desktop sidebar */}
      <div className="hidden md:block">
        <aside
          className={`h-full flex flex-col border-r transition-all duration-300 ease-out ${
            isNavCollapsed ? "w-[72px]" : "w-64"
          }`}
          style={{
            backgroundColor: "rgba(148,163,184,0.06)",
            borderColor: "rgba(148,163,184,0.20)",
            color: "var(--navbar-text)",
          }}
        >
          {/* Header */}
          <div
            className={`flex ${
              isNavCollapsed
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
                className={`fa-solid ${
                  isNavCollapsed ? "fa-angle-right" : "fa-angle-left"
                } text-[13px] opacity-65 leading-none`}
                style={{ lineHeight: 1, transform: "translateY(0.5px)" }}
              />
            </button>
          </div>

          {/* Nav */}
          <nav
            className={`flex-1 min-h-0 ${
              isNavCollapsed ? "px-2 pt-3" : "px-3 pt-4"
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
                              "先用上傳檔案 → 不足再查向量庫"}
                            {ragMode === "vector_only" &&
                              "只查向量庫（你做好的教材庫）"}
                            {ragMode === "file_only" &&
                              "只用上傳檔案（不查向量庫）"}
                          </span>

                          <i
                            className={`fa-solid fa-chevron-down mt-[2px] text-[11px] opacity-60 transition ${
                              ragOpen ? "rotate-180" : ""
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
                                label: "先用上傳檔案 → 不足再查向量庫",
                              },
                              {
                                value: "vector_only",
                                label: "只查向量庫（你做好的教材庫）",
                              },
                              {
                                value: "file_only",
                                label: "只用上傳檔案（不查向量庫）",
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
                      active={activeView === "llm"}
                      onClick={() => newThread()}
                    />
                  </div>
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
                    {historyThreads.slice(0, 8).map((t) => (
                      <SideThreadItem
                        key={t.id}
                        threadId={t.id}
                        title={t.title}
                        meta={t.updatedAt}
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
                  active={activeView === "llm"}
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
        <div className="md:hidden fixed inset-0 z-50">
          <div
            className="absolute inset-0 bg-black/30"
            onClick={() => setIsMobileNavOpen(false)}
          />
          <div
            className="absolute left-0 top-0 bottom-0 w-[78%] max-w-[320px] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <aside
              className="h-full w-full border-r flex flex-col"
              style={{
                backgroundColor: "rgba(148,163,184,0.06)",
                borderColor: "rgba(148,163,184,0.20)",
                color: "var(--navbar-text)",
              }}
            >
              <div
                className="px-4 pt-4 pb-3 border-b"
                style={{ borderColor: "rgba(148,163,184,0.20)" }}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h1 className="text-lg font-semibold tracking-wide">
                      GalaBone
                    </h1>
                    <p className="text-[11px] mt-1 opacity-70">
                      Your Bone We Care
                    </p>
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
                    onClick={() => setIsMobileNavOpen(false)}
                    title="關閉導覽列"
                  >
                    <i className="fa-solid fa-xmark text-[14px] opacity-70" />
                  </button>
                </div>
              </div>

              <nav className="flex-1 min-h-0 px-3 pt-4 text-sm space-y-2 overflow-y-auto">
                <div className="space-y-1">
                  <SideRow
                    iconClass="fa-regular fa-message"
                    label="新對話"
                    active={activeView === "llm"}
                    onClick={() => {
                      newThread();
                      setIsMobileNavOpen(false);
                    }}
                  />
                </div>

                <div className="px-2">
                  <div className="flex items-center gap-2 px-3 py-2 rounded-xl opacity-90">
                    <i className="fa-solid fa-diagram-project text-[14px] opacity-80" />
                    <div className="text-[14px] font-semibold">RAG 模式</div>
                    <div className="text-[11px] opacity-60">
                      （不會建立索引）
                    </div>
                  </div>

                  <select
                    value={ragMode}
                    onChange={(e) => setRagMode(e.target.value as RagMode)}
                    className="w-full rounded-xl px-3 py-2 text-[13px] outline-none border"
                    style={{
                      backgroundColor: "rgba(148,163,184,0.10)",
                      borderColor: "rgba(148,163,184,0.22)",
                      color: "var(--foreground)",
                    }}
                  >
                    <option value="file_then_vector">
                      先用上傳檔案 → 不足再查向量庫
                    </option>
                    <option value="vector_only">
                      只查向量庫（你做好的教材庫）
                    </option>
                    <option value="file_only">
                      只用上傳檔案（不查向量庫）
                    </option>
                  </select>
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
                    {historyThreads.slice(0, 8).map((t) => (
                      <SideThreadItem
                        key={t.id}
                        threadId={t.id}
                        title={t.title}
                        meta={t.updatedAt}
                        active={activeThreadId === t.id}
                        onClick={() => {
                          loadThreadToMain(t.id);
                          setIsMobileNavOpen(false);
                        }}
                      />
                    ))}
                  </div>
                </div>
              </nav>

              <div
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
      )}

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
                          className={`flex ${
                            isUser ? "justify-end" : "justify-start"
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
                  <div className="flex items-end gap-3 w-full max-w-3xl">
                    <div className="flex-1 relative">
                      <div
                        className={`relative border px-4 py-2 shadow-lg backdrop-blur-sm ${
                          isExpanded ? "rounded-2xl" : "rounded-full"
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

                          <div
                            className={
                              isExpanded ? "" : "flex items-center gap-3"
                            }
                          >
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
                                requestAnimationFrame(() =>
                                  autoResizeTextarea()
                                );
                              }}
                              onKeyDown={handleKeyDown}
                              placeholder="提出任何問題⋯"
                              rows={1}
                              className={`custom-scroll bg-transparent resize-none border-none outline-none text-sm leading-relaxed overflow-hidden placeholder:text-slate-500 ${
                                isExpanded ? "w-full" : "flex-1"
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
                                <span className="text-[10px] text-emerald-400">
                                  ●
                                </span>
                                <button
                                  type="submit"
                                  disabled={
                                    (!draftText.trim() &&
                                      pendingFiles.length === 0) ||
                                    loading
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
                                <span className="text-[10px] text-emerald-400">
                                  ●
                                </span>
                                <button
                                  type="submit"
                                  disabled={
                                    (!draftText.trim() &&
                                      pendingFiles.length === 0) ||
                                    loading
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
              </form>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
