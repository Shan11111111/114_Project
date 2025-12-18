"use client";

import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  FormEvent,
  ChangeEvent,
  KeyboardEvent,
} from "react";
import { useSearchParams } from "next/navigation";

/** =========================
 *  API Base
 *  ========================= */
const API_BASE = (
  process.env.NEXT_PUBLIC_BACKEND_URL || "http://127.0.0.1:8000"
).replace(/\/+$/, "");
const S2X_BASE = `${API_BASE}/s2x`;
const BOOT_URL = `${API_BASE}/s2/agent/bootstrap-from-s1`;

const API = {
  health: `${S2X_BASE}/health`,
  upload: `${S2X_BASE}/upload`,
  chat: `${S2X_BASE}/agent/chat`,
  exportPdf: `${S2X_BASE}/export/pdf`,
  exportPptx: `${S2X_BASE}/export/pptx`,
  listConvs: `${S2X_BASE}/agent/conversations`,
  getMsgs: (cid: string) => `${S2X_BASE}/agent/conversations/${cid}/messages`,
};

/** =========================
 *  Types
 *  ========================= */
type RagMode = "file_then_vector" | "vector_only" | "file_only";

type UploadResult = {
  url: string;
  filetype?: string;
  filename?: string;
  text?: string;
  summary?: string;
};

type BackendMsg = {
  role: "user" | "assistant";
  type: "text" | "image" | "file";
  content?: string | null;
  url?: string | null;
  filetype?: string | null;
};

type RagSource = {
  title?: string;
  file?: string;
  file_id?: string;
  url?: string;
  page?: number | string;
  chunk?: number | string;
  snippet?: string;
  score?: number;
  kind?: string;
};

type ChatMessage = {
  id: number;
  role: "user" | "assistant";
  content: string;
  evidence?: RagSource[];
  meta?: { grounded?: boolean };
};

type PolyPoint = [number, number];

type Detection = {
  bone_id: number | null;
  bone_zh: string | null;
  bone_en: string | null;
  label41: string;
  confidence: number;
  bbox: [number, number, number, number]; // normalized 0~1

  // ✅ 新增：旋轉框 / 多邊形（後端有回就用，沒有就忽略）
  poly?: PolyPoint[] | null; // e.g. [[x,y]..] 0~1
  poly_json?: string | null; // e.g. "[[x,y],[x,y]...]"
  PolyJson?: string | null; // 兼容 DB 欄位名
  polyJson?: string | null;

  PolyIsNormalized?: boolean | number | null;
  poly_is_normalized?: boolean | number | null;
  polyIsNormalized?: boolean | number | null;

  P1X?: number | null; P1Y?: number | null;
  P2X?: number | null; P2Y?: number | null;
  P3X?: number | null; P3Y?: number | null;
  P4X?: number | null; P4Y?: number | null;

  p1x?: number | null; p1y?: number | null;
  p2x?: number | null; p2y?: number | null;
  p3x?: number | null; p3y?: number | null;
  p4x?: number | null; p4y?: number | null;
};

/** =========================
 *  Helpers
 *  ========================= */
function safeJsonParse(raw: string) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function toAbsoluteUrl(base: string, u?: string | null) {
  if (!u) return null;
  if (u.startsWith("http://") || u.startsWith("https://")) return u;
  if (!u.startsWith("/")) u = "/" + u;
  return `${base}${u}`;
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function isFiniteNumber(v: any): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function toBool(v: any): boolean | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") {
    const t = v.trim().toLowerCase();
    if (t === "true" || t === "1") return true;
    if (t === "false" || t === "0") return false;
  }
  return null;
}

function formatDetName(d: Detection) {
  const name =
    (d.bone_zh && d.bone_zh.trim()) ||
    (d.bone_en && d.bone_en.trim()) ||
    "";
  if (name) return name;
  return d.label41 ? `label41=${d.label41}` : "Unknown";
}

/** 把 detections 變成「乾淨」提問，不塞 conf/bbox */
function buildCleanAutoQuestion(caseId: number, dets: Detection[]) {
  const names = dets.map(formatDetName);
  const unique = Array.from(new Set(names));
  const top = unique.slice(0, 6);

  const summary =
    top.length > 0
      ? `偵測到的骨骼可能包含：${top.join("、")}${
          unique.length > top.length ? `（共 ${unique.length} 類）` : ""
        }。`
      : "目前沒有偵測到骨骼結果（或資料尚未寫入）。";

  return (
    `我從 S1 辨識頁面帶入影像與偵測結果（由資料庫讀取）。\n` +
    `ImageCaseId: ${caseId}\n\n` +
    `${summary}\n\n` +
    `我的問題：\n` +
    `請用衛教方式解釋偵測到的骨骼部位（它們在身體哪裡、功能是什麼）、在影像判讀上通常會關注哪些問題，` +
    `並給我 3 個延伸提問（例如：可能的受傷機轉、建議做的檢查、何時該就醫）。`
  );
}

/** ✅ 從 detection 抽出 polygon（支援：poly / PolyJson / poly_json / P1~P4） */
function getPolyFromDetection(d: Detection): PolyPoint[] | null {
  // 1) 直接 poly
  if (Array.isArray(d.poly) && d.poly.length >= 3) {
    const ok = d.poly.every(
      (p) =>
        Array.isArray(p) &&
        p.length >= 2 &&
        typeof p[0] === "number" &&
        typeof p[1] === "number"
    );
    if (ok) return d.poly as PolyPoint[];
  }

  // 2) PolyJson / poly_json
  const polyJson =
    d.poly_json ??
    d.PolyJson ??
    d.polyJson ??
    null;

  if (typeof polyJson === "string" && polyJson.trim()) {
    const arr = safeJsonParse(polyJson);
    if (Array.isArray(arr) && arr.length >= 3) {
      const ok = arr.every(
        (p: any) =>
          Array.isArray(p) &&
          p.length >= 2 &&
          typeof p[0] === "number" &&
          typeof p[1] === "number"
      );
      if (ok) return arr as PolyPoint[];
    }
  }

  // 3) P1~P4
  const p1x = (d.P1X ?? d.p1x) as any;
  const p1y = (d.P1Y ?? d.p1y) as any;
  const p2x = (d.P2X ?? d.p2x) as any;
  const p2y = (d.P2Y ?? d.p2y) as any;
  const p3x = (d.P3X ?? d.p3x) as any;
  const p3y = (d.P3Y ?? d.p3y) as any;
  const p4x = (d.P4X ?? d.p4x) as any;
  const p4y = (d.P4Y ?? d.p4y) as any;

  if (
    isFiniteNumber(p1x) && isFiniteNumber(p1y) &&
    isFiniteNumber(p2x) && isFiniteNumber(p2y) &&
    isFiniteNumber(p3x) && isFiniteNumber(p3y) &&
    isFiniteNumber(p4x) && isFiniteNumber(p4y)
  ) {
    return [
      [p1x, p1y],
      [p2x, p2y],
      [p3x, p3y],
      [p4x, p4y],
    ];
  }

  return null;
}

/** =========================
 *  Evidence normalization
 *  ========================= */
function normalizeSources(resp: any): RagSource[] {
  if (!resp) return [];
  const direct =
    resp.sources ||
    resp.citations ||
    resp.references ||
    resp.rag?.sources ||
    resp.rag?.citations ||
    resp.result?.sources;

  if (Array.isArray(direct)) {
    return direct.map((s: any) => ({
      title: s.title ?? s.name ?? s.file_name ?? s.filename,
      file: s.file ?? s.file_name ?? s.filename ?? s.title,
      file_id: s.file_id ?? s.id,
      url: s.url ?? s.link,
      page: s.page ?? s.pageno ?? s.page_no,
      chunk: s.chunk ?? s.chunk_id,
      snippet: s.snippet ?? s.text ?? s.content,
      score:
        typeof s.score === "number"
          ? s.score
          : typeof s.similarity === "number"
          ? s.similarity
          : undefined,
      kind: s.kind ?? s.type ?? s.source_type,
    }));
  }

  if (Array.isArray(resp.actions)) {
    const pools: any[] = [];
    for (const a of resp.actions) {
      if (!a) continue;
      if (Array.isArray(a.sources)) pools.push(...a.sources);
      if (Array.isArray(a.citations)) pools.push(...a.citations);
      if (a.type === "sources" && Array.isArray(a.items)) pools.push(...a.items);
    }
    if (pools.length) {
      return pools.map((s: any) => ({
        title: s.title ?? s.name ?? s.file_name ?? s.filename,
        file: s.file ?? s.file_name ?? s.filename ?? s.title,
        file_id: s.file_id ?? s.id,
        url: s.url ?? s.link,
        page: s.page ?? s.pageno ?? s.page_no,
        chunk: s.chunk ?? s.chunk_id,
        snippet: s.snippet ?? s.text ?? s.content,
        score:
          typeof s.score === "number"
            ? s.score
            : typeof s.similarity === "number"
            ? s.similarity
            : undefined,
        kind: s.kind ?? s.type ?? s.source_type,
      }));
    }
  }

  return [];
}

/** =========================
 *  Evidence UI
 *  ========================= */
function EvidenceBlock({ evidence }: { evidence: RagSource[] }) {
  const [open, setOpen] = useState(false);
  const count = evidence?.length ?? 0;

  if (!count) {
    return (
      <div
        className="mt-2 rounded-xl border px-3 py-2 text-[12px]"
        style={{
          borderColor: "rgba(148,163,184,0.35)",
          backgroundColor: "rgba(148,163,184,0.10)",
        }}
      >
        <div className="font-semibold" style={{ color: "rgba(15,23,42,0.85)" }}>
          依據：<span className="text-red-600">本次未提供可追溯來源</span>
        </div>
        <div className="opacity-80 mt-1">
          （你可以要求後端「必回傳 sources/citations」才算合格 RAG。）
        </div>
      </div>
    );
  }

  const copyRefs = async () => {
    const lines = evidence.map((s, i) => {
      const name = s.file || s.title || `source-${i + 1}`;
      const page = s.page !== undefined && s.page !== null ? `p.${s.page}` : "";
      const chunk =
        s.chunk !== undefined && s.chunk !== null ? `chunk:${s.chunk}` : "";
      const score = typeof s.score === "number" ? `score:${s.score.toFixed(3)}` : "";
      return `[#${i + 1}] ${name} ${page} ${chunk} ${score}`.trim();
    });
    await navigator.clipboard.writeText(lines.join("\n"));
  };

  return (
    <div
      className="mt-2 rounded-xl border px-3 py-2 text-[12px]"
      style={{
        borderColor: "rgba(34,197,94,0.35)",
        backgroundColor: "rgba(34,197,94,0.10)",
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="font-semibold" style={{ color: "rgba(15,23,42,0.88)" }}>
          依據：<span className="text-emerald-700">{count} 筆來源</span>
          <span className="ml-2 opacity-70">（可追溯 / 可驗證）</span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={copyRefs}
            className="px-2 py-1 rounded-lg border"
            style={{
              borderColor: "rgba(15,23,42,0.15)",
              backgroundColor: "rgba(255,255,255,0.7)",
            }}
          >
            複製引用
          </button>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="px-2 py-1 rounded-lg border"
            style={{
              borderColor: "rgba(15,23,42,0.15)",
              backgroundColor: "rgba(255,255,255,0.7)",
            }}
          >
            {open ? "收合" : "展開"}
          </button>
        </div>
      </div>

      {open && (
        <div className="mt-2 space-y-2">
          {evidence.map((s, idx) => {
            const name = s.file || s.title || `source-${idx + 1}`;
            const meta = [
              s.kind ? `type:${s.kind}` : null,
              s.page !== undefined && s.page !== null ? `p.${s.page}` : null,
              s.chunk !== undefined && s.chunk !== null ? `chunk:${s.chunk}` : null,
              typeof s.score === "number" ? `score:${s.score.toFixed(3)}` : null,
            ]
              .filter(Boolean)
              .join(" · ");

            return (
              <div
                key={`src-${idx}-${name}`}
                className="rounded-lg border px-2 py-2"
                style={{
                  borderColor: "rgba(15,23,42,0.12)",
                  backgroundColor: "rgba(255,255,255,0.65)",
                }}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="font-semibold">
                    #{idx + 1} {name}
                  </div>
                  {s.url && (
                    <a
                      className="text-blue-700 underline text-[12px]"
                      href={s.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      開啟
                    </a>
                  )}
                </div>
                {meta && <div className="opacity-70 mt-1">{meta}</div>}
                {s.snippet && (
                  <div className="mt-2 whitespace-pre-wrap leading-relaxed text-[12px] opacity-90">
                    {s.snippet.length > 600 ? s.snippet.slice(0, 600) + "…" : s.snippet}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** =========================
 *  Detection Viewer
 *  ========================= */
function DetectionViewer({
  imageUrl,
  detections,
}: {
  imageUrl: string;
  detections: Detection[];
}) {
  const [imgWidth, setImgWidth] = useState<number>(420); // ✅ 預設不要太大
  const [imgHeight, setImgHeight] = useState<number>(260);
  const [natW, setNatW] = useState<number>(1);
  const [natH, setNatH] = useState<number>(1);
  const [showDetections, setShowDetections] = useState(true);

  useEffect(() => {
    let alive = true;
    const img = new Image();
    img.onload = () => {
      if (!alive) return;
      const w = img.naturalWidth || 1;
      const h = img.naturalHeight || 1;
      setNatW(w);
      setNatH(h);
      setImgHeight(Math.round((imgWidth * h) / w));
    };
    img.src = imageUrl;
    return () => {
      alive = false;
    };
  }, [imageUrl, imgWidth]);

  const dec = () => setImgWidth((v) => clamp(v - 40, 320, 760));
  const inc = () => setImgWidth((v) => clamp(v + 40, 320, 760));

  const overlays = useMemo(() => {
    return detections.map((d, idx) => {
      const label = `${formatDetName(d)}`;

      // poly 是否 normalized（預設 true）
      const isNorm =
        toBool(d.PolyIsNormalized) ??
        toBool(d.polyIsNormalized) ??
        toBool(d.poly_is_normalized) ??
        true;

      const poly = getPolyFromDetection(d);

      if (poly && poly.length >= 3) {
        const ptsPx = poly.map(([x, y]) => {
          const px = isNorm ? x * imgWidth : x * (imgWidth / natW);
          const py = isNorm ? y * imgHeight : y * (imgHeight / natH);
          return [px, py] as PolyPoint;
        });

        const xs = ptsPx.map((p) => p[0]);
        const ys = ptsPx.map((p) => p[1]);
        const minX = Math.min(...xs);
        const minY = Math.min(...ys);

        const labelX = clamp(minX, 0, imgWidth - 10);
        const labelY = clamp(minY - 34, 0, imgHeight - 10);

        const pointsStr = ptsPx.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");

        return {
          idx,
          kind: "poly" as const,
          pointsStr,
          label,
          labelX,
          labelY,
        };
      }

      // fallback：bbox
      const [x1, y1, x2, y2] = d.bbox ?? [0, 0, 0, 0];
      const left = x1 * imgWidth;
      const top = y1 * imgHeight;
      const w = (x2 - x1) * imgWidth;
      const h = (y2 - y1) * imgHeight;

      const labelX = clamp(left, 0, imgWidth - 10);
      const labelY = clamp(top - 34, 0, imgHeight - 10);

      return {
        idx,
        kind: "rect" as const,
        left,
        top,
        w,
        h,
        label,
        labelX,
        labelY,
      };
    });
  }, [detections, imgWidth, imgHeight, natW, natH]);

  return (
    <div
      className="rounded-2xl border px-4 py-3"
      style={{
        borderColor: "rgba(15,23,42,0.12)",
        background: "linear-gradient(180deg,#0ea5e9 0%, #0b7aa6 100%)",
        boxShadow: "0 18px 40px rgba(15,23,42,0.16)",
      }}
    >
      {/* Toolbar (只留你要的) */}
      <div className="flex items-center justify-between gap-3 mb-3 text-white">
        <div className="text-[14px] font-semibold tracking-wide">
          圖片寬度：{imgWidth}px<span className="opacity-80">｜</span>偵測框：
          {detections.length}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={dec}
            className="h-10 w-10 rounded-full border flex items-center justify-center text-lg font-bold"
            style={{
              borderColor: "rgba(255,255,255,0.75)",
              backgroundColor: "rgba(255,255,255,0.12)",
            }}
            aria-label="zoom out"
          >
            −
          </button>
          <button
            type="button"
            onClick={inc}
            className="h-10 w-10 rounded-full border flex items-center justify-center text-lg font-bold"
            style={{
              borderColor: "rgba(255,255,255,0.75)",
              backgroundColor: "rgba(255,255,255,0.12)",
            }}
            aria-label="zoom in"
          >
            +
          </button>

          <button
            type="button"
            onClick={() => setShowDetections((v) => !v)}
            className="h-10 px-4 rounded-full border text-[13px] font-semibold"
            style={{
              borderColor: "rgba(255,255,255,0.75)",
              backgroundColor: "rgba(255,255,255,0.12)",
            }}
          >
            {showDetections ? "隱藏偵測框" : "顯示偵測框"}
          </button>
        </div>
      </div>

      {/* Image + overlay */}
      <div
        className="rounded-2xl p-3"
        style={{
          backgroundColor: "rgba(2, 44, 64, 0.55)",
        }}
      >
        <div
          className="mx-auto rounded-xl overflow-hidden"
          style={{
            width: imgWidth,
            height: imgHeight,
            position: "relative",
            backgroundColor: "rgba(0,0,0,0.35)",
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

          {/* ✅ SVG overlay：polygon / rect */}
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
              {overlays.map((o) => {
                if (o.kind === "poly") {
                  return (
                    <polygon
                      key={`p-${o.idx}`}
                      points={o.pointsStr}
                      fill="none"
                      stroke="rgba(56,189,248,0.95)"
                      strokeWidth={3}
                      strokeLinejoin="round"
                      style={{ filter: "drop-shadow(0 8px 18px rgba(2,132,199,0.25))" }}
                    />
                  );
                }
                return (
                  <rect
                    key={`r-${o.idx}`}
                    x={o.left}
                    y={o.top}
                    width={o.w}
                    height={o.h}
                    rx={10}
                    ry={10}
                    fill="none"
                    stroke="rgba(56,189,248,0.95)"
                    strokeWidth={3}
                    style={{ filter: "drop-shadow(0 8px 18px rgba(2,132,199,0.25))" }}
                  />
                );
              })}
            </svg>
          )}

          {/* ✅ Label overlay */}
          {showDetections &&
            overlays.map((o) => (
              <div
                key={`lbl-${o.idx}`}
                style={{
                  position: "absolute",
                  left: o.labelX,
                  top: o.labelY,
                  padding: "6px 10px",
                  borderRadius: 10,
                  backgroundColor: "rgba(56,189,248,0.92)",
                  color: "#ffffff",
                  fontSize: 13,
                  fontWeight: 700,
                  whiteSpace: "nowrap",
                  pointerEvents: "none",
                }}
              >
                {o.label}
              </div>
            ))}
        </div>

        <div className="mt-2 text-[12px] text-white/90">
          Tip：若後端回傳 poly（或 PolyJson / P1~P4），這裡會自動畫旋轉框；沒有就退回 bbox 正框。
        </div>
      </div>
    </div>
  );
}

/** =========================
 *  Page
 *  ========================= */
export default function LLMPage() {
  const [healthOk, setHealthOk] = useState<boolean | null>(null);

  const [userId, setUserId] = useState("guest");
  const [sessionId, setSessionId] = useState<string>("test-1");
  const [ragMode, setRagMode] = useState<RagMode>("file_then_vector");

  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [uploaded, setUploaded] = useState<UploadResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const chatEndRef = useRef<HTMLDivElement | null>(null);

  const searchParams = useSearchParams();
  const bootOnceRef = useRef(false);

  const [seedImageUrl, setSeedImageUrl] = useState<string | null>(null);
  const [seedDetections, setSeedDetections] = useState<Detection[]>([]);

  const greeting = useMemo<ChatMessage>(
    () => ({
      id: 1,
      role: "assistant",
      content:
        "嗨，我是 GalaBone LLM。\n" +
        "你可以直接問，我會用你已建好的向量資料庫做 RAG，並盡量附上來源。",
      meta: { grounded: true },
    }),
    []
  );

  const [messages, setMessages] = useState<ChatMessage[]>([greeting]);

  const msgSeqRef = useRef(1000);
  const nextId = () => Date.now() + ++msgSeqRef.current;

  function addUser(text: string) {
    setMessages((prev) => [...prev, { id: nextId(), role: "user", content: text }]);
  }

  function addAssistant(text: string, evidence?: RagSource[]) {
    const grounded = !!(evidence && evidence.length);
    setMessages((prev) => [
      ...prev,
      { id: nextId(), role: "assistant", content: text, evidence, meta: { grounded } },
    ]);
  }

  function toBackendMessages(uiMsgs: ChatMessage[]): BackendMsg[] {
    return uiMsgs.map((m) => ({
      role: m.role,
      type: "text",
      content: m.content,
      url: null,
      filetype: null,
    }));
  }

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, loading]);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(API.health);
        setHealthOk(r.ok);
      } catch {
        setHealthOk(false);
      }
    })();
  }, []);

  /** callChat：可傳 session override（用來 bootstrap 後立即打） */
  async function callChat(question: string, sessionOverride?: string) {
    setErrorMsg(null);
    setLoading(true);

    try {
      const needFile = ragMode !== "vector_only" && uploaded?.url;
      const needVector = ragMode !== "file_only";

      const fileHint = needFile
        ? `\n\n---\n【已上傳檔案（僅本次使用，不建索引）】${uploaded?.filename || "uploaded"}\n【file_url】${uploaded?.url}\n` +
          (uploaded?.summary
            ? `【file_summary】${String(uploaded.summary).slice(0, 200)}${
                String(uploaded.summary).length > 200 ? "…" : ""
              }\n`
            : "")
        : "";

      const vectorHint = needVector
        ? `\n\n---\n【RAG】請先用既有教材向量庫檢索後回答，並附 sources（檔名/頁碼或chunk/score）。找不到就說找不到。`
        : "";

      const prompt =
        question +
        (ragMode === "file_then_vector"
          ? fileHint + vectorHint
          : ragMode === "vector_only"
          ? vectorHint
          : fileHint);

      const payload = {
        session_id: (sessionOverride ?? sessionId).trim(),
        user_id: userId.trim() || "guest",
        messages: [{ role: "user", type: "text", content: prompt } satisfies BackendMsg],
      };

      const r = await fetch(API.chat, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const raw = await r.text();
      const data = safeJsonParse(raw);

      if (!r.ok || !data) {
        throw new Error(`chat 失敗 ${r.status}：${raw.slice(0, 300)}`);
      }

      const sources = normalizeSources(data);

      if (data.answer || data.content || data.message) {
        addAssistant(String(data.answer ?? data.content ?? data.message), sources);
        if (!sources.length) {
          setErrorMsg((prev) => prev ?? "⚠️ 本次回覆未回傳 sources/citations，無法主張為「有依據 RAG」。");
        }
        return;
      }

      if (Array.isArray(data.messages)) {
        const last = [...data.messages]
          .reverse()
          .find((m: any) => m?.role === "assistant" && (m?.content ?? "").trim());
        if (last) {
          addAssistant(String(last.content), sources);
          if (!sources.length) {
            setErrorMsg((prev) => prev ?? "⚠️ 本次回覆未回傳 sources/citations，無法主張為「有依據 RAG」。");
          }
          return;
        }
      }

      addAssistant(raw.slice(0, 1200), sources);
      if (!sources.length) {
        setErrorMsg((prev) => prev ?? "⚠️ 本次回覆未回傳 sources/citations，無法主張為「有依據 RAG」。");
      }
    } finally {
      setLoading(false);
    }
  }

  /** bootstrap：載入圖片+框，並自動送一次提問（優先用 seed_text，沒有才用 clean auto） */
  useEffect(() => {
    const caseIdStr =
      searchParams.get("caseId") ??
      searchParams.get("caseld") ?? // 兼容你們之前拼錯
      searchParams.get("caseid");

    if (!caseIdStr) return;
    if (bootOnceRef.current) return;
    bootOnceRef.current = true;

    const caseId = Number(caseIdStr);
    if (!Number.isFinite(caseId) || caseId <= 0) {
      setErrorMsg(`caseId 不合法：${caseIdStr}`);
      return;
    }

    (async () => {
      try {
        setErrorMsg(null);

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

        const imgRel =
          Array.isArray(data.seed_messages)
            ? data.seed_messages.find((m: any) => m?.type === "image" && m?.url)?.url ?? null
            : null;

        const imgAbs = toAbsoluteUrl(API_BASE, imgRel);
        if (imgAbs) setSeedImageUrl(imgAbs);

        const dets = Array.isArray(data.detections) ? (data.detections as Detection[]) : [];
        setSeedDetections(dets);

        // ✅ 自動提問：優先用後端 seed_text（通常更貼近你想要的），沒有才 fallback clean
        const seedText =
          Array.isArray(data.seed_messages)
            ? (data.seed_messages.find((m: any) => m?.type === "text" && (m?.content ?? "").trim())?.content ?? "")
            : "";

        const questionToSend = seedText.trim() || buildCleanAutoQuestion(caseId, dets);

        addUser(questionToSend);
        await callChat(questionToSend, bootSession || sessionId);
      } catch (e: any) {
        setErrorMsg(e?.message ?? String(e));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  async function uploadFile(file: File) {
    setErrorMsg(null);
    setLoading(true);

    try {
      const fd = new FormData();
      fd.append("file", file);

      const res = await fetch(API.upload, { method: "POST", body: fd });
      const raw = await res.text();
      const data = safeJsonParse(raw);

      if (!res.ok || !data) {
        throw new Error(`上傳失敗 ${res.status}：${raw.slice(0, 200)}`);
      }

      setUploaded({
        url: data.url,
        filetype: data.filetype,
        filename: data.filename || file.name,
        text: data.text,
        summary: data.summary,
      });

      const hint =
        `✅ 已上傳檔案：${data.filename || file.name}\n` +
        `（只做本次對話參考，不建立索引、不寫入向量庫）\n` +
        (data.summary
          ? `\n摘要：\n${String(data.summary).slice(0, 600)}${String(data.summary).length > 600 ? "…" : ""}`
          : "");

      addAssistant(hint, []);
    } finally {
      setLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function sendMessage(e?: FormEvent) {
    if (e) e.preventDefault();
    const q = input.trim();
    if (!q || loading) return;

    setInput("");
    addUser(q);

    try {
      await callChat(q);
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      setErrorMsg(msg);
      addAssistant(
        "⚠️ 後端沒有正常回覆。\n" +
          `- backend: ${API_BASE}\n` +
          `- /s2x/agent/chat body 是否包含 session_id/user_id/messages\n` +
          `把 422/500 的 detail 貼我，我可以直接定位是哪裡炸。`,
        []
      );
    }
  }

  /** ====== 輸入框：像 GPT 自動長高 ====== */
  const MIN_H = 44;
  const MAX_H = 160;
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  function autoResize() {
    const el = inputRef.current;
    if (!el) return;

    if (!el.value.trim()) {
      el.style.height = `${MIN_H}px`;
      el.style.overflowY = "hidden";
      return;
    }

    el.style.height = "auto";
    const h = clamp(el.scrollHeight, MIN_H, MAX_H);
    el.style.height = `${h}px`;
    el.style.overflowY = el.scrollHeight > MAX_H ? "auto" : "hidden";
  }

  function onInputChange(e: ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value);
    requestAnimationFrame(autoResize);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void sendMessage();
    }
  }

  useEffect(() => {
    autoResize();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function exportFile(kind: "pdf" | "pptx") {
    setErrorMsg(null);
    setLoading(true);

    try {
      const url = kind === "pdf" ? API.exportPdf : API.exportPptx;

      const payload = {
        session_id: sessionId.trim(),
        user_id: userId.trim() || "guest",
        messages: toBackendMessages(messages),
      };

      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!r.ok) {
        const t = await r.text();
        throw new Error(`匯出失敗：${t.slice(0, 250)}`);
      }

      const blob = await r.blob();
      const dlName = kind === "pdf" ? "GalaBone_Report.pdf" : "GalaBone_Report.pptx";

      const a = document.createElement("a");
      const objUrl = URL.createObjectURL(blob);
      a.href = objUrl;
      a.download = dlName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objUrl);

      addAssistant(`✅ 已匯出 ${dlName}（含對話重點與引用來源）。`, []);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="h-[calc(100vh-4rem)] flex overflow-hidden"
      style={{ backgroundColor: "#f8fafc" }}
    >
      {/* Sidebar */}
      <aside
        className="w-80 border-r flex flex-col"
        style={{ borderColor: "rgba(15,23,42,0.08)", backgroundColor: "#ffffff" }}
      >
        <div className="px-4 pt-4 pb-3 border-b" style={{ borderColor: "rgba(15,23,42,0.08)" }}>
          <div className="flex items-center gap-2">
            <div
              className="h-9 w-9 rounded-full flex items-center justify-center font-bold text-white"
              style={{ background: "#0ea5e9" }}
            >
              G
            </div>
            <div>
              <div className="text-lg font-semibold">GalaBone</div>
              <div className="text-[11px] opacity-70">Your Bone We Care</div>
            </div>
          </div>

          <div className="mt-3 text-[12px]">
            S2X health:{" "}
            <span className={`font-semibold ${healthOk ? "text-emerald-600" : "text-red-600"}`}>
              {healthOk === null ? "checking..." : healthOk ? "OK" : "FAIL"}
            </span>
          </div>

          <div className="mt-3 space-y-2">
            <label className="flex flex-col gap-1 text-[12px]">
              <span className="text-slate-600">user_id（一般使用者預設 guest）</span>
              <input
                className="rounded-lg px-3 py-2 border outline-none"
                style={{ borderColor: "rgba(15,23,42,0.12)" }}
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
              />
            </label>

            <label className="flex flex-col gap-1 text-[12px]">
              <span className="text-slate-600">session_id（legacy 必填）</span>
              <input
                className="rounded-lg px-3 py-2 border outline-none"
                style={{ borderColor: "rgba(15,23,42,0.12)" }}
                value={sessionId}
                onChange={(e) => setSessionId(e.target.value)}
              />
            </label>

            <label className="flex flex-col gap-1 text-[12px]">
              <span className="text-slate-600">RAG 模式（不會建立索引）</span>
              <select
                className="rounded-lg px-3 py-2 border outline-none bg-white"
                style={{ borderColor: "rgba(15,23,42,0.12)" }}
                value={ragMode}
                onChange={(e) => setRagMode(e.target.value as RagMode)}
              >
                <option value="file_then_vector">先用上傳檔案 → 不足再查向量庫</option>
                <option value="vector_only">只查向量庫（你做好的教材庫）</option>
                <option value="file_only">只用上傳檔案（不查向量庫）</option>
              </select>
            </label>

            <div className="text-[11px] opacity-70">
              backend: <span className="font-mono">{API_BASE}</span>
              <br />
              s2x: <span className="font-mono">{S2X_BASE}</span>
            </div>
          </div>
        </div>

        <div className="px-4 py-3 border-b" style={{ borderColor: "rgba(15,23,42,0.08)" }}>
          <div className="text-[12px] font-semibold">工具</div>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.txt,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.csv,image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void uploadFile(f);
              }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="px-3 py-2 rounded-xl border text-[12px] font-semibold"
              style={{
                borderColor: "rgba(15,23,42,0.12)",
                backgroundColor: "rgba(148,163,184,0.12)",
              }}
              disabled={loading}
            >
              上傳檔案（不建索引）
            </button>

            <button
              type="button"
              onClick={() => void exportFile("pdf")}
              className="px-3 py-2 rounded-xl border text-[12px] font-semibold"
              style={{
                borderColor: "rgba(15,23,42,0.12)",
                backgroundColor: "rgba(99,102,241,0.14)",
              }}
              disabled={loading}
            >
              匯出 PDF
            </button>

            <button
              type="button"
              onClick={() => void exportFile("pptx")}
              className="px-3 py-2 rounded-xl border text-[12px] font-semibold"
              style={{
                borderColor: "rgba(15,23,42,0.12)",
                backgroundColor: "rgba(99,102,241,0.14)",
              }}
              disabled={loading}
            >
              匯出 PPTX
            </button>
          </div>

          <div className="mt-2 text-[11px] opacity-70">
            ⚠️ 這裡上傳的檔案只做「本次對話」摘要/解釋，不會寫入你的向量資料庫（不污染）。
          </div>

          {uploaded?.filename && (
            <div className="mt-2 text-[11px]">
              目前檔案：<span className="font-semibold">{uploaded.filename}</span>
            </div>
          )}
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {/* Header line */}
        <div className="px-6 pt-6 pb-3">
          <div className="flex items-center justify-between text-[12px] opacity-80">
            <div className="font-semibold">LLM Console（/s2x）</div>
            {errorMsg && (
              <div className="text-red-600 whitespace-pre-wrap max-w-[70%]">{errorMsg}</div>
            )}
          </div>
        </div>

        {/* Scroll area */}
        <div className="flex-1 min-h-0 overflow-y-auto px-6 pb-6">
          <div className="w-full max-w-3xl mx-auto space-y-4">
            {/* ✅ Detection Card (smaller) */}
            {seedImageUrl && (
              <DetectionViewer imageUrl={seedImageUrl} detections={seedDetections} />
            )}

            {/* Chat */}
            <div className="space-y-3">
              {messages.map((m) => {
                const isUser = m.role === "user";
                const bubbleBg = isUser ? "#0ea5e9" : "rgba(15,23,42,0.75)";
                const bubbleColor = "#ffffff";

                return (
                  <div key={m.id} className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
                    <div
                      className="max-w-[72%] rounded-2xl px-3 py-2 whitespace-pre-wrap break-words leading-relaxed"
                      style={{ backgroundColor: bubbleBg, color: bubbleColor }}
                    >
                      <div>{m.content}</div>
                      {!isUser && <EvidenceBlock evidence={m.evidence ?? []} />}
                    </div>
                  </div>
                );
              })}

              {loading && (
                <div className="flex justify-start">
                  <div
                    className="rounded-2xl px-3 py-2 text-[12px]"
                    style={{ backgroundColor: "rgba(15,23,42,0.65)", color: "#fff" }}
                  >
                    正在檢索與生成中…
                  </div>
                </div>
              )}

              <div ref={chatEndRef} />
            </div>
          </div>
        </div>

        {/* Input bar */}
        <div className="border-t px-6 py-3" style={{ borderColor: "rgba(15,23,42,0.10)" }}>
          <form onSubmit={sendMessage}>
            <div className="w-full max-w-3xl mx-auto flex items-end gap-3">
              <textarea
                ref={inputRef}
                value={input}
                onChange={onInputChange}
                onKeyDown={onKeyDown}
                placeholder={
                  uploaded?.filename
                    ? `提出問題…（可先用你上傳的檔案：${uploaded.filename}，也可切換向量庫 RAG）`
                    : "提出任何問題…（Enter 送出 / Shift+Enter 換行）"
                }
                className="flex-1 rounded-2xl border px-4 py-2 outline-none resize-none"
                style={{
                  borderColor: "rgba(15,23,42,0.12)",
                  backgroundColor: "#fff",
                  height: MIN_H,
                }}
                rows={1}
              />
              <button
                type="submit"
                disabled={!input.trim() || loading}
                className="h-11 px-5 rounded-2xl font-semibold text-white disabled:opacity-60"
                style={{ background: "linear-gradient(135deg,#0ea5e9,#22c55e)" }}
              >
                送出
              </button>
            </div>

            <div className="w-full max-w-3xl mx-auto mt-2 text-[11px] opacity-70">
              回覆若無 sources/citations，系統會提示「不主張有依據 RAG」。
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
