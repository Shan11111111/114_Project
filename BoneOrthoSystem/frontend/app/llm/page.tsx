"use client";

import { useSearchParams } from "next/navigation";

import {
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
  listConvs: `${S2X_BASE}/agent/conversations`,
  getMsgs: (cid: string) => `${S2X_BASE}/agent/conversations/${cid}/messages`,
};

function getUserIdFallback() {
  return "guest";
}

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
// ✅ Detection Viewer（最小侵入：只加一張卡片，不動你現有聊天 UI）
// - 標籤不顯示信心值
// - 優先顯示 bone_zh；沒有就 fallback label41 對照中文；再沒有就 label41=xx
// - 有 poly / PolyJson / P1~P4 就畫旋轉框；否則用 bbox 畫正框
// ==============================

const LABEL41_ZH: Record<number, string> = {
  10: "掌骨",
  14: "手指骨",
  16: "腕骨",
  // 其他 41 類你要補齊也可以放這裡（不影響 UI）
};

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function toNum(v: any): number | null {
  const n = typeof v === "number" ? v : v === null || v === undefined ? NaN : Number(v);
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
  // 1) direct poly
  if (Array.isArray(d.poly) && d.poly.length >= 4) {
    const pts = d.poly
      .map((p) => [toNum(p?.[0]), toNum(p?.[1])] as any)
      .filter((p) => p[0] !== null && p[1] !== null)
      .map((p) => [p[0] as number, p[1] as number]);
    if (pts.length >= 4) return pts;
  }

  // 2) PolyJson
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
    // 也有人存成 {poly:[[x,y]...]}
    if (obj && Array.isArray(obj.poly) && obj.poly.length >= 4) {
      const pts = obj.poly
        .map((p: any) => [toNum(p?.[0]), toNum(p?.[1])] as any)
        .filter((p) => p[0] !== null && p[1] !== null)
        .map((p) => [p[0] as number, p[1] as number]);
      if (pts.length >= 4) return pts;
    }
  }

  // 3) P1~P4
  const p1x = toNum(d.P1X), p1y = toNum(d.P1Y);
  const p2x = toNum(d.P2X), p2y = toNum(d.P2Y);
  const p3x = toNum(d.P3X), p3y = toNum(d.P3Y);
  const p4x = toNum(d.P4X), p4y = toNum(d.P4Y);

  if (
    p1x !== null && p1y !== null &&
    p2x !== null && p2y !== null &&
    p3x !== null && p3y !== null &&
    p4x !== null && p4y !== null
  ) {
    return [
      [p1x, p1y],
      [p2x, p2y],
      [p3x, p3y],
      [p4x, p4y],
    ];
  }

  // 4) fallback bbox -> poly
  const bb = d.bbox;
  if (Array.isArray(bb) && bb.length === 4) {
    const x1 = toNum(bb[0]), y1 = toNum(bb[1]), x2 = toNum(bb[2]), y2 = toNum(bb[3]);
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
  // 粗略判斷：如果有任何點 > 2，當成像素座標（非 normalized）
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
  const [natural, setNatural] = useState<{ w: number; h: number }>({ w: 1, h: 1 });

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
    return (detections || []).map((d, idx) => {
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

      const pointsStr = scaled.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");

      return {
        key: `det-${idx}-${String(d.label41 ?? "")}-${minX.toFixed(1)}-${minY.toFixed(1)}`,
        pointsStr,
        label: formatDetName(d), // ✅ 不含 conf
        labelX: minX,
        labelY: minY,
      };
    }).filter(Boolean) as {
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
          偵測框：{(detections?.length ?? 0)}
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
                  {/* label */}
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

  // 點外面自動關閉
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

  // ✅ inline rename state (最小侵入)
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement | null>(null);

  // 建 index（一次）
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
    // 組字中不 filter（避免 IME 卡頓）
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

  // 打開時：把 ref 值塞回 input（避免視覺「被清空」）
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

  // ESC 關閉（rename 時按 Esc 會被 input 自己吃掉，不影響）
  useEffect(() => {
    if (!isOpen) return;
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  // ===== inline rename helpers（只作用在右側標題）=====
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
          {/* header */}
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

          {/* content */}
          <div className="flex-1 min-h-0 grid grid-cols-12 gap-4 p-4">
            {/* left */}
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

            {/* right */}
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
  const bootOnceRef = useRef(false);

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

  // ✅ 假的 thread 清單（改成可更新：只為了 rename / delete，不影響其他行為）
  const [historyThreads, setHistoryThreads] = useState<HistoryThread[]>([
    {
      id: "t-001",
      title: "骨折分類與處置",
      updatedAt: "今天 21:10",
      preview: "骨折就是骨頭出現裂痕或斷裂…",
      messageCount: 8,
    },
    {
      id: "t-002",
      title: "L/R Mark 與左右判斷",
      updatedAt: "昨天 17:42",
      preview: "手部 X 光只有一隻手時，可以用…",
      messageCount: 12,
    },
    {
      id: "t-003",
      title: "資料庫 Bone_Info 對應規則",
      updatedAt: "12/10 13:05",
      preview: "Cervical_Vertebrae → Cervical vertebrae…",
      messageCount: 6,
    },
  ]);

  // ✅ 假的 messages
  const [historyMessages] = useState<HistoryMessage[]>([
    // t-001
    {
      id: "m-001",
      threadId: "t-001",
      role: "user",
      content: "骨折是什麼？會怎麼治療？",
      createdAt: "21:08",
    },
    {
      id: "m-002",
      threadId: "t-001",
      role: "assistant",
      content:
        "骨折是骨頭出現裂痕或斷裂，嚴重程度可從細小裂縫到完全斷開。常用 X 光判斷位置與型態，治療可能包含固定、石膏或手術。",
      createdAt: "21:09",
    },
    {
      id: "m-003",
      threadId: "t-001",
      role: "user",
      content: "那粉碎性骨折跟一般骨折差在哪？",
      createdAt: "21:09",
    },
    {
      id: "m-004",
      threadId: "t-001",
      role: "assistant",
      content:
        "粉碎性骨折通常代表骨頭裂成多塊，穩定性更差，常需要更積極的固定方式（例如手術內固定）才能恢復對位與功能。",
      createdAt: "21:10",
    },

    // t-002
    {
      id: "m-005",
      threadId: "t-002",
      role: "user",
      content: "很多手部 X 光只有一隻手，怎麼判斷左右？",
      createdAt: "17:40",
    },
    {
      id: "m-006",
      threadId: "t-002",
      role: "assistant",
      content:
        "最穩的做法是把片上的 L/R Marker 當成 meta 訊息；若沒有 marker，可再搭配解剖特徵（例如拇指方向、尺橈骨相對位置）做 fallback。",
      createdAt: "17:41",
    },

    // t-003
    {
      id: "m-007",
      threadId: "t-003",
      role: "user",
      content: "辨識出的名字跟資料庫不一樣怎麼辦？",
      createdAt: "13:03",
    },
    {
      id: "m-008",
      threadId: "t-003",
      role: "assistant",
      content:
        "可以做一層 mapping（dictionary / table），把 YOLO class 名稱標準化成 DB 的 bone_en（例如底線換空白、大小寫、特例對應）。",
      createdAt: "13:04",
    },
  ]);

  const [activeThreadId, setActiveThreadId] = useState<string>("t-001");

  const [sessionId, setSessionId] = useState<string>(activeThreadId || "");
  const [userId, setUserId] = useState<string>(getUserIdFallback());

  useEffect(() => {
    // 後端還沒做對話紀錄的情況下，用 activeThreadId 當 session 先撐著
    console.log("🔁 session sync effect ran:", activeThreadId);
    setSessionId(activeThreadId);
  }, [activeThreadId]);

  // ✅ 統一 hover/active 顏色
  const NAV_ACTIVE_BG = "rgba(148,163,184,0.16)";
  const NAV_HOVER_BG = "rgba(148,163,184,0.10)";

  // ✅ rename：只更新 title（最小改動）
  function renameThread(threadId: string, nextTitle: string) {
    const title = nextTitle.trim();
    if (!title) return;

    setHistoryThreads((prev) =>
      prev.map((t) => (t.id === threadId ? { ...t, title } : t))
    );
  }

  // ✅ delete：刪除 thread（UI 直接消失）
  function deleteThread(threadId: string) {
    if (!confirm("確定要刪除這個對話嗎？")) return;

    setHistoryThreads((prev) => {
      const next = prev.filter((t) => t.id !== threadId);

      // 若刪到目前 active，切到第一個（或清空）
      if (activeThreadId === threadId) {
        const fallbackId = next[0]?.id ?? "";
        setActiveThreadId(fallbackId);

        // 若有 fallback，就同步載入到主畫面
        if (fallbackId) {
          loadThreadToMain(fallbackId);
        } else {
          newThread();
        }
      }

      return next;
    });
  }

  // ✅ share：先用 clipboard（可換成你後端分享連結）
  function shareThread(threadId: string) {
    const url = `${location.origin}/llm?thread=${encodeURIComponent(threadId)}`;
    navigator.clipboard.writeText(url);
    alert("已複製分享連結");
  }

  // =========================
  // thread → 主畫面 messages
  // =========================
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
    setActiveThreadId(threadId);
    setActiveView("llm");
    setMessages(buildChatMessagesFromThread(threadId));

    resetMainInputBox();

    setPendingFiles((prev) => {
      prev.forEach((f) => URL.revokeObjectURL(f.url));
      return [];
    });

    // ✅ seed card 不清空（你要清也可以），這裡保持最小侵入：不動
    setIsHistoryOpen(false);
    setTimeout(() => inputRef.current?.focus(), 60);
  }

  function newThread() {
    const newId = `t-${Date.now()}`;
    setActiveThreadId(newId);
    setActiveView("llm");

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

    // ✅ seed card 不清空（最小侵入）
    setIsHistoryOpen(false);
    setTimeout(() => inputRef.current?.focus(), 60);
  }

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

  // 點外面自動關 tool menu
  useEffect(() => {
    function onDown(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (!target.closest("[data-tool-menu-root]")) setShowToolMenu(false);
      if (!target.closest("[data-rag-dropdown-root]")) setRagOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  // ===== 檔案處理 =====
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

    // ✅ 只更新待上傳檔案清單（不動 messages / UI 結構）
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

  // ===== 送出訊息 =====
  async function sendMessage(e?: FormEvent) {
    if (e) e.preventDefault();

    const text = draftText.trim();
    if ((!text && pendingFiles.length === 0) || loading) return;

    const userMessage: ChatMessage = {
      id: Date.now(),
      role: "user",
      content: text,
      files: pendingFiles.length ? pendingFiles : undefined,
    };

    setMessages((prev) => [...prev, userMessage]);

    // 把要上傳的檔案先留住（因為下面會清 pendingFiles + revoke）
    const filesToUpload = pendingFiles.slice();

    resetMainInputBox();

    setPendingFiles((prev) => {
      prev.forEach((f) => URL.revokeObjectURL(f.url));
      return [];
    });

    setLoading(true);

    try {
      // ✅ 沒設定後端就退回 demo（避免你開發時一直炸）
      if (!API_BASE) {
        const answerText = fakeLLMReply(text || "（已上傳檔案）");
        const botMessage: ChatMessage = {
          id: Date.now() + 1,
          role: "assistant",
          content: answerText,
        };
        setMessages((prev) => [...prev, botMessage]);
        setLoading(false);
        return;
      }

      // ✅ RAG 模式（只改 prompt，不動 UI）
      const wantFile = ragMode !== "vector_only";
      const wantVector = ragMode !== "file_only";

      // 1) 先上傳檔案（若有 & wantFile）
      let fileContextText = "";
      if (wantFile) {
        for (const f of filesToUpload) {
          if (!f.raw) continue;

          const up = await uploadOneFileToBackend(f.raw);

          // 後端可能回：{ url, filename, text, summary, ... }
          const fn = String(up?.filename ?? up?.name ?? f.name);
          const summary = String(up?.summary ?? "");
          const txt = String(up?.text ?? "");
          const urlRel = String(up?.url ?? up?.path ?? "");
          const abs = toAbsUrl(urlRel);

          // 若你想記 serverUrl（不影響 UI）
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

      // 2) vector hint（只影響 prompt，不影響 UI）
      const vectorHint = wantVector
        ? `\n\n---\n【RAG】請先用既有教材向量庫檢索後回答，並附 sources/citations（檔名/頁碼或chunk/score）。找不到就說找不到。`
        : "";

      // 3) 呼叫 chat
      const sid = (sessionId || activeThreadId || `t-${Date.now()}`).trim();
      const uid = (userId || "guest").trim();

      const basePrompt =
        (text ? text : "（已上傳檔案，請根據檔案內容協助）") +
        (wantFile && fileContextText ? `\n\n${fileContextText}` : "") +
        vectorHint;

      const payload = {
        session_id: sid,
        user_id: uid,
        messages: [{ role: "user", type: "text", content: basePrompt }],
      };

      const data = await postChatToBackend(payload);

      // ✅ C版判斷：優先吃 answer/content/message
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
    } catch (err: any) {
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now() + 2,
          role: "assistant",
          content: `⚠️ 後端呼叫失敗：${err?.message ?? String(err)}`,
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // IME 組字中不要送出
    // @ts-ignore
    if (e.nativeEvent?.isComposing) return;

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  // ✅ 跟檔案B一致：把目前 messages 轉成後端需要的 messages[]
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

  // ===== Tool menu =====
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

  // ===== message files =====
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

  // ===== Sidebar UI =====
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

  function openHistory() {
    setIsHistoryOpen(true);
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
  // ✅ Bootstrap-from-S1（保留你原本邏輯，另外把 image + detections 存成 seed 卡）
  // =========================
  useEffect(() => {
    let caseIdStr =
      searchParams.get("caseId") ??
      searchParams.get("caseld") ?? // 兼容之前拼錯
      searchParams.get("caseid") ??
      "";

    if (!caseIdStr && typeof window !== "undefined") {
      caseIdStr = localStorage.getItem("gab_last_case_id") || "";
    }

    if (!caseIdStr) return;

    if (typeof window !== "undefined") {
      localStorage.setItem("gab_last_case_id", String(caseIdStr));
    }
    if (bootOnceRef.current) return;
    bootOnceRef.current = true;

    const caseId = Number(caseIdStr);
    if (!Number.isFinite(caseId) || caseId <= 0) return;

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

        // ✅ seed 卡片（不影響 UI：只是多顯示一張）
        if (imgAbs) setSeedImageUrl(imgAbs);
        const dets = Array.isArray(data.detections) ? (data.detections as Detection[]) : [];
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

        const payload = {
          session_id: (bootSession || "").trim(),
          user_id: (userId || "guest").trim(),
          messages: [{ role: "user", type: "text", content: question }],
        };

        const resp = await postChatToBackend(payload);

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
      } catch (e: any) {
        setMessages((prev) => [
          ...prev,
          {
            id: Date.now() + 2,
            role: "assistant",
            content: `bootstrap 失敗：${e?.message ?? String(e)}`,
          },
        ]);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

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
        onSelectThread={(id) => setActiveThreadId(id)}
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
                  {/* ✅ 只加這塊：不改你原本 message bubble 的結構 */}
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
