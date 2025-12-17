// // llm/LLMClient.tsx
// "use client";

// import React, {
//   FormEvent,
//   KeyboardEvent,
//   ChangeEvent,
//   useEffect,
//   useMemo,
//   useRef,
//   useState,
// } from "react";
// import { useSearchParams } from "next/navigation";
// import { NextRequest } from "next/server";
// import { NextResponse } from "next/server";

// type BackendMsg = {
//   role: "user" | "assistant";
//   type: "text" | "image";
//   content?: string | null;
//   url?: string | null;
//   filetype?: string | null;
// };

// type ChatMessage = {
//   id: number;
//   role: "user" | "assistant";
//   type: "text" | "image";
//   content?: string;
//   url?: string | null;
//   filetype?: string | null;
// };

// type Detection = {
//   bone_id: number | null;
//   bone_zh: string | null;
//   bone_en: string | null;
//   label41: string;
//   confidence: number;
//   bbox: [number, number, number, number]; // normalized 0~1 (x1,y1,x2,y2)
// };

// const MIN_HEIGHT = 28;
// const MAX_HEIGHT = 120;

// const API_BASE = (
//   process.env.NEXT_PUBLIC_BACKEND_URL || "http://127.0.0.1:8000"
// ).replace(/\/+$/, "");

// const CHAT_URL = `${API_BASE}/s2x/agent/chat`;
// const BOOT_URL = `${API_BASE}/s2/agent/bootstrap-from-s1`;
// const ENSURE_TITLE_URL = `${API_BASE}/s2/agent/ensure-title`;
// // const UPLOAD_URL = `${API_BASE}/s2x/upload`;
// const UPLOAD_URL = `/api/upload`;

// const MATERIAL_UPLOAD_URL = `${API_BASE}/s2/materials/upload`;

// function toAbsoluteUrl(maybeUrl?: string | null) {
//   if (!maybeUrl) return null;
//   if (maybeUrl.startsWith("http://") || maybeUrl.startsWith("https://"))
//     return maybeUrl;
//   return `${API_BASE}${maybeUrl.startsWith("/") ? "" : "/"}${maybeUrl}`;
// }

// function isUUID(v: string) {
//   return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
//     v.trim()
//   );
// }

// // ✅ 去重 key（避免合併時重複堆疊）
// function msgKey(m: {
//   role: string;
//   type: string;
//   content?: string;
//   url?: string | null;
// }) {
//   return `${m.role}|${m.type}|${(m.content ?? "").trim()}|${m.url ?? ""}`;
// }

// function clamp(n: number, min: number, max: number) {
//   return Math.max(min, Math.min(max, n));
// }

// function ImageDetectionViewer(props: {
//   src: string;
//   detections: Detection[];
//   initialWidthPx?: number;
// }) {
//   const { src, detections, initialWidthPx = 426 } = props;

//   const frameRef = useRef<HTMLDivElement | null>(null);

//   const [widthPx, setWidthPx] = useState<number>(initialWidthPx);
//   const [hideDetections, setHideDetections] = useState(false);

//   const [frameSize, setFrameSize] = useState({ w: 0, h: 0 });

//   const detCount = detections?.length ?? 0;

//   const measure = () => {
//     const el = frameRef.current;
//     if (!el) return;
//     const rect = el.getBoundingClientRect();
//     setFrameSize({ w: rect.width, h: rect.height });
//   };

//   useEffect(() => {
//     measure();
//     const el = frameRef.current;
//     if (!el) return;

//     const ro = new ResizeObserver(() => measure());
//     ro.observe(el);

//     return () => ro.disconnect();
//   }, []);

//   useEffect(() => {
//     // widthPx 變化時也量一次
//     measure();
//     // eslint-disable-next-line react-hooks/exhaustive-deps
//   }, [widthPx]);

//   const pxFromNorm = (b: [number, number, number, number]) => {
//     const [x1, y1, x2, y2] = b;
//     const left = x1 * frameSize.w;
//     const top = y1 * frameSize.h;
//     const width = (x2 - x1) * frameSize.w;
//     const height = (y2 - y1) * frameSize.h;
//     return { left, top, width, height };
//   };

//   const zoomOut = () => setWidthPx((w) => clamp(w - 40, 260, 1000));
//   const zoomIn = () => setWidthPx((w) => clamp(w + 40, 260, 1000));

//   return (
//     <div
//       className="w-full rounded-2xl border p-3"
//       style={{
//         borderColor: "rgba(148,163,184,0.35)",
//         backgroundColor: "rgba(2,132,199,0.12)",
//       }}
//     >
//       <div className="mb-2 flex items-center justify-between gap-2">
//         <div className="flex items-center gap-2 text-[12px] text-slate-100/90">
//           <span>
//             圖片寬度：<span className="font-mono">{Math.round(widthPx)}px</span>
//           </span>
//           <span>｜</span>
//           <span>
//             偵測框數：<span className="font-mono">{detCount}</span>
//           </span>
//         </div>

//         <div className="flex items-center gap-2">
//           <button
//             type="button"
//             onClick={zoomOut}
//             className="h-9 w-9 rounded-xl border flex items-center justify-center"
//             style={{
//               borderColor: "rgba(255,255,255,0.35)",
//               backgroundColor: "rgba(255,255,255,0.10)",
//               color: "rgba(255,255,255,0.95)",
//             }}
//             title="縮小"
//             aria-label="縮小"
//           >
//             <i className="fa-solid fa-minus" />
//           </button>

//           <button
//             type="button"
//             onClick={zoomIn}
//             className="h-9 w-9 rounded-xl border flex items-center justify-center"
//             style={{
//               borderColor: "rgba(255,255,255,0.35)",
//               backgroundColor: "rgba(255,255,255,0.10)",
//               color: "rgba(255,255,255,0.95)",
//             }}
//             title="放大"
//             aria-label="放大"
//           >
//             <i className="fa-solid fa-plus" />
//           </button>

//           <button
//             type="button"
//             onClick={() => setHideDetections((v) => !v)}
//             className="h-9 px-3 rounded-xl border flex items-center justify-center gap-2"
//             style={{
//               borderColor: hideDetections
//                 ? "rgba(99,102,241,0.85)"
//                 : "rgba(255,255,255,0.35)",
//               backgroundColor: hideDetections
//                 ? "rgba(99,102,241,0.20)"
//                 : "rgba(255,255,255,0.10)",
//               color: "rgba(255,255,255,0.95)",
//             }}
//             title={hideDetections ? "顯示偵測框" : "隱藏偵測框"}
//             aria-label="隱藏/顯示偵測框"
//           >
//             <i
//               className={
//                 hideDetections ? "fa-solid fa-eye-slash" : "fa-solid fa-eye"
//               }
//             />
//             <span className="text-[12px] font-semibold">
//               {hideDetections ? "顯示偵測框" : "隱藏偵測框"}
//             </span>
//           </button>
//         </div>
//       </div>

//       <div className="w-full overflow-x-auto">
//         <div
//           className="relative overflow-hidden rounded-2xl border"
//           style={{
//             width: `${widthPx}px`,
//             borderColor: "rgba(255,255,255,0.18)",
//             backgroundColor: "rgba(15,23,42,0.35)",
//           }}
//         >
//           <div ref={frameRef} className="relative w-full">
//             {/* eslint-disable-next-line @next/next/no-img-element */}
//             <img
//               src={src}
//               alt="image"
//               className="block w-full h-auto select-none"
//               draggable={false}
//               onLoad={() => measure()}
//             />

//             {!hideDetections &&
//               (detections || []).map((d, idx) => {
//                 const { left, top, width, height } = pxFromNorm(d.bbox);
//                 const title =
//                   (d.bone_zh && d.bone_zh.trim()) ||
//                   (d.bone_en && d.bone_en.trim()) ||
//                   `label41=${d.label41}`;
//                 const conf = Number.isFinite(d.confidence)
//                   ? d.confidence.toFixed(3)
//                   : String(d.confidence);

//                 return (
//                   <div
//                     key={`det-${idx}-${left}-${top}`}
//                     className="absolute rounded-lg"
//                     style={{
//                       left,
//                       top,
//                       width,
//                       height,
//                       border: "3px solid rgba(56,189,248,0.85)",
//                       boxShadow: "0 0 0 1px rgba(2,132,199,0.15) inset",
//                       pointerEvents: "none",
//                     }}
//                   >
//                     <div
//                       className="absolute -top-7 left-0 px-2 py-1 rounded-lg text-[12px] font-semibold"
//                       style={{
//                         backgroundColor: "rgba(2,132,199,0.92)",
//                         color: "white",
//                         pointerEvents: "none",
//                       }}
//                     >
//                       {title} {conf}
//                     </div>
//                   </div>
//                 );
//               })}
//           </div>
//         </div>
//       </div>

//       <div className="mt-2 text-[12px] text-slate-100/80">
//         Tip：偵測框座標是 0~1 normalized，縮放不會影響框位置。
//       </div>
//     </div>
//   );
// }

// export default function LLMPage() {
//   const searchParams = useSearchParams();

//   const greeting: ChatMessage = useMemo(
//     () => ({
//       id: 1,
//       role: "assistant",
//       type: "text",
//       content:
//         "嗨，我是 GalaBone LLM。在這裡輸入你的問題，我會用教材（RAG）幫你解釋。",
//     }),
//     []
//   );

//   const [messages, setMessages] = useState<ChatMessage[]>([greeting]);
//   const [input, setInput] = useState("");
//   const [sessionId, setSessionId] = useState("test-1");
//   const [loading, setLoading] = useState(false);

//   const [showToolMenu, setShowToolMenu] = useState(false);
//   const [showExportMenu, setShowExportMenu] = useState(false);

//   const [errorMsg, setErrorMsg] = useState<string | null>(null);

//   const [uploadingImage, setUploadingImage] = useState(false);
//   const [uploadingMaterial, setUploadingMaterial] = useState(false);

//   // 教材欄位（保留）
//   const [matTitle, setMatTitle] = useState("");
//   const [matType, setMatType] = useState("pdf");
//   const [matLanguage, setMatLanguage] = useState("zh-TW");
//   const [matStyle, setMatStyle] = useState("edu");
//   const [matUserId, setMatUserId] = useState("teacher01");
//   const [matConversationId, setMatConversationId] = useState("");
//   const [matBoneId, setMatBoneId] = useState<string>("");
//   const [matBoneSmallId, setMatBoneSmallId] = useState<string>("");
//   const [matStructureJson, setMatStructureJson] = useState("{}");

//   const chatEndRef = useRef<HTMLDivElement | null>(null);
//   const inputRef = useRef<HTMLTextAreaElement | null>(null);

//   const imageInputRef = useRef<HTMLInputElement | null>(null);
//   const materialInputRef = useRef<HTMLInputElement | null>(null);

//   const msgSeqRef = useRef(1000);
//   const nextId = () => {
//     msgSeqRef.current += 1;
//     return Date.now() + msgSeqRef.current;
//   };

//   const baseHeightRef = useRef<number | null>(null);
//   const [isMultiLine, setIsMultiLine] = useState(false);
//   const [inputBoxHeight, setInputBoxHeight] = useState(MIN_HEIGHT);

//   const pinnedSeedRef = useRef<ChatMessage[]>([]);
//   const hiddenMsgKeysRef = useRef<Set<string>>(new Set());

//   // ✅ detections 依「abs image url」掛著，避免相對/絕對 key 對不起來
//   const [detectionsByUrl, setDetectionsByUrl] = useState<
//     Record<string, Detection[]>
//   >({});

//   function autoResizeTextarea() {
//     const el = inputRef.current;
//     if (!el) return;

//     const text = el.value;

//     if (text.trim().length === 0) {
//       baseHeightRef.current = null;
//       el.style.height = `${MIN_HEIGHT}px`;
//       setIsMultiLine(false);
//       setInputBoxHeight(MIN_HEIGHT);
//       return;
//     }

//     el.style.height = "auto";
//     const contentHeight = el.scrollHeight;

//     if (!isMultiLine) {
//       if (baseHeightRef.current === null) {
//         baseHeightRef.current = contentHeight;
//       }
//       const singleLineHeight = baseHeightRef.current;
//       if (contentHeight > singleLineHeight + 2) {
//         setIsMultiLine(true);
//       }
//       el.style.height = `${MIN_HEIGHT}px`;
//       setInputBoxHeight(MIN_HEIGHT);
//       return;
//     }

//     const newHeight = Math.min(contentHeight, MAX_HEIGHT);
//     el.style.height = `${newHeight}px`;
//     setInputBoxHeight(newHeight);
//   }

//   useEffect(() => {
//     chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
//   }, [messages, loading]);

//   useEffect(() => {
//     autoResizeTextarea();
//     // eslint-disable-next-line react-hooks/exhaustive-deps
//   }, []);

//   function mapBackendToUi(serverMsgs: BackendMsg[]) {
//     return (serverMsgs || []).map((m) => {
//       const absUrl = toAbsoluteUrl(m.url ?? null);
//       return {
//         id: nextId(),
//         role: m.role,
//         type: m.type,
//         content: (m.content ?? "") as string,
//         url: absUrl,
//         filetype: m.filetype ?? null,
//       } as ChatMessage;
//     });
//   }





