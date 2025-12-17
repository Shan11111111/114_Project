// llm/page.tsx
"use client";

import {
  FormEvent,
  KeyboardEvent,
  ChangeEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useSearchParams } from "next/navigation";

type BackendMsg = {
  role: "user" | "assistant";
  type: "text" | "image";
  content?: string | null;
  url?: string | null;
  filetype?: string | null;
};

type ChatMessage = {
  id: number;
  role: "user" | "assistant";
  type: "text" | "image";
  content?: string;
  url?: string | null;
  filetype?: string | null;
};

type Detection = {
  bone_id: number | null;
  bone_zh: string | null;
  bone_en: string | null;
  label41: string;
  confidence: number;
  bbox: [number, number, number, number]; // normalized 0~1 (x1,y1,x2,y2)
};

const MIN_HEIGHT = 28;
const MAX_HEIGHT = 120;

const API_BASE = (
  process.env.NEXT_PUBLIC_BACKEND_URL || "http://127.0.0.1:8000"
).replace(/\/+$/, "");

const CHAT_URL = `${API_BASE}/s2x/agent/chat`;
const BOOT_URL = `${API_BASE}/s2/agent/bootstrap-from-s1`;
const ENSURE_TITLE_URL = `${API_BASE}/s2/agent/ensure-title`;
const UPLOAD_URL = `${API_BASE}/s2x/upload`;
const MATERIAL_UPLOAD_URL = `${API_BASE}/s2/materials/upload`;

function toAbsoluteUrl(maybeUrl?: string | null) {
  if (!maybeUrl) return null;
  if (maybeUrl.startsWith("http://") || maybeUrl.startsWith("https://"))
    return maybeUrl;
  return `${API_BASE}${maybeUrl.startsWith("/") ? "" : "/"}${maybeUrl}`;
}

function isUUID(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    v.trim()
  );
}

// ✅ 去重 key（避免合併時重複堆疊）
function msgKey(m: {
  role: string;
  type: string;
  content?: string;
  url?: string | null;
}) {
  return `${m.role}|${m.type}|${(m.content ?? "").trim()}|${m.url ?? ""}`;
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

/**
 * ✅ 圖片工具列只保留：
 * - 大小縮放（- / +）=> 控制「顯示寬度 px」
 * - 偵測框 顯示/隱藏（眼睛 icon）
 */
function ImageDetectionViewer(props: {
  src: string;
  detections: Detection[];
  initialWidthPx?: number;
}) {
  const { src, detections, initialWidthPx = 426 } = props;

  const frameRef = useRef<HTMLDivElement | null>(null);

  const [widthPx, setWidthPx] = useState<number>(initialWidthPx);
  const [hideDetections, setHideDetections] = useState(false);

  const [frameSize, setFrameSize] = useState({ w: 0, h: 0 });

  const detCount = detections?.length ?? 0;

  const measure = () => {
    const el = frameRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setFrameSize({ w: rect.width, h: rect.height });
  };

  useEffect(() => {
    measure();
    const el = frameRef.current;
    if (!el) return;

    const ro = new ResizeObserver(() => measure());
    ro.observe(el);

    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    // widthPx 變化時也量一次
    measure();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [widthPx]);

  const pxFromNorm = (b: [number, number, number, number]) => {
    const [x1, y1, x2, y2] = b;
    const left = x1 * frameSize.w;
    const top = y1 * frameSize.h;
    const width = (x2 - x1) * frameSize.w;
    const height = (y2 - y1) * frameSize.h;
    return { left, top, width, height };
  };

  const zoomOut = () => setWidthPx((w) => clamp(w - 40, 260, 1000));
  const zoomIn = () => setWidthPx((w) => clamp(w + 40, 260, 1000));

  return (
    <div
      className="w-full rounded-2xl border p-3"
      style={{
        borderColor: "rgba(148,163,184,0.35)",
        backgroundColor: "rgba(2,132,199,0.12)",
      }}
    >
      {/* ✅ Header：寬度 + 偵測框數 + (- / +) + eye */}
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[12px] text-slate-100/90">
          <span>
            圖片寬度：<span className="font-mono">{Math.round(widthPx)}px</span>
          </span>
          <span>｜</span>
          <span>
            偵測框數：<span className="font-mono">{detCount}</span>
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* - */}
          <button
            type="button"
            onClick={zoomOut}
            className="h-9 w-9 rounded-xl border flex items-center justify-center"
            style={{
              borderColor: "rgba(255,255,255,0.35)",
              backgroundColor: "rgba(255,255,255,0.10)",
              color: "rgba(255,255,255,0.95)",
            }}
            title="縮小"
            aria-label="縮小"
          >
            <i className="fa-solid fa-minus" />
          </button>

          {/* + */}
          <button
            type="button"
            onClick={zoomIn}
            className="h-9 w-9 rounded-xl border flex items-center justify-center"
            style={{
              borderColor: "rgba(255,255,255,0.35)",
              backgroundColor: "rgba(255,255,255,0.10)",
              color: "rgba(255,255,255,0.95)",
            }}
            title="放大"
            aria-label="放大"
          >
            <i className="fa-solid fa-plus" />
          </button>

          {/* eye */}
          <button
            type="button"
            onClick={() => setHideDetections((v) => !v)}
            className="h-9 px-3 rounded-xl border flex items-center justify-center gap-2"
            style={{
              borderColor: hideDetections
                ? "rgba(99,102,241,0.85)"
                : "rgba(255,255,255,0.35)",
              backgroundColor: hideDetections
                ? "rgba(99,102,241,0.20)"
                : "rgba(255,255,255,0.10)",
              color: "rgba(255,255,255,0.95)",
            }}
            title={hideDetections ? "顯示偵測框" : "隱藏偵測框"}
            aria-label="隱藏/顯示偵測框"
          >
            <i
              className={
                hideDetections ? "fa-solid fa-eye-slash" : "fa-solid fa-eye"
              }
            />
            <span className="text-[12px] font-semibold">
              {hideDetections ? "顯示偵測框" : "隱藏偵測框"}
            </span>
          </button>
        </div>
      </div>

      {/* 圖片區：允許橫向捲動（寬度變大時） */}
      <div className="w-full overflow-x-auto">
        <div
          className="relative overflow-hidden rounded-2xl border"
          style={{
            width: `${widthPx}px`,
            borderColor: "rgba(255,255,255,0.18)",
            backgroundColor: "rgba(15,23,42,0.35)",
          }}
        >
          <div ref={frameRef} className="relative w-full">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={src}
              alt="image"
              className="block w-full h-auto select-none"
              draggable={false}
              onLoad={() => measure()}
            />

            {/* detections */}
            {!hideDetections &&
              (detections || []).map((d, idx) => {
                const { left, top, width, height } = pxFromNorm(d.bbox);
                const title =
                  (d.bone_zh && d.bone_zh.trim()) ||
                  (d.bone_en && d.bone_en.trim()) ||
                  `label41=${d.label41}`;
                const conf = Number.isFinite(d.confidence)
                  ? d.confidence.toFixed(3)
                  : String(d.confidence);

                return (
                  <div
                    key={`det-${idx}-${left}-${top}`}
                    className="absolute rounded-lg"
                    style={{
                      left,
                      top,
                      width,
                      height,
                      border: "3px solid rgba(56,189,248,0.85)",
                      boxShadow: "0 0 0 1px rgba(2,132,199,0.15) inset",
                      pointerEvents: "none",
                    }}
                  >
                    <div
                      className="absolute -top-7 left-0 px-2 py-1 rounded-lg text-[12px] font-semibold"
                      style={{
                        backgroundColor: "rgba(2,132,199,0.92)",
                        color: "white",
                        pointerEvents: "none",
                      }}
                    >
                      {title} {conf}
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      </div>

      <div className="mt-2 text-[12px] text-slate-100/80">
        Tip：偵測框座標是 0~1 normalized，縮放不會影響框位置。
      </div>
    </div>
  );
}

export default function LLMPage() {
  const searchParams = useSearchParams();

  const greeting: ChatMessage = useMemo(
    () => ({
      id: 1,
      role: "assistant",
      type: "text",
      content:
        "嗨，我是 GalaBone LLM。在這裡輸入你的問題，我會用教材（RAG）幫你解釋。",
    }),
    []
  );

  const [messages, setMessages] = useState<ChatMessage[]>([greeting]);
  const [input, setInput] = useState("");
  const [sessionId, setSessionId] = useState("test-1");
  const [loading, setLoading] = useState(false);

  const [showToolMenu, setShowToolMenu] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);

  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [uploadingImage, setUploadingImage] = useState(false);
  const [uploadingMaterial, setUploadingMaterial] = useState(false);

  // 教材欄位（保留）
  const [matTitle, setMatTitle] = useState("");
  const [matType, setMatType] = useState("pdf");
  const [matLanguage, setMatLanguage] = useState("zh-TW");
  const [matStyle, setMatStyle] = useState("edu");
  const [matUserId, setMatUserId] = useState("teacher01");
  const [matConversationId, setMatConversationId] = useState("");
  const [matBoneId, setMatBoneId] = useState<string>("");
  const [matBoneSmallId, setMatBoneSmallId] = useState<string>("");
  const [matStructureJson, setMatStructureJson] = useState("{}");

  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const materialInputRef = useRef<HTMLInputElement | null>(null);

  const msgSeqRef = useRef(1000);
  const nextId = () => {
    msgSeqRef.current += 1;
    return Date.now() + msgSeqRef.current;
  };

  const baseHeightRef = useRef<number | null>(null);
  const [isMultiLine, setIsMultiLine] = useState(false);
  const [inputBoxHeight, setInputBoxHeight] = useState(MIN_HEIGHT);

  const pinnedSeedRef = useRef<ChatMessage[]>([]);
  const hiddenMsgKeysRef = useRef<Set<string>>(new Set());

  // ✅ detections 依「abs image url」掛著，避免相對/絕對 key 對不起來
  const [detectionsByUrl, setDetectionsByUrl] = useState<
    Record<string, Detection[]>
  >({});

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
      if (baseHeightRef.current === null) {
        baseHeightRef.current = contentHeight;
      }
      const singleLineHeight = baseHeightRef.current;
      if (contentHeight > singleLineHeight + 2) {
        setIsMultiLine(true);
      }
      el.style.height = `${MIN_HEIGHT}px`;
      setInputBoxHeight(MIN_HEIGHT);
      return;
    }

    const newHeight = Math.min(contentHeight, MAX_HEIGHT);
    el.style.height = `${newHeight}px`;
    setInputBoxHeight(newHeight);
  }

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  useEffect(() => {
    autoResizeTextarea();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function mapBackendToUi(serverMsgs: BackendMsg[]) {
    return (serverMsgs || []).map((m) => {
      const absUrl = toAbsoluteUrl(m.url ?? null);
      return {
        id: nextId(),
        role: m.role,
        type: m.type,
        content: (m.content ?? "") as string,
        url: absUrl,
        filetype: m.filetype ?? null,
      } as ChatMessage;
    });
  }

  function applyBackendMessages(serverMsgs: BackendMsg[]) {
    const mapped = mapBackendToUi(serverMsgs);

    setMessages((prev) => {
      const pinned = pinnedSeedRef.current || [];
      const result: ChatMessage[] = [];
      const seen = new Set<string>();

      const pushIfOk = (m: ChatMessage) => {
        const k = msgKey(m);
        if (hiddenMsgKeysRef.current.has(k)) return;
        if (seen.has(k)) return;
        seen.add(k);
        result.push(m);
      };

      pushIfOk(greeting);
      for (const p of pinned) pushIfOk(p);
      for (const m of prev) pushIfOk(m);
      for (const m of mapped) pushIfOk(m);

      return result;
    });
  }

  async function postChatExplicit(
    session_id: string,
    batch: BackendMsg[],
    refreshUI: boolean
  ) {
    const payload = { session_id, messages: batch };

    const res = await fetch(CHAT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const ct = res.headers.get("content-type") || "";
    const raw = await res.text();

    if (!res.ok) throw new Error(`chat 失敗 ${res.status}：${raw.slice(0, 300)}`);
    if (!ct.includes("application/json"))
      throw new Error(`chat 回傳不是 JSON：${raw.slice(0, 200)}`);

    const data = JSON.parse(raw) as { messages: BackendMsg[]; actions?: any[] };
    if (refreshUI) applyBackendMessages(data.messages || []);
    return data.messages || [];
  }

  async function callChatOnce(userMsg: BackendMsg) {
    await postChatExplicit(sessionId, [userMsg], true);
  }

  async function ensureConversationTitle(
    conversation_id: string,
    image_case_id: number
  ) {
    const res = await fetch(ENSURE_TITLE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversation_id, image_case_id }),
    });

    const ct = res.headers.get("content-type") || "";
    const raw = await res.text();

    if (!res.ok) {
      throw new Error(`ensure-title 失敗 ${res.status}：${raw.slice(0, 200)}`);
    }
    if (!ct.includes("application/json")) {
      throw new Error(`ensure-title 回傳不是 JSON：${raw.slice(0, 200)}`);
    }
  }

  async function primeTitleByChat(session_id: string, caseId: number) {
    const shortTitle = `ImageCaseId: ${caseId} 辨識結果`;
    const trimmedShort = shortTitle.trim();

    const primeMsg: BackendMsg = {
      role: "user",
      type: "text",
      content: trimmedShort,
    };

    const allMsgs = await postChatExplicit(session_id, [primeMsg], false);

    hiddenMsgKeysRef.current.add(
      msgKey({ role: "user", type: "text", content: trimmedShort, url: null })
    );

    let lastUserIdx = -1;
    for (let i = 0; i < allMsgs.length; i++) {
      const m = allMsgs[i];
      if (
        m.role === "user" &&
        m.type === "text" &&
        ((m.content ?? "").trim() === trimmedShort)
      ) {
        lastUserIdx = i;
      }
    }

    const next = lastUserIdx >= 0 ? allMsgs[lastUserIdx + 1] : undefined;
    if (
      next &&
      next.role === "assistant" &&
      next.type === "text" &&
      ((next.content ?? "").trim().length > 0)
    ) {
      hiddenMsgKeysRef.current.add(
        msgKey({
          role: "assistant",
          type: "text",
          content: (next.content ?? "").trim(),
          url: null,
        })
      );
    }
  }

  async function seedToLegacyThenReply(
    session_id: string,
    seed_messages: BackendMsg[],
    caseId: number
  ) {
    const firstImageUrl =
      seed_messages?.find((m) => m.type === "image" && m.url)?.url ?? null;

    const safe = (seed_messages || []).filter((m) => m.type === "text");

    const fallbackAsk: BackendMsg = {
      role: "user",
      type: "text",
      content:
        `請根據 ImageCaseId=${caseId} 的偵測摘要，用衛教方式解釋偵測到的骨骼部位、可能的臨床意義，` +
        `並給我 3 個延伸提問。\n` +
        (firstImageUrl ? `（影像連結：${toAbsoluteUrl(firstImageUrl)}）` : ""),
    };

    if (safe.length === 0) {
      await postChatExplicit(session_id, [fallbackAsk], true);
      return;
    }

    const last = safe[safe.length - 1];
    const lastIsUserText =
      last.role === "user" &&
      last.type === "text" &&
      (last.content ?? "").trim().length > 0;

    const upto = lastIsUserText ? safe.length - 1 : safe.length;
    for (let i = 0; i < upto; i++) {
      await postChatExplicit(session_id, [safe[i]], false);
    }

    if (lastIsUserText) {
      await postChatExplicit(session_id, [last], true);
    } else {
      await postChatExplicit(session_id, [fallbackAsk], true);
    }
  }

  // ✅ /llm?caseId=XX 自動 bootstrap
  const bootOnceRef = useRef(false);
  useEffect(() => {
    const caseIdStr = searchParams.get("caseId");
    if (!caseIdStr) return;

    if (bootOnceRef.current) return;
    bootOnceRef.current = true;

    const caseId = Number(caseIdStr);
    if (!Number.isFinite(caseId) || caseId <= 0) {
      setErrorMsg(`caseId 不合法：${caseIdStr}`);
      return;
    }

    (async () => {
      setErrorMsg(null);
      setLoading(true);

      try {
        const r = await fetch(BOOT_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image_case_id: caseId }),
        });

        const rCt = r.headers.get("content-type") || "";
        const rRaw = await r.text();

        if (!r.ok) {
          throw new Error(`bootstrap 失敗 ${r.status}：${rRaw.slice(0, 300)}`);
        }
        if (!rCt.includes("application/json")) {
          throw new Error(`bootstrap 回傳不是 JSON：${rRaw.slice(0, 200)}`);
        }

        const boot = JSON.parse(rRaw) as {
          session_id: string;
          seed_messages: BackendMsg[];
          detections?: Detection[];
        };

        if (!boot?.session_id || !Array.isArray(boot.seed_messages)) {
          throw new Error(
            `bootstrap 回傳格式不對：${JSON.stringify(boot).slice(0, 200)}`
          );
        }

        setSessionId(boot.session_id);

        const seedUi = mapBackendToUi(boot.seed_messages);
        pinnedSeedRef.current = seedUi;
        setMessages([greeting, ...seedUi]);

        // ✅ detections 掛到 seed image（abs url）
        const seedImgRel =
          boot.seed_messages.find((m) => m.type === "image" && m.url)?.url ??
          null;
        const seedImgAbs = toAbsoluteUrl(seedImgRel);

        if (seedImgAbs) {
          setDetectionsByUrl((prev) => ({
            ...prev,
            [seedImgAbs]: Array.isArray(boot.detections) ? boot.detections : [],
          }));
        }

        try {
          await ensureConversationTitle(boot.session_id, caseId);
        } catch {
          try {
            await primeTitleByChat(boot.session_id, caseId);
          } catch (e2: any) {
            console.warn(e2);
            setErrorMsg(
              (prev) =>
                prev ?? `⚠️ ensure-title/prime 都失敗：${e2?.message ?? e2}`
            );
          }
        }

        await seedToLegacyThenReply(boot.session_id, boot.seed_messages, caseId);
      } catch (err: any) {
        console.error(err);
        setErrorMsg(err?.message ?? "自動帶入失敗");
      } finally {
        setLoading(false);
      }
    })();
  }, [searchParams, greeting]);

  async function sendMessage(e?: FormEvent) {
    if (e) e.preventDefault();
    const text = input.trim();
    if (!text || loading) return;

    if (!sessionId.trim()) {
      setErrorMsg("Session ID 不能是空的。");
      return;
    }

    setErrorMsg(null);

    const userLocal: ChatMessage = {
      id: nextId(),
      role: "user",
      type: "text",
      content: text,
    };

    setMessages((prev) => [...prev, userLocal]);
    setInput("");

    if (inputRef.current) {
      const el = inputRef.current;
      el.value = "";
      el.style.height = `${MIN_HEIGHT}px`;
      el.scrollTop = 0;
    }
    baseHeightRef.current = null;
    setIsMultiLine(false);
    setInputBoxHeight(MIN_HEIGHT);

    setLoading(true);

    try {
      await callChatOnce({ role: "user", type: "text", content: text });
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err?.message ?? "呼叫後端失敗");
      setMessages((prev) => [
        ...prev,
        {
          id: nextId(),
          role: "assistant",
          type: "text",
          content:
            "⚠️ 後端暫時沒回來。請確認：後端 8000 有開、/s2x/agent/chat 存在、CORS OK。",
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  function handleInputChange(e: ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value);
    autoResizeTextarea();
  }

  // 上傳圖片 → /upload → 送 chat（圖片通常沒 detections）
  async function handlePickAndSendImage(file: File) {
    setUploadingImage(true);
    setErrorMsg(null);

    try {
      const fd = new FormData();
      fd.append("file", file);

      const res = await fetch(UPLOAD_URL, { method: "POST", body: fd });
      const ct = res.headers.get("content-type") || "";
      const raw = await res.text();

      if (!res.ok)
        throw new Error(`上傳失敗 ${res.status}：${raw.slice(0, 200)}`);
      if (!ct.includes("application/json"))
        throw new Error(`上傳回傳非 JSON：${raw.slice(0, 200)}`);

      const data = JSON.parse(raw) as {
        url: string;
        filetype?: string;
        filename?: string;
      };

      const absUrl = toAbsoluteUrl(data.url) || null;

      setMessages((prev) => [
        ...prev,
        {
          id: nextId(),
          role: "user",
          type: "image",
          url: absUrl,
          filetype: data.filetype ?? null,
          content: "",
        },
      ]);

      if (absUrl) {
        setDetectionsByUrl((prev) => ({ ...prev, [absUrl]: prev[absUrl] ?? [] }));
      }

      setLoading(true);
      await callChatOnce({
        role: "user",
        type: "image",
        url: data.url,
        filetype: data.filetype ?? null,
        content: null,
      });
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err?.message ?? "圖片上傳/送出失敗");
    } finally {
      setUploadingImage(false);
      setLoading(false);
      setShowToolMenu(false);
      if (imageInputRef.current) imageInputRef.current.value = "";
    }
  }

  // 教材上傳（保留）
  async function handlePickAndUploadMaterial(file: File) {
    setUploadingMaterial(true);
    setErrorMsg(null);

    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("title", matTitle || file.name);
      fd.append("type", matType);
      fd.append("language", matLanguage);
      fd.append("style", matStyle);
      fd.append("user_id", matUserId);

      if (matConversationId.trim() && isUUID(matConversationId)) {
        fd.append("conversation_id", matConversationId.trim());
      }
      if (matBoneId.trim()) fd.append("bone_id", matBoneId.trim());
      if (matBoneSmallId.trim()) fd.append("bone_small_id", matBoneSmallId.trim());
      fd.append("structure_json", matStructureJson || "{}");

      const res = await fetch(MATERIAL_UPLOAD_URL, { method: "POST", body: fd });
      const ct = res.headers.get("content-type") || "";
      const raw = await res.text();

      if (!res.ok)
        throw new Error(`教材上傳失敗 ${res.status}：${raw.slice(0, 250)}`);
      if (!ct.includes("application/json"))
        throw new Error(`教材回傳非 JSON：${raw.slice(0, 200)}`);

      const data = JSON.parse(raw) as { material_id: string; file_path: string };

      setMessages((prev) => [
        ...prev,
        {
          id: nextId(),
          role: "assistant",
          type: "text",
          content: `✅ 教材已上傳並寫入資料庫：${data.material_id}\n（檔案：${data.file_path}）\n你現在可以直接問它內容，RAG 會去檢索。`,
        },
      ]);
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err?.message ?? "教材上傳失敗");
      setMessages((prev) => [
        ...prev,
        {
          id: nextId(),
          role: "assistant",
          type: "text",
          content:
            "⚠️ 教材上傳失敗。請確認：/s2/materials/upload 有掛、後端有權限寫檔、DB agent.TeachingMaterial 可寫入。",
        },
      ]);
    } finally {
      setUploadingMaterial(false);
      setShowToolMenu(false);
      if (materialInputRef.current) materialInputRef.current.value = "";
    }
  }

  function handleExport(type: "pdf" | "ppt") {
    setShowExportMenu(false);
    console.log("export:", type);
  }

  return (
    <div
      className="h-[calc(100vh-4rem)] flex overflow-hidden"
      style={{
        backgroundColor: "var(--background)",
        color: "var(--foreground)",
      }}
    >
      {/* 左側導覽列 */}
      <aside
        className="w-64 border-r flex flex-col"
        style={{
          backgroundColor: "var(--background)",
          borderColor: "var(--navbar-border)",
          color: "var(--navbar-text)",
        }}
      >
        <div
          className="px-4 pt-4 pb-3 border-b flex flex-col gap-3"
          style={{ borderColor: "var(--navbar-border)" }}
        >
          <div>
            <h1 className="text-lg font-semibold tracking-wide">GalaBone</h1>
            <p className="text-[11px] mt-1 opacity-70">Your Bone We Care</p>
          </div>

          <label className="flex flex-col gap-1 text-[11px] opacity-80">
            <span>Session ID</span>
            <input
              className="rounded-md px-2 py-[4px] text-[11px] outline-none border"
              style={{
                backgroundColor: "var(--background)",
                color: "var(--foreground)",
                borderColor: "var(--navbar-border)",
              }}
              value={sessionId}
              onChange={(e) => setSessionId(e.target.value)}
            />
          </label>

          <div className="text-[11px] opacity-70">
            backend: <span className="font-mono">{API_BASE}</span>
          </div>
        </div>

        <nav className="flex-1 px-2 pt-4 pb-2 space-y-4 text-sm">
          <div>
            <p className="px-3 mb-1 text-[11px] tracking-wide opacity-60">
              工作區
            </p>
            <button
              className="w-full flex items-center gap-3 px-3 py-2 rounded-md"
              style={{ backgroundColor: "rgba(148,163,184,0.15)" }}
            >
              <i className="fa-regular fa-message text-[13px]" />
              <span>LLM Console</span>
            </button>
          </div>

          <div>
            <p className="px-3 mb-1 text-[11px] tracking-wide opacity-60">
              工具與管理
            </p>
            <button className="w-full flex items-center gap-3 px-3 py-2 rounded-md hover:bg-slate-800/10">
              <i className="fa-solid fa-wand-magic-sparkles text-[13px]" />
              <span>EduGen</span>
            </button>
            <button className="w-full flex items-center gap-3 px-3 py-2 rounded-md hover:bg-slate-800/10">
              <i className="fa-solid fa-folder-tree text-[13px]" />
              <span>資源管理</span>
            </button>
            <button className="w-full flex items-center gap-3 px-3 py-2 rounded-md hover:bg-slate-800/10">
              <i className="fa-regular fa-clock text-[13px]" />
              <span>對話紀錄</span>
            </button>
          </div>
        </nav>

        <div
          className="px-4 py-3 flex items-center gap-2 text-[11px] opacity-70 border-t"
          style={{ borderColor: "var(--navbar-border)" }}
        >
          <i className="fa-solid fa-gear text-[11px]" />
          <span>設定</span>
        </div>
      </aside>

      {/* 右側主畫面 */}
      <div className="flex-1 min-h-0 flex flex-col px-6 py-6 gap-4 overflow-hidden">
        <section className="flex-1 min-h-0 flex flex-col relative">
          <div className="flex items-center justify-between mb-2 text-xs opacity-70 px-1">
            <span>LLM Console（已接 S2 後端）</span>
            {errorMsg && (
              <span className="text-red-400 whitespace-pre-wrap">{errorMsg}</span>
            )}
          </div>

          {/* 聊天訊息列表 */}
          <div
            className="chat-scroll flex-1 min-h-0 overflow-y-auto space-y-3 pr-1 text-sm break-words"
            style={{ paddingBottom: inputBoxHeight + 40 }}
          >
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex ${
                  msg.role === "user" ? "justify-end" : "justify-start"
                }`}
              >
                <div
                  className={`max-w-[90%] rounded-2xl px-3 py-2 whitespace-pre-wrap break-words leading-relaxed
                    ${
                      msg.role === "user"
                        ? "bg-sky-500 text-white rounded-br-sm"
                        : "bg-slate-800/70 text-slate-50 rounded-bl-sm"
                    }`}
                >
                  {msg.type === "image" && msg.url ? (
                    <ImageDetectionViewer
                      src={msg.url}
                      detections={detectionsByUrl[msg.url] ?? []}
                      initialWidthPx={426}
                    />
                  ) : (
                    msg.content
                  )}
                </div>
              </div>
            ))}

            {loading && (
              <div className="flex justify-start">
                <div className="bg-slate-800/80 text-slate-200 text-xs rounded-2xl rounded-bl-sm px-3 py-2">
                  正在思考中…
                </div>
              </div>
            )}

            <div ref={chatEndRef} />
          </div>

          {/* 底部輸入列 */}
          <div
            className="sticky bottom-0 left-0 right-0 pt-3 pb-4"
            style={{ backgroundColor: "var(--background)" }}
          >
            <form onSubmit={sendMessage}>
              <div className="w-full flex justify-center">
                <div className="flex items-end gap-3 w-full max-w-3xl">
                  <div className="flex-1 relative">
                    <div
                      className={`
                        border px-4 py-2 shadow-lg backdrop-blur-sm
                        ${isMultiLine ? "rounded-2xl" : "rounded-full"}
                      `}
                      style={{
                        backgroundColor: "var(--navbar-bg)",
                        borderColor: "var(--navbar-border)",
                        color: "var(--foreground)",
                      }}
                    >
                      <div className="flex flex-col gap-2">
                        <div className={isMultiLine ? "" : "flex items-end gap-3"}>
                          {!isMultiLine && (
                            <button
                              type="button"
                              onClick={() => setShowToolMenu((v) => !v)}
                              className="self-end text-2xl pb-[2px]"
                              style={{ color: "var(--foreground)" }}
                            >
                              +
                            </button>
                          )}

                          <textarea
                            ref={inputRef}
                            value={input}
                            onChange={handleInputChange}
                            onKeyDown={handleKeyDown}
                            placeholder="提出任何問題⋯"
                            rows={1}
                            className={`
                              custom-scroll bg-transparent resize-none border-none outline-none
                              text-sm leading-relaxed overflow-hidden placeholder:text-slate-500
                              ${isMultiLine ? "w-full" : "flex-1 self-end"}
                            `}
                            style={{
                              color: "var(--foreground)",
                              caretColor: "var(--foreground)",
                            }}
                          />

                          {!isMultiLine && (
                            <div className="flex items-end gap-3 self-end">
                              <span className="text-[10px] text-emerald-400 pb-[3px]">
                                ●
                              </span>
                              <button
                                type="submit"
                                disabled={!input.trim() || loading}
                                className="h-7 w-7 rounded-full flex items-center justify-center text-white text-sm font-semibold disabled:opacity-60"
                                style={{
                                  background:
                                    "linear-gradient(135deg,#0ea5e9,#22c55e)",
                                  boxShadow:
                                    "0 10px 25px rgba(56,189,248,0.45)",
                                }}
                              >
                                {loading ? "…" : (
                                  <i className="fa-solid fa-arrow-up text-[13px]" />
                                )}
                              </button>
                            </div>
                          )}
                        </div>

                        {isMultiLine && (
                          <div className="flex items-center justify-between">
                            <button
                              type="button"
                              onClick={() => setShowToolMenu((v) => !v)}
                              className="text-2xl"
                              style={{ color: "var(--foreground)" }}
                            >
                              +
                            </button>

                            <div className="flex items-center gap-3">
                              <span className="text-[10px] text-emerald-400">
                                ●
                              </span>
                              <button
                                type="submit"
                                disabled={!input.trim() || loading}
                                className="h-7 w-7 rounded-full flex items-center justify-center text-white text-sm font-semibold disabled:opacity-60"
                                style={{
                                  background:
                                    "linear-gradient(135deg,#0ea5e9,#22c55e)",
                                  boxShadow:
                                    "0 10px 25px rgba(56,189,248,0.45)",
                                }}
                              >
                                {loading ? "…" : (
                                  <i className="fa-solid fa-arrow-up text-[13px]" />
                                )}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* 工具選單（保留 upload） */}
                    {showToolMenu && (
                      <div
                        className="absolute left-0 right-0 bottom-full mb-2 rounded-2xl border shadow-xl p-3 z-30"
                        style={{
                          backgroundColor: "var(--background)",
                          borderColor: "var(--navbar-border)",
                          color: "var(--foreground)",
                          boxShadow: "0 18px 40px rgba(15,23,42,0.18)",
                        }}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <div className="text-xs font-semibold opacity-80">
                            工具
                          </div>
                          <button
                            type="button"
                            className="text-xs opacity-70 hover:opacity-100"
                            onClick={() => setShowToolMenu(false)}
                          >
                            關閉
                          </button>
                        </div>

                        {/* 圖片上傳 */}
                        <div className="flex items-center gap-2 mb-3">
                          <input
                            ref={imageInputRef}
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              if (f) handlePickAndSendImage(f);
                            }}
                          />
                          <button
                            type="button"
                            disabled={uploadingImage}
                            className="px-3 py-2 rounded-xl text-xs font-semibold border"
                            style={{
                              borderColor: "var(--navbar-border)",
                              backgroundColor: "rgba(148,163,184,0.12)",
                            }}
                            onClick={() => imageInputRef.current?.click()}
                          >
                            {uploadingImage ? "圖片上傳中…" : "上傳圖片並分析"}
                          </button>

                          <div className="text-[11px] opacity-70">
                            （會先走 /upload，再送 image 到 chat）
                          </div>
                        </div>

                        {/* 教材上傳（保留） */}
                        <div
                          className="border-t pt-3"
                          style={{ borderColor: "var(--navbar-border)" }}
                        >
                          <div className="text-xs font-semibold opacity-80 mb-2">
                            教材上傳（RAG）
                          </div>

                          <div className="grid grid-cols-2 gap-2 text-[11px]">
                            <label className="flex flex-col gap-1">
                              <span className="opacity-70">title</span>
                              <input
                                className="rounded-lg px-2 py-1 border outline-none"
                                style={{
                                  backgroundColor: "var(--background)",
                                  color: "var(--foreground)",
                                  borderColor: "var(--navbar-border)",
                                }}
                                value={matTitle}
                                onChange={(e) => setMatTitle(e.target.value)}
                                placeholder="不填就用檔名"
                              />
                            </label>

                            <label className="flex flex-col gap-1">
                              <span className="opacity-70">user_id</span>
                              <input
                                className="rounded-lg px-2 py-1 border outline-none"
                                style={{
                                  backgroundColor: "var(--background)",
                                  color: "var(--foreground)",
                                  borderColor: "var(--navbar-border)",
                                }}
                                value={matUserId}
                                onChange={(e) => setMatUserId(e.target.value)}
                              />
                            </label>

                            <label className="flex flex-col gap-1">
                              <span className="opacity-70">type</span>
                              <input
                                className="rounded-lg px-2 py-1 border outline-none"
                                style={{
                                  backgroundColor: "var(--background)",
                                  color: "var(--foreground)",
                                  borderColor: "var(--navbar-border)",
                                }}
                                value={matType}
                                onChange={(e) => setMatType(e.target.value)}
                              />
                            </label>

                            <label className="flex flex-col gap-1">
                              <span className="opacity-70">language</span>
                              <input
                                className="rounded-lg px-2 py-1 border outline-none"
                                style={{
                                  backgroundColor: "var(--background)",
                                  color: "var(--foreground)",
                                  borderColor: "var(--navbar-border)",
                                }}
                                value={matLanguage}
                                onChange={(e) => setMatLanguage(e.target.value)}
                              />
                            </label>

                            <label className="flex flex-col gap-1">
                              <span className="opacity-70">style</span>
                              <input
                                className="rounded-lg px-2 py-1 border outline-none"
                                style={{
                                  backgroundColor: "var(--background)",
                                  color: "var(--foreground)",
                                  borderColor: "var(--navbar-border)",
                                }}
                                value={matStyle}
                                onChange={(e) => setMatStyle(e.target.value)}
                              />
                            </label>

                            <label className="flex flex-col gap-1">
                              <span className="opacity-70">
                                conversation_id (UUID 可選)
                              </span>
                              <input
                                className="rounded-lg px-2 py-1 border outline-none"
                                style={{
                                  backgroundColor: "var(--background)",
                                  color: "var(--foreground)",
                                  borderColor: "var(--navbar-border)",
                                }}
                                value={matConversationId}
                                onChange={(e) =>
                                  setMatConversationId(e.target.value)
                                }
                                placeholder="留空就 NULL"
                              />
                            </label>

                            <label className="flex flex-col gap-1">
                              <span className="opacity-70">bone_id (可選)</span>
                              <input
                                className="rounded-lg px-2 py-1 border outline-none"
                                style={{
                                  backgroundColor: "var(--background)",
                                  color: "var(--foreground)",
                                  borderColor: "var(--navbar-border)",
                                }}
                                value={matBoneId}
                                onChange={(e) => setMatBoneId(e.target.value)}
                                placeholder="例如 8"
                              />
                            </label>

                            <label className="flex flex-col gap-1">
                              <span className="opacity-70">
                                bone_small_id (可選)
                              </span>
                              <input
                                className="rounded-lg px-2 py-1 border outline-none"
                                style={{
                                  backgroundColor: "var(--background)",
                                  color: "var(--foreground)",
                                  borderColor: "var(--navbar-border)",
                                }}
                                value={matBoneSmallId}
                                onChange={(e) =>
                                  setMatBoneSmallId(e.target.value)
                                }
                                placeholder="例如 206"
                              />
                            </label>
                          </div>

                          <label className="flex flex-col gap-1 mt-2 text-[11px]">
                            <span className="opacity-70">
                              structure_json（可選）
                            </span>
                            <textarea
                              className="rounded-lg px-2 py-1 border outline-none"
                              style={{
                                backgroundColor: "var(--background)",
                                color: "var(--foreground)",
                                borderColor: "var(--navbar-border)",
                              }}
                              rows={2}
                              value={matStructureJson}
                              onChange={(e) =>
                                setMatStructureJson(e.target.value)
                              }
                            />
                          </label>

                          <div className="flex items-center gap-2 mt-3">
                            <input
                              ref={materialInputRef}
                              type="file"
                              accept=".pdf,.txt,.docx,.pptx,.xlsx,.xls"
                              className="hidden"
                              onChange={(e) => {
                                const f = e.target.files?.[0];
                                if (f) handlePickAndUploadMaterial(f);
                              }}
                            />
                            <button
                              type="button"
                              disabled={uploadingMaterial}
                              className="px-3 py-2 rounded-xl text-xs font-semibold border"
                              style={{
                                borderColor: "var(--navbar-border)",
                                backgroundColor: "rgba(99,102,241,0.14)",
                              }}
                              onClick={() => materialInputRef.current?.click()}
                            >
                              {uploadingMaterial
                                ? "教材上傳中…"
                                : "選擇教材並上傳"}
                            </button>

                            <div className="text-[11px] opacity-70">
                              ⚠️ 你目前後端會「上傳即建索引」。
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* 匯出 */}
                  <div className="relative self-end">
                    <button
                      type="button"
                      onClick={() => setShowExportMenu((v) => !v)}
                      className="px-4 py-2 rounded-full text-xs font-semibold flex items-center gap-1"
                      style={{
                        backgroundColor: "#6366f1",
                        color: "#ffffff",
                        border: "2px solid #0f172a",
                        boxShadow: "0 18px 40px rgba(15,23,42,0.35)",
                      }}
                    >
                      匯出
                      <span className="text-[10px]">
                        {showExportMenu ? "▴" : "▾"}
                      </span>
                    </button>

                    {showExportMenu && (
                      <div
                        className="absolute right-0 bottom-full mb-2 w-32 rounded-xl shadow-xl text-xs overflow-hidden z-20 border"
                        style={{
                          backgroundColor: "var(--background)",
                          borderColor: "var(--navbar-border)",
                          color: "var(--foreground)",
                          boxShadow: "0 18px 40px rgba(15,23,42,0.2)",
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => handleExport("pdf")}
                          className="w-full text-left px-3 py-2"
                        >
                          匯出 PDF
                        </button>
                        <button
                          type="button"
                          onClick={() => handleExport("ppt")}
                          className="w-full text-left px-3 py-2"
                        >
                          匯出 PPT
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </form>
          </div>
        </section>
      </div>
    </div>
  );
}
