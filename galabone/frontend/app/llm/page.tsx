"use client";

import {
  FormEvent,
  KeyboardEvent,
  ChangeEvent,
  useEffect,
  useRef,
  useState,
  useMemo,
} from "react";

type UploadedFile = {
  id: string;
  name: string;
  size: number;
  type: string;
  url: string;
};

type ChatMessage = {
  id: number;
  role: "user" | "assistant";
  content: string;
  files?: UploadedFile[];
};

type ViewKey = "llm" | "edugen" | "assets";

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

export default function LLMPage() {
  // ===== navbar 狀態 =====
  const [isNavCollapsed, setIsNavCollapsed] = useState(false);
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);

  // ✅ 目前頁面
  const [activeView, setActiveView] = useState<ViewKey>("llm");

  // ✅ History overlay（像 GPT）
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [historyQuery, setHistoryQuery] = useState("");
  const [isComposingHistory, setIsComposingHistory] = useState(false);

  // ✅ 非受控 input 用 ref（避免 IME 被受控 value 打斷）
  const historyInputRef = useRef<HTMLInputElement | null>(null);

  // ===== chat 狀態 =====
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 1,
      role: "assistant",
      content:
        "嗨，我是 GalaBone LLM Demo。在這裡輸入你的問題，我會用骨科知識與多模態概念幫你解釋。",
    },
  ]);
  const [input, setInput] = useState("");
  const [sessionId, setSessionId] = useState("test-1");
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

  // ✅ 假的 thread 清單（之後換 DB 就換這裡）
  const [historyThreads] = useState<HistoryThread[]>([
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

  // ✅ 假的 messages（之後換 DB 就換這裡）
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

  // ✅ 統一 hover/active 顏色
  const NAV_ACTIVE_BG = "rgba(148,163,184,0.16)";
  const NAV_HOVER_BG = "rgba(148,163,184,0.10)";

  // =========================
  // ✅ thread → 主畫面 messages
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
          content:
            "嗨，我是 GalaBone LLM Demo。在這裡輸入你的問題，我會用骨科知識與多模態概念幫你解釋。",
        },
      ];
    }

    return threadMsgs;
  }

  function loadThreadToMain(
    threadId: string,
    opts?: { closeOverlay?: boolean }
  ) {
    setActiveThreadId(threadId);
    setActiveView("llm");
    setMessages(buildChatMessagesFromThread(threadId));

    // 清理輸入狀態，確保可以繼續聊天
    setInput("");
    setPendingFiles((prev) => {
      prev.forEach((f) => URL.revokeObjectURL(f.url));
      return [];
    });
    baseHeightRef.current = null;
    setIsMultiLine(false);
    setInputBoxHeight(MIN_HEIGHT);

    if (inputRef.current) {
      inputRef.current.value = "";
      inputRef.current.style.height = `${MIN_HEIGHT}px`;
      inputRef.current.scrollTop = 0;
    }

    if (opts?.closeOverlay) setIsHistoryOpen(false);

    // 回到主畫面後直接可輸入
    setTimeout(() => inputRef.current?.focus(), 60);
  }

  // ✅ overlay 內切換 thread（不關 overlay、不載入主畫面）
  function selectThreadInOverlay(threadId: string) {
    setActiveThreadId(threadId);
  }

  // ✅ 新對話（真正清空 + 新 thread）
  function newThread() {
    const newId = `t-${Date.now()}`;

    setActiveThreadId(newId);
    setActiveView("llm");

    setMessages([
      {
        id: Date.now(),
        role: "assistant",
        content:
          "嗨，我是 GalaBone LLM Demo。在這裡輸入你的問題，我會用骨科知識與多模態概念幫你解釋。",
      },
    ]);

    setInput("");
    setPendingFiles((prev) => {
      prev.forEach((f) => URL.revokeObjectURL(f.url));
      return [];
    });
    baseHeightRef.current = null;
    setIsMultiLine(false);
    setInputBoxHeight(MIN_HEIGHT);

    if (inputRef.current) {
      inputRef.current.value = "";
      inputRef.current.style.height = `${MIN_HEIGHT}px`;
      inputRef.current.scrollTop = 0;
    }

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
    autoResizeTextarea();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 點外面自動關 tool menu
  useEffect(() => {
    function onDown(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (!target.closest("[data-tool-menu-root]")) setShowToolMenu(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  // ESC 關閉 History overlay
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setIsHistoryOpen(false);
    }
    if (isHistoryOpen) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isHistoryOpen]);

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

  // ===== 送出訊息 =====
  async function sendMessage(e?: FormEvent) {
    if (e) e.preventDefault();
    const text = input.trim();
    if ((!text && pendingFiles.length === 0) || loading) return;

    const userMessage: ChatMessage = {
      id: Date.now(),
      role: "user",
      content: text,
      files: pendingFiles.length ? pendingFiles : undefined,
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");

    if (inputRef.current) {
      const el = inputRef.current;
      el.value = "";
      el.style.height = `${MIN_HEIGHT}px`;
      el.scrollTop = 0;
    }

    setPendingFiles((prev) => {
      prev.forEach((f) => URL.revokeObjectURL(f.url));
      return [];
    });

    baseHeightRef.current = null;
    setIsMultiLine(false);
    setInputBoxHeight(MIN_HEIGHT);

    setLoading(true);

    setTimeout(() => {
      const answerText = fakeLLMReply(text || "（已上傳檔案）");
      const botMessage: ChatMessage = {
        id: Date.now() + 1,
        role: "assistant",
        content: answerText,
      };
      setMessages((prev) => [...prev, botMessage]);
      setLoading(false);
    }, 800);
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

  function handleExport(type: "pdf" | "ppt") {
    setShowToolMenu(false);
    console.log("export:", type);
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
          const isImage = file.type.startsWith("image/");
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
        onClick={onClick}
        className="w-11 h-11 rounded-xl flex items-center justify-center transition"
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
        title={label}
      >
        <i className={`${iconClass} text-[18px] opacity-75`} />
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
        onClick={onClick}
        className="w-full flex items-center gap-3 px-3 py-2 rounded-lg transition"
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
        <i className={`${iconClass} text-[16px] opacity-75`} />
        <span>{label}</span>
      </button>
    );
  }

  function SideThreadItem({
    title,
    meta,
    active,
    onClick,
  }: {
    title: string;
    meta?: string;
    active?: boolean;
    onClick: () => void;
  }) {
    return (
      <button
        onClick={onClick}
        className="w-full text-left px-3 py-2 rounded-lg transition"
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
        title={title}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="text-[13px] font-medium truncate">{title}</div>
          {meta && <div className="text-[11px] opacity-60 shrink-0">{meta}</div>}
        </div>
      </button>
    );
  }

  // ===== History overlay =====
  const filteredThreads = useMemo(() => {
    // ✅ 組字中先不做篩選，避免中文輸入被 re-render 打斷
    if (isComposingHistory) return historyThreads;

    const q = historyQuery.trim().toLowerCase();
    if (!q) return historyThreads;

    return historyThreads.filter((t) => {
      return (
        t.title.toLowerCase().includes(q) ||
        t.preview.toLowerCase().includes(q) ||
        t.updatedAt.toLowerCase().includes(q)
      );
    });
  }, [historyQuery, historyThreads, isComposingHistory]);

  function HistoryOverlay() {
    const currentThread = historyThreads.find((t) => t.id === activeThreadId);
    const threadMessages = historyMessages.filter(
      (m) => m.threadId === activeThreadId
    );

    return (
      <div className="fixed inset-0 z-[60]">
        <div
          className="absolute inset-0"
          style={{ backgroundColor: "rgba(0,0,0,0.35)" }}
          onClick={() => setIsHistoryOpen(false)}
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
                <div className="text-[11px] opacity-60">
                  目前為假資料（之後可接資料庫）
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  className="text-xs px-3 py-2 rounded-lg transition"
                  style={{ backgroundColor: "transparent" }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.backgroundColor = NAV_HOVER_BG)
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.backgroundColor = "transparent")
                  }
                  onClick={() => newThread()}
                >
                  ＋ 新增對話
                </button>

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
                  onClick={() => setIsHistoryOpen(false)}
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
                  {/* ✅ 改為非受控 input：避免 IME（中文注音/拼音）組字被打斷 */}
                  <input
                    ref={historyInputRef}
                    defaultValue=""
                    placeholder="搜尋對話…"
                    className="w-full rounded-lg px-3 py-2 text-sm outline-none border bg-transparent"
                    style={{
                      borderColor: "rgba(148,163,184,0.25)",
                      color: "var(--foreground)",
                    }}
                    autoFocus
                    onCompositionStart={() => {
                      setIsComposingHistory(true);
                    }}
                    onCompositionEnd={(e) => {
                      setIsComposingHistory(false);
                      setHistoryQuery(
                        (e.currentTarget as HTMLInputElement).value
                      );
                    }}
                    onInput={(e) => {
                      if (isComposingHistory) return;
                      setHistoryQuery(
                        (e.currentTarget as HTMLInputElement).value
                      );
                    }}
                  />
                </div>

                <div className="min-h-0 overflow-y-auto p-2">
                  {filteredThreads.length === 0 ? (
                    <div className="p-4 text-sm opacity-60">沒有符合的對話</div>
                  ) : (
                    filteredThreads.map((t) => {
                      const active = t.id === activeThreadId;
                      return (
                        <button
                          key={t.id}
                          onClick={() => selectThreadInOverlay(t.id)}
                          className="w-full text-left p-3 rounded-xl transition mb-2"
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
                            e.currentTarget.style.backgroundColor =
                              "transparent";
                          }}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="text-sm font-medium truncate">
                              {t.title}
                            </div>
                            <div className="text-[11px] opacity-60 shrink-0">
                              {t.updatedAt}
                            </div>
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
                  <div className="min-w-0">
                    <div className="text-sm font-semibold truncate">
                      {currentThread?.title || "未選擇對話"}
                    </div>
                    <div className="text-[11px] opacity-60">
                      {currentThread?.updatedAt || ""}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      className="text-xs px-3 py-2 rounded-lg transition"
                      style={{ backgroundColor: "transparent" }}
                      onMouseEnter={(e) =>
                        (e.currentTarget.style.backgroundColor = NAV_HOVER_BG)
                      }
                      onMouseLeave={(e) =>
                        (e.currentTarget.style.backgroundColor = "transparent")
                      }
                      onClick={() =>
                        loadThreadToMain(activeThreadId, { closeOverlay: true })
                      }
                      title="回到主畫面並繼續聊天"
                    >
                      ←返回
                    </button>

                    <button
                      className="text-xs px-3 py-2 rounded-lg transition"
                      style={{ backgroundColor: "transparent" }}
                      onMouseEnter={(e) =>
                        (e.currentTarget.style.backgroundColor = NAV_HOVER_BG)
                      }
                      onMouseLeave={(e) =>
                        (e.currentTarget.style.backgroundColor = "transparent")
                      }
                      onClick={() => console.log("export history (fake)")}
                    >
                      匯出（假）
                    </button>
                  </div>
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
                  {threadMessages.length === 0 ? (
                    <div className="text-sm opacity-60">
                      這個對話目前沒有訊息
                    </div>
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
                            <div className="text-[11px] opacity-60 mt-2 text-right">
                              {m.createdAt}
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
  }

  function openHistory() {
    setIsHistoryOpen(true);
    setHistoryQuery("");
    setIsComposingHistory(false);

    // ✅ 非受控 input 要手動清空
    setTimeout(() => {
      if (historyInputRef.current) {
        historyInputRef.current.value = "";
        historyInputRef.current.focus();
      }
    }, 0);
  }

  // ===== Desktop sidebar =====
  const DesktopAside = (
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
        className="border-b"
        style={{ borderColor: "rgba(148,163,184,0.20)" }}
      >
        <div
          className={`flex items-start justify-between ${
            isNavCollapsed ? "px-3 pt-3 pb-3" : "px-4 pt-4 pb-3"
          }`}
        >
          {!isNavCollapsed ? (
            <div>
              <h1 className="text-lg font-semibold tracking-wide">GalaBone</h1>
              <p className="text-[11px] mt-1 opacity-70">Your Bone We Care</p>
            </div>
          ) : (
            <div className="h-9" />
          )}

          <button
            type="button"
            onClick={() => setIsNavCollapsed((v) => !v)}
            title={isNavCollapsed ? "展開導覽列" : "收合導覽列"}
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
          >
            <i className="fa-solid fa-bars text-[14px] opacity-70" />
          </button>
        </div>

        {!isNavCollapsed && (
          <div className="px-4 pb-4">
            <label className="flex flex-col gap-1 text-[11px] opacity-80">
              <span>Session ID</span>
              <input
                className="rounded-lg px-2 py-[7px] text-[12px] outline-none border"
                style={{
                  backgroundColor: "var(--background)",
                  color: "var(--foreground)",
                  borderColor: "rgba(148,163,184,0.30)",
                }}
                value={sessionId}
                onChange={(e) => setSessionId(e.target.value)}
              />
            </label>
          </div>
        )}
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
              <SideRow
                iconClass="fa-regular fa-message"
                label="新對話"
                active={activeView === "llm"}
                onClick={() => newThread()}
              />
            </div>

            <div className="space-y-1">
              <SideRow
                iconClass="fa-solid fa-wand-magic-sparkles"
                label="EduGen"
                active={activeView === "edugen"}
                onClick={() => setActiveView("edugen")}
              />
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
                <p className="text-[11px] tracking-wide opacity-60">最近對話</p>
                <button
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
              iconClass="fa-solid fa-wand-magic-sparkles"
              label="EduGen"
              active={activeView === "edugen"}
              onClick={() => setActiveView("edugen")}
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
          <button className="w-full flex items-center gap-2 text-[12px] opacity-75 hover:opacity-100 transition">
            <i className="fa-solid fa-gear text-[12px] opacity-80" />
            <span>設定</span>
          </button>
        )}
      </div>
    </aside>
  );

  function MobileDrawer() {
    return (
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

              <label className="flex flex-col gap-1 text-[11px] opacity-80 mt-3">
                <span>Session ID</span>
                <input
                  className="rounded-lg px-2 py-[7px] text-[12px] outline-none border"
                  style={{
                    backgroundColor: "var(--background)",
                    color: "var(--foreground)",
                    borderColor: "rgba(148,163,184,0.30)",
                  }}
                  value={sessionId}
                  onChange={(e) => setSessionId(e.target.value)}
                />
              </label>
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

              <div className="space-y-1">
                <SideRow
                  iconClass="fa-solid fa-wand-magic-sparkles"
                  label="EduGen"
                  active={activeView === "edugen"}
                  onClick={() => {
                    setActiveView("edugen");
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

              <div className="pt-2">
                <div className="flex items-center justify-between px-1 mb-2">
                  <p className="text-[11px] tracking-wide opacity-60">
                    最近對話
                  </p>
                  <button
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
              <button className="w-full flex items-center gap-2 text-[12px] opacity-75 hover:opacity-100 transition">
                <i className="fa-solid fa-gear text-[12px] opacity-80" />
                <span>設定</span>
              </button>
            </div>
          </aside>
        </div>
      </div>
    );
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

  return (
    <div
      className="h-[calc(100vh-4rem)] flex overflow-hidden transition-colors duration-500 relative"
      style={{
        backgroundColor: "var(--background)",
        color: "var(--foreground)",
      }}
    >
      {isHistoryOpen && <HistoryOverlay />}

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

      <div className="hidden md:block">{DesktopAside}</div>
      {isMobileNavOpen && <MobileDrawer />}

      <div className="flex-1 min-h-0 flex flex-col px-6 py-6 gap-4 overflow-hidden llm-main-shell">
        {activeView === "edugen" ? (
          <PlaceholderView title="EduGen" />
        ) : activeView === "assets" ? (
          <PlaceholderView title="資源管理" />
        ) : (
          <section className="flex-1 min-h-0 flex flex-col relative">
            <div className="flex items-center justify-between mb-2 text-xs opacity-70 px-1">
              <span>Demo 1.0 ver.（尚未接後端）</span>

              <button
                className="text-xs px-3 py-2 rounded-lg transition"
                style={{ backgroundColor: "transparent" }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.backgroundColor = NAV_HOVER_BG)
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.backgroundColor = "transparent")
                }
                onClick={() => openHistory()}
              >
                對話紀錄
              </button>
            </div>

            <div
              className="chat-scroll flex-1 min-h-0 overflow-y-auto text-sm break-words"
              style={{ paddingBottom: inputBoxHeight + 40 }}
            >
              <div className="w-full flex justify-center">
                <div className="w-full max-w-3xl pr-1">
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
                            className={isExpanded ? "" : "flex items-center gap-3"}
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
                              value={input}
                              onChange={handleInputChange}
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
                            />

                            {!isExpanded && (
                              <div className="flex items-center gap-3">
                                <span className="text-[10px] text-emerald-400">
                                  ●
                                </span>
                                <button
                                  type="submit"
                                  disabled={
                                    (!input.trim() && pendingFiles.length === 0) ||
                                    loading
                                  }
                                  className="h-7 w-7 rounded-full flex items-center justify-center text-white text-sm font-semibold disabled:opacity-60"
                                  style={{
                                    background:
                                      "linear-gradient(135deg,#0ea5e9,#22c55e)",
                                    boxShadow: "0 10px 25px rgba(56,189,248,0.45)",
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
                                    (!input.trim() && pendingFiles.length === 0) ||
                                    loading
                                  }
                                  className="h-7 w-7 rounded-full flex items-center justify-center text-white text-sm font-semibold disabled:opacity-60"
                                  style={{
                                    background:
                                      "linear-gradient(135deg,#0ea5e9,#22c55e)",
                                    boxShadow: "0 10px 25px rgba(56,189,248,0.45)",
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
