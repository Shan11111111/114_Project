//frontend/app/bonevision/page.tsx
"use client";

import React, {
  Suspense,
  useState,
  useRef,
  useEffect,
  useCallback,
  MouseEvent,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getUser } from "../lib/auth";

import {
  type AppLocale,
  getSavedLocale,
  messages,
} from "../lib/i18n";

import { ScanSearch, RotateCcw, UploadCloud, Images } from "lucide-react";

const API_BASE = (
  process.env.NEXT_PUBLIC_BACKEND_URL ||
  process.env.NEXT_PUBLIC_API_BASE ||
  "http://127.0.0.1:8000"
).replace(/\/+$/, "");

const PREDICT_URL = `${API_BASE}/predict`;
const HISTORY_LIST_URL = `${API_BASE}/history`;
const HISTORY_IMAGE_URL = `${API_BASE}/history/image`;

type PolyPoint = [number, number];


type BoneInfo =
  | {
    bone_id: number;
    bone_en: string;
    bone_zh: string;
    bone_region: string;
    bone_desc: string;
  }
  | null;

type DetectionBox = {
  id: number;
  cls_name: string;
  conf: number;
  poly: PolyPoint[];
  bone_info?: BoneInfo;
  sub_label?: string | null;
};

type ImgBox = {
  width: number;
  height: number;
};

type SampleCategory = string;

type SampleImage = {
  id: number;
  bone_id: number | null;
  bone_en?: string | null;
  bone_zh?: string | null;
  bone_region?: string | null;
  bone_desc?: string | null;
  name: string;
  filename: string;
  image_path: string;
  content_type?: string | null;
  preview_url: string;
  download_url: string;
  category: string;
};

type AuthUser = {
  id?: number | string | null;
  user_id?: number | string | null;
  username?: string | null;
  email?: string | null;
  roles?: string | null;
  resolved_user_id?: number | null;
} | null;

type HistoryListItem = {
  image_case_id: number;
  user_id?: number | null;
  bone_image_id?: number | null;
  source?: string | null;
  created_at?: string | null;
  image_name?: string | null;
  image_path?: string | null;
  content_type?: string | null;
  detection_count?: number | null;
};

type HistoryDetailDetection = {
  detection_id: number;
  image_case_id: number;
  bone_id?: number | null;
  small_bone_id?: number | null;
  sub_label?: string | null;
  label41?: number | string | null;
  attr206?: number | string | null;
  side?: string | null;
  finger?: string | null;
  phalanx?: string | null;
  serial_number?: number | null;
  confidence?: number | null;
  x1?: number | null;
  y1?: number | null;
  x2?: number | null;
  y2?: number | null;
  created_at?: string | null;
  poly_json?: string | null;
  p1x?: number | null;
  p1y?: number | null;
  p2x?: number | null;
  p2y?: number | null;
  p3x?: number | null;
  p3y?: number | null;
  p4x?: number | null;
  p4y?: number | null;
  poly_is_normalized?: boolean | null;
  cx?: number | null;
  cy?: number | null;
  created_by_user_id?: number | null;
  bone_info?: BoneInfo;
};

type HistoryDetail = {
  image_case_id: number;
  user_id?: number | null;
  bone_image_id?: number | null;
  source?: string | null;
  created_at?: string | null;
  image_name?: string | null;
  image_path?: string | null;
  content_type?: string | null;
  detection_count?: number | null;
  detections: HistoryDetailDetection[];
};

export default function BoneVisionPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center text-sm text-slate-400">
          載入 Bone Vision...
        </div>
      }
    >
      <BoneVisionPageInner />
    </Suspense>
  );
}

function BoneVisionPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [locale, setLocale] = useState<AppLocale>("zh-TW");

  useEffect(() => {
    const syncLocale = () => {
      setLocale(getSavedLocale());
    };

    syncLocale();

    window.addEventListener("storage", syncLocale);
    window.addEventListener("galabone-locale-changed", syncLocale);

    return () => {
      window.removeEventListener("storage", syncLocale);
      window.removeEventListener("galabone-locale-changed", syncLocale);
    };
  }, []);

  const t = (key: string) => messages[locale]?.[key] ?? messages["zh-TW"]?.[key] ?? key;


  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [detections, setDetections] = useState<DetectionBox[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [rawResponse, setRawResponse] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [imageCaseId, setImageCaseId] = useState<number | null>(null);
  const [showOnlyActive, setShowOnlyActive] = useState(false);

  const [isGalleryOpen, setIsGalleryOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isQuizOpen, setIsQuizOpen] = useState(false);

  const [quizData, setQuizData] = useState<any>(null);

  const [quizIndex, setQuizIndex] = useState(0);

  const [quizAnswers, setQuizAnswers] = useState<Record<number, string>>({});

  const [quizFinished, setQuizFinished] = useState(false);

  const [quizScore, setQuizScore] = useState(0);

  const [loadingQuiz, setLoadingQuiz] = useState(false);
  const [galleryFilter, setGalleryFilter] = useState<SampleCategory>("全部");
  const [galleryKeyword, setGalleryKeyword] = useState("");
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [samples, setSamples] = useState<SampleImage[]>([]);

  const [currentUser, setCurrentUser] = useState<AuthUser>(null);

  const [historyList, setHistoryList] = useState<HistoryListItem[]>([]);
  const [historyKeyword, setHistoryKeyword] = useState("");
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [selectedHistoryId, setSelectedHistoryId] = useState<number | null>(null);
  const [selectedHistoryDetail, setSelectedHistoryDetail] = useState<HistoryDetail | null>(null);
  const [loadingHistoryDetail, setLoadingHistoryDetail] = useState(false);

  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const displayRef = useRef<HTMLDivElement | null>(null);
  const [imgBox, setImgBox] = useState<ImgBox>({
    width: 0,
    height: 0,
  });
  const quizDisplayRef = useRef<HTMLDivElement | null>(null);

  const [quizImgBox, setQuizImgBox] = useState<ImgBox>({
    width: 0,
    height: 0,
  });

  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStart = useRef<{ x: number; y: number } | null>(null);

  const clampZoom = (z: number) => Math.min(2, Math.max(0.5, z));

  const cleanBoneZh = (value?: string | null) => {
    if (!value) return "";
    return value.replace(/\s*[\(（]\d+[\)）]\s*$/, "").trim();
  };

  const cleanText = (value?: string | null) => {
    if (!value) return "";
    return value.replace(/\s*[\(（][^\)）]*[\)）]\s*$/, "").trim();
  };


  const normalizeKeyword = (value?: string | number | null) => {
    if (value === null || value === undefined) return "";
    return String(value)
      .toLowerCase()
      .replace(/\s+/g, "")
      .replace(/[()（）【】\[\]{}]/g, "")
      .trim();
  };

  const getSampleCategoryName = (img: SampleImage) => {
    return img.bone_zh ? cleanBoneZh(img.bone_zh) : "未分類";
  };

  const SAMPLE_SEARCH_STOP_WORDS = [
    "我要",
    "我想",
    "想看",
    "幫我",
    "請",
    "出",
    "顯示",
    "查詢",
    "搜尋",
    "找",
    "相關",
    "骨頭",
    "骨骼",
    "影像",
    "圖片",
    "照片",
    "範例",
    "x光",
    "xray",
    "x-ray",
    "的",
    "一下",
    "看看",
    "可以看",
    "給我",
  ];

  /**
   * 範例影像庫語意對照表
   * key = 系統中的 16 類分類名稱
   * values = 使用者可能輸入的俗稱、部位、英文、常見描述
   */
  const SAMPLE_SEMANTIC_ALIASES: Record<string, string[]> = {
    顱骨: [
      "顱骨",
      "頭骨",
      "頭顱",
      "頭部",
      "腦袋",
      "頭",
      "skull",
      "cranial",
      "cranium",
    ],

    頸椎: [
      "頸椎",
      "脖子",
      "頸部",
      "脖子的骨頭",
      "脖子骨頭",
      "cervical",
      "cervicalspine",
      "cspine",
      "neck",
      "c1",
      "c2",
      "c3",
      "c4",
      "c5",
      "c6",
      "c7",
      "第一頸椎",
      "第二頸椎",
      "第三頸椎",
      "第四頸椎",
      "第五頸椎",
      "第六頸椎",
      "第七頸椎",
      "寰椎",
      "樞椎",
    ],

    胸椎: [
      "胸椎",
      "上背",
      "背部",
      "背骨",
      "胸背",
      "thoracic",
      "thoracicspine",
      "tspine",
      "t1",
      "t2",
      "t3",
      "t4",
      "t5",
      "t6",
      "t7",
      "t8",
      "t9",
      "t10",
      "t11",
      "t12",
    ],

    腰椎: [
      "腰椎",
      "腰",
      "腰部",
      "下背",
      "下背部",
      "腰骨",
      "lowerback",
      "lumbar",
      "lumbarspine",
      "lspine",
      "l1",
      "l2",
      "l3",
      "l4",
      "l5",
      "第一腰椎",
      "第二腰椎",
      "第三腰椎",
      "第四腰椎",
      "第五腰椎",
    ],

    鎖骨: [
      "鎖骨",
      "肩膀前面",
      "胸前上方",
      "collarbone",
      "clavicle",
    ],

    肩胛骨: [
      "肩胛骨",
      "肩胛",
      "肩膀後面",
      "背後肩膀",
      "scapula",
      "shoulderblade",
    ],

    肱骨: [
      "肱骨",
      "上臂",
      "手臂上段",
      "上手臂",
      "humerus",
      "humeri",
      "upperarm",
    ],

    尺骨: [
      "尺骨",
      "小拇指側",
      "小指側",
      "前臂內側",
      "ulna",
      "ulnar",
    ],

    橈骨: [
      "橈骨",
      "拇指側",
      "大拇指側",
      "前臂外側",
      "radius",
      "radial",
    ],

    腕骨: [
      "腕骨",
      "手腕",
      "手腕骨",
      "腕部",
      "carpal",
      "carpals",
      "wrist",
    ],

    掌骨: [
      "掌骨",
      "手掌",
      "掌部",
      "手掌骨",
      "metacarpal",
      "metacarpals",
      "palm",
    ],

    指骨: [
      "指骨",
      "手指",
      "手指骨",
      "指頭",
      "finger",
      "fingers",
      "phalanges",
      "phalanx",
    ],

    肋骨: [
      "肋骨",
      "肋",
      "胸腔旁邊",
      "rib",
      "ribs",
      "costal",
    ],

    胸骨: [
      "胸骨",
      "胸口中間",
      "胸前中間",
      "sternum",
      "breastbone",
    ],

    股骨: [
      "股骨",
      "大腿",
      "大腿骨",
      "femur",
      "thighbone",
      "thigh",
    ],

    脛骨: [
      "脛骨",
      "小腿前側",
      "小腿內側",
      "膝蓋下面內側",
      "tibia",
      "shinbone",
      "shin",
    ],

    腓骨: [
      "腓骨",
      "小腿外側",
      "膝蓋下面外側",
      "fibula",
      "calfbone",
    ],
  };

  const normalizeGalleryText = (value?: string | number | null) => {
    if (value === null || value === undefined) return "";

    return String(value)
      .toLowerCase()
      .replace(/\s+/g, "")
      .replace(/[()（）【】\[\]{}]/g, "")
      .replace(/[，,。.!！?？、:：;；]/g, "")
      .trim();
  };

  const removeGalleryStopWords = (keyword: string) => {
    let q = normalizeGalleryText(keyword);

    SAMPLE_SEARCH_STOP_WORDS.forEach((word) => {
      const w = normalizeGalleryText(word);
      if (w) q = q.replaceAll(w, "");
    });

    return q;
  };

  /**
   * 把使用者輸入轉成可能的範例影像類別
   * 例如：
   * - 脖子第三根 => 頸椎
   * - 下背痛想看骨頭 => 腰椎
   * - 小指側前臂 => 尺骨
   */
  const resolveGallerySemanticCategories = (keyword: string): string[] => {
    const rawQ = normalizeGalleryText(keyword);
    const q = removeGalleryStopWords(keyword);

    if (!rawQ && !q) return [];

    const candidates = new Set<string>();

    Object.entries(SAMPLE_SEMANTIC_ALIASES).forEach(([category, aliases]) => {
      const normalizedCategory = normalizeGalleryText(category);

      if (
        rawQ.includes(normalizedCategory) ||
        q.includes(normalizedCategory)
      ) {
        candidates.add(category);
      }

      aliases.forEach((alias) => {
        const a = normalizeGalleryText(alias);
        if (!a) return;

        if (rawQ.includes(a) || q.includes(a) || a.includes(q)) {
          candidates.add(category);
        }
      });
    });

    // 針對「第幾根」這種口語補強：如果同時有脖子/頸部，就推定頸椎
    const hasOrdinal =
      /第[一二三四五六七八九十\d]+/.test(keyword) ||
      /[cctl]\d/i.test(keyword);

    if (hasOrdinal) {
      if (rawQ.includes("脖子") || rawQ.includes("頸")) {
        candidates.add("頸椎");
      }

      if (rawQ.includes("腰") || rawQ.includes("下背")) {
        candidates.add("腰椎");
      }

      if (rawQ.includes("胸椎") || rawQ.includes("上背") || rawQ.includes("背")) {
        candidates.add("胸椎");
      }
    }

    return Array.from(candidates);
  };

  const isSampleMatchedByKeyword = (img: SampleImage, keyword: string) => {
    const rawQ = normalizeGalleryText(keyword);
    const q = removeGalleryStopWords(keyword);

    if (!rawQ && !q) return true;

    const category = getSampleCategoryName(img);
    const semanticCategories = resolveGallerySemanticCategories(keyword);

    // 1. 語意分類命中：例如「脖子第三根」=> 頸椎
    if (semanticCategories.length > 0) {
      return semanticCategories.includes(category);
    }

    const nameFields = [
      cleanBoneZh(img.bone_zh),
      cleanText(img.bone_en),
      img.name,
      img.filename,
      img.category,
    ]
      .map(normalizeGalleryText)
      .join(" ");

    const regionFields = [
      cleanText(img.bone_region),
      cleanText(img.bone_desc),
    ]
      .map(normalizeGalleryText)
      .join(" ");

    // 2. 一般精準搜尋：骨名、英文、檔名、分類
    if (nameFields.includes(rawQ) || nameFields.includes(q)) return true;

    // 3. 部位語意搜尋：只有明確像部位描述時才比對，避免「尺骨」搜出整個上肢
    const regionKeywords = [
      "上肢",
      "下肢",
      "頭部",
      "胸部",
      "軀幹",
      "手",
      "手腕",
      "手掌",
      "手指",
      "足",
      "腳",
      "小腿",
      "大腿",
      "肩膀",
      "腰",
      "背",
      "脖子",
    ];

    const isRegionSearch = regionKeywords.some((word) => {
      const w = normalizeGalleryText(word);
      return rawQ.includes(w) || q.includes(w);
    });

    if (isRegionSearch && (regionFields.includes(rawQ) || regionFields.includes(q))) {
      return true;
    }

    return false;
  };

  const getDisplayBoneName = (box: DetectionBox) => {
    const zh = cleanBoneZh(box.bone_info?.bone_zh);
    if (zh && zh !== "未分類") {
      return zh;
    }
    return box.cls_name;
  };
  const formatDateTime = (value?: string | null) => {
    if (!value) return "—";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value;
    return d.toLocaleString("zh-TW", {
      hour12: false,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const handleZoomIn = () => setZoom((z) => clampZoom(z + 0.1));
  const handleZoomOut = () => setZoom((z) => clampZoom(z - 0.1));
  const handleResetView = () => {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  };

  const handlePanStart = (e: MouseEvent<HTMLDivElement>) => {
    if (!previewUrl) return;
    setIsPanning(true);
    panStart.current = { x: e.clientX, y: e.clientY };
  };

  const handlePanMove = (e: MouseEvent<HTMLDivElement>) => {
    if (!isPanning || !panStart.current) return;
    const dx = e.clientX - panStart.current.x;
    const dy = e.clientY - panStart.current.y;
    setOffset((prev) => ({ x: prev.x + dx, y: prev.y + dy }));
    panStart.current = { x: e.clientX, y: e.clientY };
  };

  const handlePanEnd = () => {
    setIsPanning(false);
    panStart.current = null;
  };

  const resetDetectionState = () => {
    setDetections([]);
    setRawResponse(null);
    setActiveId(null);
    setErrorMsg(null);
    setShowOnlyActive(false);
    setImageCaseId(null);
    handleResetView();
  };

  const measureLayout = useCallback(() => {
    if (!displayRef.current) return;
    const rect = displayRef.current.getBoundingClientRect();
    setImgBox({
      width: rect.width,
      height: rect.height,
    });
  }, []);
  const measureQuizLayout = useCallback(() => {
    if (!quizDisplayRef.current) return;

    const rect = quizDisplayRef.current.getBoundingClientRect();

    setQuizImgBox({
      width: rect.width,
      height: rect.height,
    });
  }, []);

  useEffect(() => {
    measureLayout();
    window.addEventListener("resize", measureLayout);
    return () => window.removeEventListener("resize", measureLayout);
  }, [measureLayout]);

  useEffect(() => {
    if (!previewUrl) return;
    requestAnimationFrame(() => {
      measureLayout();
    });
  }, [previewUrl, detections.length, zoom, measureLayout]);

  useEffect(() => {
    const detectTheme = () => {
      const html = document.documentElement;
      const body = document.body;

      const byClass =
        html.classList.contains("dark") || body.classList.contains("dark");

      const htmlTheme = html.getAttribute("data-theme");
      const bodyTheme = body.getAttribute("data-theme");
      const byAttr = htmlTheme === "dark" || bodyTheme === "dark";

      setIsDarkMode(byClass || byAttr);
    };

    detectTheme();

    const observer = new MutationObserver(detectTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme"],
    });
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ["class", "data-theme"],
    });

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!isGalleryOpen && !isHistoryOpen) return;

    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsGalleryOpen(false);
        setIsHistoryOpen(false);
      }
    };

    document.addEventListener("keydown", onKeyDown);
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = "";
    };
  }, [isGalleryOpen, isHistoryOpen]);

  useEffect(() => {
    const normalizeNumericId = (value: unknown): number | null => {
      const num = Number(value);
      return Number.isInteger(num) && num > 0 ? num : null;
    };

    const syncUser = () => {
      try {
        const rawUser = getUser() as AuthUser;
        console.log(">>> getUser() raw =", rawUser);

        if (!rawUser) {
          setCurrentUser(null);
          return;
        }

        const resolvedUserId =
          normalizeNumericId(rawUser.id) ??
          normalizeNumericId(rawUser.user_id);

        const fixedUser: AuthUser = {
          ...rawUser,
          resolved_user_id: resolvedUserId,
        };

        console.log(">>> getUser() fixed =", fixedUser);
        setCurrentUser(fixedUser);
      } catch (err) {
        console.error("讀取登入者失敗", err);
        setCurrentUser(null);
      }
    };

    syncUser();

    const onAuthChanged = () => syncUser();
    window.addEventListener("auth-changed", onAuthChanged);

    return () => {
      window.removeEventListener("auth-changed", onAuthChanged);
    };
  }, []);

  useEffect(() => {
    const loadSamples = async () => {
      try {
        const res = await fetch(`${API_BASE}/sample-images`);
        if (!res.ok) {
          throw new Error(`無法載入範例影像庫：${res.status}`);
        }

        const data = await res.json();

        const items: SampleImage[] = (data.items || []).map((item: any) => ({
          id: Number(item.id),
          bone_id: item.bone_id != null ? Number(item.bone_id) : null,
          bone_en: item.bone_en ?? null,
          bone_zh: item.bone_zh ?? null,
          bone_region: item.bone_region ?? null,
          bone_desc: item.bone_desc ?? null,
          name: item.name ?? item.filename ?? `sample_${item.id}`,
          filename: item.filename ?? `sample_${item.id}`,
          image_path: item.image_path ?? "",
          content_type: item.content_type ?? null,
          preview_url: item.preview_url,
          download_url: item.download_url,
          category: item.bone_zh ? cleanBoneZh(item.bone_zh) : "未分類",
        }));

        console.log("sample-images count =", items.length);
        setSamples(items);
      } catch (err) {
        console.error("loadSamples failed:", err);
        setErrorMsg("範例影像庫載入失敗");
      }
    };

    loadSamples();
  }, []);

  const parsePredictResponse = (data: any) => {
    setRawResponse(data);

    const cidRaw =
      data.image_case_id ?? data.imageCaseId ?? data.image_caseId ?? null;
    const cid =
      typeof cidRaw === "number" ? cidRaw : Number(cidRaw) || null;

    setImageCaseId(cid);

    const boxes: DetectionBox[] = (data.boxes || []).map(
      (b: any, idx: number) => ({
        id: idx,
        cls_name: b.cls_name ?? `class_${b.cls_id ?? idx}`,
        conf: typeof b.conf === "number" ? b.conf : 0,
        poly: Array.isArray(b.poly)
          ? (b.poly as number[][]).map((p) => [Number(p[0]), Number(p[1])])
          : [],
        bone_info: b.bone_info ?? null,
        sub_label: b.sub_label ?? null,
      })
    );

    setDetections(boxes);
    setActiveId(boxes.length ? boxes[0].id : null);
    setShowOnlyActive(false);

    if (!cid) {
      console.warn(
        "⚠️ /predict 沒回傳 image_case_id（或 imageCaseId），了解更多將無法帶入 S2 bootstrap"
      );
    }
  };

  const getCurrentUserId = (): string | null => {
    const resolved = currentUser?.resolved_user_id;
    if (typeof resolved === "number" && Number.isInteger(resolved) && resolved > 0) {
      return String(resolved);
    }
    return null;
  };

  const parseHistoryPoly = (polyJson?: string | null): PolyPoint[] => {
    if (!polyJson) return [];
    try {
      const parsed = JSON.parse(polyJson);

      const rawPoly = Array.isArray(parsed) ? parsed : parsed?.poly;
      if (!Array.isArray(rawPoly)) return [];

      return rawPoly
        .map((p: any) => {
          if (Array.isArray(p) && p.length >= 2) {
            return [Number(p[0]), Number(p[1])] as PolyPoint;
          }
          return null;
        })
        .filter(Boolean) as PolyPoint[];
    } catch {
      return [];
    }
  };

  const applyHistoryDetailToCanvas = (detail: HistoryDetail) => {
    const detailPreviewUrl =
      detail.bone_image_id != null
        ? `${HISTORY_IMAGE_URL}/${detail.bone_image_id}`
        : detail.image_path
          ? `${API_BASE}${detail.image_path}`
          : null;

    if (detailPreviewUrl) {
      setPreviewUrl(detailPreviewUrl);
    }

    const restoredBoxes: DetectionBox[] = (detail.detections || []).map(
      (d, idx) => ({
        id: idx,
        cls_name:
          d.bone_info?.bone_zh ||
          (d.label41 != null ? `label41=${d.label41}` : `Detection ${idx + 1}`),
        conf: typeof d.confidence === "number" ? d.confidence : 0,
        poly: parseHistoryPoly(d.poly_json),
        bone_info: d.bone_info ?? null,
        sub_label: d.sub_label ?? null,
      })
    );
    setDetections(restoredBoxes);
    setActiveId(restoredBoxes.length ? restoredBoxes[0].id : null);
    setShowOnlyActive(false);
    setImageCaseId(detail.image_case_id);
    setRawResponse(detail);
    handleResetView();
  };

  const loadHistoryList = async () => {
    const safeUserId = getCurrentUserId();

    console.log(">>> currentUser =", currentUser);
    console.log(">>> resolved_user_id =", currentUser?.resolved_user_id);
    console.log(">>> safeUserId =", safeUserId);

    if (!safeUserId) {
      setHistoryError("目前登入資訊中沒有可用的數字 user_id");
      setHistoryList([]);
      setLoadingHistory(false);
      return;
    }

    try {
      setLoadingHistory(true);
      setHistoryError(null);

      const url = `${HISTORY_LIST_URL}?user_id=${encodeURIComponent(safeUserId)}`;
      console.log(">>> history url =", url);

      const res = await fetch(url, {
        credentials: "include",
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`載入歷史紀錄失敗 ${res.status}：${text}`);
      }

      const data = await res.json();
      setHistoryList(Array.isArray(data.items) ? data.items : []);
    } catch (err: any) {
      console.error(err);
      setHistoryError(err.message ?? "載入歷史紀錄失敗");
      setHistoryList([]);
    } finally {
      setLoadingHistory(false);
    }
  };

  const loadHistoryDetail = async (caseId: number, applyToCanvas = false) => {
    try {
      setLoadingHistoryDetail(true);
      setHistoryError(null);

      const res = await fetch(`${HISTORY_LIST_URL}/${caseId}`, {
        credentials: "include",
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`載入歷史詳情失敗 ${res.status}：${text}`);
      }

      const detail: HistoryDetail = await res.json();
      setSelectedHistoryId(caseId);
      setSelectedHistoryDetail(detail);

      if (applyToCanvas) {
        applyHistoryDetailToCanvas(detail);
      }
    } catch (err: any) {
      console.error(err);
      setHistoryError(err.message ?? "載入歷史詳情失敗");
    } finally {
      setLoadingHistoryDetail(false);
    }
  };
  const handleDeleteHistory = async (imageCaseId: number) => {
    const safeUserId = getCurrentUserId();

    if (!safeUserId) {
      alert("目前登入資訊異常，請重新登入後再刪除");
      return;
    }

    const ok = window.confirm("確定要刪除這筆歷史紀錄嗎？");
    if (!ok) return;

    try {
      setLoadingHistoryDetail(true);
      setHistoryError(null);

      const res = await fetch(
        `${HISTORY_LIST_URL}/${imageCaseId}?user_id=${encodeURIComponent(safeUserId)}`,
        {
          method: "DELETE",
          credentials: "include",
        }
      );

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`刪除失敗 ${res.status}：${text}`);
      }

      setHistoryList((prev) =>
        prev.filter((item) => item.image_case_id !== imageCaseId)
      );

      setSelectedHistoryId(null);
      setSelectedHistoryDetail(null);

      alert("刪除成功");
    } catch (err: any) {
      console.error(err);
      alert(err.message ?? "刪除失敗");
    } finally {
      setLoadingHistoryDetail(false);
    }
  };
  useEffect(() => {
    if (!isHistoryOpen) return;
    if (!currentUser) return;

    loadHistoryList();
  }, [isHistoryOpen, currentUser]);

  useEffect(() => {
    const caseIdRaw = searchParams.get("caseId");
    if (!caseIdRaw) return;

    const caseId = Number(caseIdRaw);
    if (!Number.isFinite(caseId)) return;

    loadHistoryDetail(caseId, true);
  }, [searchParams]);

  useEffect(() => {
    const openGallery = searchParams.get("openGallery");
    const bone = searchParams.get("bone");

    if (openGallery !== "1") return;

    setIsGalleryOpen(true);

    if (bone) {
      setGalleryFilter(bone);
    } else {
      setGalleryFilter("全部");
    }
  }, [searchParams]);

  const detectWithFile = async (targetFile: File) => {
    const fd = new FormData();
    fd.append("file", targetFile);

    const token =
      localStorage.getItem("galabone_access_token") ||
      localStorage.getItem("access_token") ||
      localStorage.getItem("token");

    if (currentUser && !token) {
      alert("登入狀態異常，請重新登入");
      return;
    }
    const headers: Record<string, string> = {};
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const res = await fetch(PREDICT_URL, {
      method: "POST",
      headers,
      body: fd,
    });

    if (!res.ok) {
      let message = `後端回傳錯誤 ${res.status}`;
      try {
        const data = await res.json();
        message = `${message}：${data?.detail || data?.error || JSON.stringify(data)}`;
      } catch {
        const text = await res.text();
        message = `${message}：${text}`;
      }
      throw new Error(message);
    }

    const data = await res.json();
    parsePredictResponse(data);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;

    setFile(f);
    resetDetectionState();

    const reader = new FileReader();
    reader.onload = () => setPreviewUrl(reader.result as string);
    reader.readAsDataURL(f);
  };

  const handleUseSampleImage = async (sample: SampleImage) => {
    try {
      setLoading(true);
      setErrorMsg(null);

      const res = await fetch(`${API_BASE}${sample.download_url}`);
      if (!res.ok) throw new Error("無法載入範例圖片");

      const blob = await res.blob();
      const sampleFile = new File([blob], sample.filename, {
        type: blob.type || sample.content_type || "image/jpeg",
      });

      setFile(sampleFile);
      resetDetectionState();
      setPreviewUrl(`${API_BASE}${sample.preview_url}`);
      setIsGalleryOpen(false);

      await detectWithFile(sampleFile);
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.message ?? "使用範例圖片辨識失敗");
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadSampleImage = async (sample: SampleImage) => {
    try {
      const res = await fetch(`${API_BASE}${sample.download_url}`);
      if (!res.ok) throw new Error("下載失敗");

      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = sample.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();

      URL.revokeObjectURL(blobUrl);
    } catch (err) {
      console.error(err);
      alert("下載失敗，請稍後再試");
    }
  };

  const handleDetect = async () => {
    if (!file) {
      alert("請先選擇 X 光圖片");
      return;
    }

    setLoading(true);
    setErrorMsg(null);

    try {
      await detectWithFile(file);
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.message ?? "推論失敗，請檢查後端");
    } finally {
      setLoading(false);
    }
  };
  const handleStartQuiz = async () => {
    console.log("imageCaseId =", imageCaseId);

    const quizUrl =
      `http://140.136.155.157:8000/quiz/generate-from-case?image_case_id=${imageCaseId}&limit=5`;

    console.log("API url =", quizUrl);

    if (!imageCaseId) {
      alert("目前沒有可測驗的辨識結果");
      return;
    }

    try {
      setLoadingQuiz(true);

      const res = await fetch(quizUrl);

      const text = await res.text();

      console.log("quiz status =", res.status);
      console.log("quiz response =", text);

      if (!res.ok) {
        throw new Error(`測驗載入失敗：${res.status} ${text}`);
      }

      const data = JSON.parse(text);

      setQuizData(data);
      setQuizIndex(0);
      setQuizAnswers({});
      setQuizFinished(false);
      setQuizScore(0);

      setIsQuizOpen(true);

    } catch (err) {
      console.error("quiz error:", err);
      alert(String(err));
    } finally {
      setLoadingQuiz(false);
    }
  };
  const polyToPoints = (poly: PolyPoint[]): string => {
    const { width, height } = imgBox;
    if (!width || !height) return "";

    return poly
      .map(([nx, ny]) => {
        const cx = Math.min(1, Math.max(0, nx));
        const cy = Math.min(1, Math.max(0, ny));
        const x = cx * width;
        const y = cy * height;
        return `${x},${y}`;
      })
      .join(" ");
  };
  const quizPolyToPoints = (poly: PolyPoint[]): string => {
    const { width, height } = quizImgBox;

    if (!width || !height) return "";

    return poly
      .map(([nx, ny]) => {
        const cx = Math.min(1, Math.max(0, nx));
        const cy = Math.min(1, Math.max(0, ny));

        const x = cx * width;
        const y = cy * height;

        return `${x},${y}`;
      })
      .join(" ");
  };
  const activeBox =
    activeId !== null ? detections.find((b) => b.id === activeId) ?? null : null;

  const filterOptions: SampleCategory[] = [
    "全部",
    ...Array.from(
      new Set(
        samples
          .map((img) => (img.bone_zh ? cleanBoneZh(img.bone_zh) : "未分類"))
          .filter((v): v is string => Boolean(v))
      )
    ),
  ];

  const filteredSamples = samples.filter((img) => {
    const category = getSampleCategoryName(img);

    const matchedCategory =
      galleryFilter === "全部" || category === galleryFilter;

    const matchedKeyword = isSampleMatchedByKeyword(img, galleryKeyword);

    return matchedCategory && matchedKeyword;
  });


  const filteredHistoryList = historyList.filter((item) => {
    const keyword = historyKeyword.trim().toLowerCase();
    if (!keyword) return true;

    const haystack = [
      item.image_name ?? "",
      item.image_case_id ?? "",
      item.created_at ?? "",
      item.source ?? "",
    ]
      .join(" ")
      .toLowerCase();

    return haystack.includes(keyword);
  });

  const modalSurfaceClass = isDarkMode
    ? "border-slate-800 bg-slate-950 text-slate-100"
    : "border-slate-200 bg-white text-slate-900";

  const modalSubBgClass = isDarkMode ? "bg-slate-950" : "bg-slate-50";
  const modalBorderClass = isDarkMode ? "border-slate-800" : "border-slate-200";
  const modalTextSubClass = isDarkMode ? "text-slate-400" : "text-slate-500";
  const modalButtonClass = isDarkMode
    ? "border-slate-700 text-slate-200 hover:bg-slate-800"
    : "border-slate-300 text-slate-700 hover:bg-slate-100";

  const filterInactiveClass = isDarkMode
    ? "bg-slate-800 text-slate-200 hover:bg-slate-700"
    : "bg-slate-100 text-slate-700 hover:bg-slate-200";

  const cardClass = isDarkMode
    ? "border-slate-800 bg-slate-900"
    : "border-slate-200 bg-white";

  const imageFrameClass = isDarkMode ? "bg-slate-950" : "bg-slate-100";
  const categoryBadgeClass = isDarkMode
    ? "bg-slate-950/80 text-slate-200 border-slate-700"
    : "bg-white/90 text-slate-700 border-slate-200";

  const secondaryActionClass = isDarkMode
    ? "border-slate-700 text-slate-200 hover:bg-slate-800"
    : "border-slate-300 text-slate-700 hover:bg-slate-100";

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 flex flex-col lg:flex-row gap-6 px-6 py-6">
        <section className="w-full lg:w-5/20 space-y-4">
          <div className="card border border-slate-800/70 shadow-xl shadow-slate-900/40">
            <h2 className="text-sm font-semibold mb-3">{t("bonevision.dataSettings")}</h2>

            <div className="space-y-3">
              <div>
                <span className="text-xs text-slate-400">{t("bonevision.uploadXray")}</span>

                <label className="mt-3 flex items-center gap-3 cursor-pointer group">
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleFileChange}
                    className="hidden"
                  />

                  <span
                    className="
    inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2
    text-xs font-bold
    bg-cyan-500 text-slate-950
    shadow-md shadow-cyan-500/20
    hover:bg-cyan-400 hover:-translate-y-0.5
    active:translate-y-0
    transition-all

    dark:bg-cyan-400 dark:text-slate-950
    dark:shadow-cyan-400/20 dark:hover:bg-cyan-300
  "
                  >
                    <UploadCloud className="w-3.5 h-3.5" />
                    {t("bonevision.chooseFile")}
                  </span>

                  <span className="min-w-0 flex-1 text-xs text-slate-500 dark:text-slate-400 truncate">
                    {file ? file.name : t("bonevision.noFileSelected")}
                  </span>
                </label>
              </div>

              <button
                type="button"
                onClick={() => {
                  setGalleryFilter("全部");
                  setIsGalleryOpen(true);
                }}
                className="
  w-full rounded-xl py-2.5 text-sm font-bold
  inline-flex items-center justify-center gap-2

  border border-cyan-400/70
  bg-cyan-50
  text-cyan-700
  shadow-sm shadow-cyan-500/10

  hover:bg-cyan-100
  hover:border-cyan-500
  hover:text-cyan-800
  hover:-translate-y-0.5

  active:translate-y-0
  transition-all

  dark:border-cyan-400/40
  dark:bg-cyan-500/10
  dark:text-cyan-300
  dark:shadow-[0_0_20px_rgba(34,211,238,0.10)]
  dark:hover:bg-cyan-500/15
  dark:hover:border-cyan-300/60
"              >
                <Images className="w-4 h-4" />
                {t("bonevision.sampleGallery")}
              </button>
            </div>

            <button
              onClick={handleDetect}
              disabled={loading || !file}
              className="mt-4 w-full rounded-xl py-3 text-sm font-semibold
             bg-cyan-500 text-slate-900 shadow-lg shadow-cyan-500/40
             disabled:opacity-50 disabled:cursor-not-allowed
             hover:bg-cyan-400 transition-colors"
            >
              {loading ? t("bonevision.detecting") : t("bonevision.startDetect")}
            </button>

            <div className="mt-3 border-t border-slate-600/40" />

            <button
              type="button"
              onClick={() => {
                setIsHistoryOpen(true);
                setSelectedHistoryId(null);
                setSelectedHistoryDetail(null);
              }}
              className="mt-3 w-full rounded-lg py-2 text-sm font-medium
             border border-slate-600/60 text-slate-200
             hover:bg-slate-700/40 hover:border-slate-400
             transition-all"
            >
              {t("bonevision.history")}
            </button>

            {errorMsg && (
              <p className="mt-3 text-xs text-red-400 whitespace-pre-wrap">
                {errorMsg}
              </p>
            )}
          </div>


        </section>

        <section className="w-full lg:w-8/20">
          <div className="card border border-slate-800 rounded-2xl h-full flex flex-col">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold">{t("bonevision.previewResult")}</h2>
              <div className="flex items-center gap-2 scale-[0.88] origin-right text-xs">
                <div
                  className={`flex items-center justify-center ${isDarkMode ? "text-slate-300" : "text-slate-500"
                    }`}
                >
                  <ScanSearch className="w-[16px] h-[16px]" />
                </div>

                <button
                  onClick={handleZoomOut}
                  className={`w-7 h-7 rounded-full border flex items-center justify-center text-sm transition-colors ${isDarkMode
                    ? "border-slate-600/70 bg-slate-900/70 text-slate-200 hover:bg-slate-800"
                    : "border-slate-400/80 bg-white/80 text-slate-700 hover:bg-slate-100"
                    }`}
                >
                  −
                </button>

                <span
                  className={`w-10 text-center text-sm font-semibold ${isDarkMode ? "text-slate-300" : "text-slate-700"
                    }`}
                >
                  {Math.round(zoom * 100)}%
                </span>

                <button
                  onClick={handleZoomIn}
                  className={`w-7 h-7 rounded-full border flex items-center justify-center text-sm transition-colors ${isDarkMode
                    ? "border-slate-600/70 bg-slate-900/70 text-slate-200 hover:bg-slate-800"
                    : "border-slate-400/80 bg-white/80 text-slate-700 hover:bg-slate-100"
                    }`}
                >
                  +
                </button>

                <button
                  onClick={handleResetView}
                  title="Reset"
                  aria-label="Reset"
                  className={`w-7 h-7 rounded-full border flex items-center justify-center transition-colors ${isDarkMode
                    ? "border-slate-600/70 bg-slate-900/70 text-slate-200 hover:bg-slate-800"
                    : "border-slate-400/80 bg-white/80 text-slate-700 hover:bg-slate-100"
                    }`}
                >
                  <RotateCcw className="w-[15px] h-[15px]" />
                </button>

                <button
                  onClick={() => setShowOnlyActive((v) => !v)}
                  className={`ml-1 px-3 h-7 rounded-full border text-xs font-medium transition-colors ${showOnlyActive
                    ? isDarkMode
                      ? "border-cyan-400/60 bg-cyan-500/15 text-cyan-300"
                      : "border-cyan-400 bg-cyan-50 text-cyan-700"
                    : isDarkMode
                      ? "border-cyan-400/40 bg-slate-900/60 text-cyan-300 hover:bg-cyan-500/10"
                      : "border-cyan-500/70 bg-white/70 text-cyan-700 hover:bg-cyan-50"
                    }`}
                >
                  {showOnlyActive ? t("bonevision.showAllBoxes") : t("bonevision.onlyCurrentBox")}
                </button>
              </div>
            </div>

            <div
              ref={wrapperRef}
              className="relative rounded-2xl overflow-hidden border border-slate-800/70 flex items-center justify-center h-[520px]"
              style={{
                backgroundColor: "var(--background)",
              }}
              onMouseDown={handlePanStart}
              onMouseMove={handlePanMove}
              onMouseUp={handlePanEnd}
              onMouseLeave={handlePanEnd}
            >
              {previewUrl ? (
                <div
                  ref={displayRef}
                  className="relative"
                  style={{
                    transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
                    transformOrigin: "center center",
                    transition: isPanning ? "none" : "transform 0.05s linear",
                  }}
                >
                  <img
                    src={previewUrl}
                    alt="preview"
                    className="max-h-[480px] max-w-full object-contain"
                    onLoad={measureLayout}
                  />

                  {detections.length > 0 && (
                    <svg
                      className="absolute inset-0 w-full h-full"
                      viewBox={`0 0 ${imgBox.width || 100} ${imgBox.height || 100}`}
                      preserveAspectRatio="none"
                      style={{
                        pointerEvents: "auto",
                        zIndex: 20,
                      }}
                    >
                      {!showOnlyActive &&
                        detections
                          .filter((b) => b.id !== activeId)
                          .map((box) => {
                            const pts = polyToPoints(box.poly);
                            if (!pts) return null;

                            return (
                              <polygon
                                key={box.id}
                                points={pts}
                                fill="rgba(14, 165, 233, 0.04)"
                                stroke="#0ea5e9"
                                strokeWidth={2}
                                opacity={0.75}
                                style={{ cursor: "pointer" }}
                                onMouseDown={(e) => e.stopPropagation()}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setActiveId(box.id);
                                }}
                              />
                            );
                          })}

                      {activeBox &&
                        (() => {
                          const pts = polyToPoints(activeBox.poly);
                          if (!pts) return null;

                          return (
                            <polygon
                              key={`${activeBox.id}_active`}
                              points={pts}
                              fill="rgba(34, 211, 238, 0.10)"
                              stroke="#22d3ee"
                              strokeWidth={4}
                              className="drop-shadow-[0_0_12px_rgba(34,211,238,0.9)]"
                              style={{ cursor: "pointer" }}
                              onMouseDown={(e) => e.stopPropagation()}
                              onClick={(e) => {
                                e.stopPropagation();
                                setActiveId(activeBox.id);
                              }}
                            />
                          );
                        })()}
                    </svg>
                  )}
                </div>
              ) : (
                <p className="text-xs text-slate-500">
                  {t("bonevision.noImage")}
                </p>
              )}
            </div>

            <p className="mt-3 text-xs text-slate-400">
              {t("bonevision.detectedCount")}{" "}
              <span className="text-cyan-400 font-semibold">
                {detections.length}
              </span>{" "}
              {t("bonevision.boneBoxes")}
            </p>
          </div>
        </section>

        <section className="w-full lg:w-7/20">
          <div className="card border border-slate-800 rounded-2xl h-full flex flex-col">
            <h2 className="text-sm font-semibold mb-3">{t("bonevision.detectedParts")}</h2>

            {detections.length === 0 ? (
              <div
                className={`mt-3 rounded-3xl border p-6 ${isDarkMode
                    ? "border-slate-800 bg-slate-900/60"
                    : "border-slate-200 bg-slate-50"
                  }`}
              >
                <div className="flex items-start gap-4">
                  <div
                    className={`shrink-0 w-12 h-12 rounded-2xl flex items-center justify-center ${isDarkMode
                        ? "bg-cyan-500/10 text-cyan-300"
                        : "bg-cyan-100 text-cyan-600"
                      }`}
                  >
                    <ScanSearch className="w-5 h-5" />
                  </div>

                  <div>
                    {!rawResponse ? (
                      <>
                        <h3 className={`text-sm font-bold ${isDarkMode ? "text-slate-100" : "text-slate-800"}`}>
                          準備開始骨骼辨識
                        </h3>

                        <p className={`mt-2 text-sm leading-relaxed ${isDarkMode ? "text-slate-400" : "text-slate-500"}`}>
                          上傳 X 光影像後，點選「開始辨識（模型）」即可查看 AI 標註結果。
                        </p>

                        <p className={`mt-2 text-sm leading-relaxed ${isDarkMode ? "text-slate-500" : "text-slate-400"}`}>
                          建議使用清晰、骨骼區域完整入鏡的影像；也可以先用左側的「查看範例影像庫」體驗流程。
                        </p>
                      </>
                    ) : (
                      <>
                        <h3 className={`text-sm font-bold ${isDarkMode ? "text-amber-300" : "text-amber-700"}`}>
                          這張影像沒有辨識出骨骼
                        </h3>

                        <p className={`mt-2 text-sm leading-relaxed ${isDarkMode ? "text-slate-400" : "text-slate-500"}`}>
                          可能是影像不夠清晰、骨骼區域被裁切，或圖片內容不是系統目前支援的 X 光骨骼類型。
                        </p>

                        <p className={`mt-2 text-sm leading-relaxed ${isDarkMode ? "text-slate-500" : "text-slate-400"}`}>
                          建議換一張骨骼更完整、對比更明顯的 X 光影像，或先使用範例影像庫確認辨識流程。
                        </p>
                      </>
                    )}

                    <div className="mt-4 flex flex-wrap gap-2">
                      {[
                        rawResponse ? "請更換圖片" : "上傳後開始辨識",
                        "清晰 X 光",
                        "骨骼完整入鏡",
                        "可使用範例影像",
                      ].map((tip) => (
                        <span
                          key={tip}
                          className={`rounded-full px-3 py-1 text-xs ${rawResponse
                              ? isDarkMode
                                ? "bg-amber-500/10 text-amber-300"
                                : "bg-amber-50 text-amber-700 border border-amber-200"
                              : isDarkMode
                                ? "bg-slate-800 text-slate-300"
                                : "bg-white text-slate-500 border border-slate-200"
                            }`}
                        >
                          {tip}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <>
                <div className="flex flex-wrap gap-2 mb-4">
                  {detections.map((box) => (
                    <button
                      key={box.id}
                      onClick={() => setActiveId(box.id)}
                      className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${activeId === box.id
                        ? "bg-cyan-500 text-slate-900 shadow shadow-cyan-500/40"
                        : "bg-slate-800 text-slate-100 hover:bg-slate-700"
                        }`}
                    >
                      {getDisplayBoneName(box)}
                      {box.sub_label ? ` - ${box.sub_label}` : ""}
                    </button>
                  ))}
                </div>
                <div className="mt-2 text-xs space-y-3 card border border-slate-800 flex-1 overflow-auto rounded-xl">
                  {activeBox ? (
                    <>
                      <p className="flex items-center gap-2 text-slate-400 flex-wrap">
                        {t("bonevision.detectedPart")}：

                        <span className="font-semibold text-cyan-300">
                          {getDisplayBoneName(activeBox)}
                        </span>

                        <span className="text-slate-500">
                          conf {activeBox.conf.toFixed(3)}
                        </span>

                        {/* conf tooltip */}
                        {/* conf tooltip */}
                        <div className="relative group">
                          <div
                            className={`
      w-5 h-5 rounded-full
      flex items-center justify-center
      text-[11px] font-bold
      cursor-help transition-colors
      ${isDarkMode
                                ? "bg-slate-700 text-slate-200 hover:bg-slate-600"
                                : "bg-slate-200 text-slate-600 hover:bg-slate-300"
                              }
    `}
                          >
                            ?
                          </div>

                          <div
                            className={`
      absolute left-1/2 top-[130%]
      -translate-x-1/2
      w-72
      rounded-2xl
      border
      px-4 py-3
      text-xs leading-relaxed
      shadow-2xl
      opacity-0 invisible
      group-hover:opacity-100
      group-hover:visible
      transition-all
      z-50
      ${isDarkMode
                                ? "bg-slate-800 border-slate-600 text-slate-200 shadow-black/40"
                                : "bg-white border-slate-200 text-slate-600"
                              }
    `}
                          >
                            <span
                              className={
                                isDarkMode
                                  ? "font-semibold text-white"
                                  : "font-semibold text-slate-800"
                              }
                            >
                              conf（Confidence）
                            </span>

                            <br />
                            <br />

                            AI 對這次辨識結果的信心程度。

                            數值越接近 1，
                            代表模型越確定這個骨骼辨識是正確的。

                            <br />
                            <br />

                            一般來說：
                            <br />
                            0.9↑ = 非常高信心
                            <br />
                            0.7 ~ 0.9 = 可接受
                            <br />
                            0.5↓ = 建議人工再確認
                          </div>
                        </div>
                      </p>
                      {activeBox.sub_label && (
                        <p className="text-slate-400 mt-1">
                          {t("bonevision.subLabel")}{"： "}
                          <span className="font-semibold text-emerald-300">
                            {activeBox.sub_label}
                          </span>
                        </p>
                      )}

                      <hr className="border-slate-800" />

                      <p>
                        <span className="text-slate-400">{t("bonevision.boneName")}{"："}</span>
                        <span className="font-semibold text-slate-100">
                          {cleanBoneZh(activeBox.bone_info?.bone_zh) ?? "—"}{" "}
                        </span>
                        <span className="text-slate-500">
                          {cleanText(activeBox.bone_info?.bone_en)
                            ? `(${cleanText(activeBox.bone_info?.bone_en)})`
                            : ""}
                        </span>
                      </p>

                      <p>
                        <span className="text-slate-400">{t("bonevision.region")}{"："}</span>
                        <span className="text-slate-100">
                          {activeBox.bone_info?.bone_region ?? "—"}
                        </span>
                      </p>

                      <div>
                        <p className="text-slate-400 mb-1">{t("bonevision.description")}{"："}</p>
                        <p className="text-slate-100 whitespace-pre-wrap leading-relaxed">
                          {activeBox.bone_info?.bone_desc ?? "—"}
                        </p>
                      </div>

                      <div className="mt-6 flex flex-wrap gap-3">
                        <button
                          onClick={() => {
                            if (!imageCaseId) {
                              alert("目前沒有 ImageCaseId（/predict 需要回傳 image_case_id 才能帶入 S2）");
                              return;
                            }
                            const boneId = activeBox.bone_info?.bone_id ?? "";
                            const url =
                              `/llm?caseId=${encodeURIComponent(String(imageCaseId))}` +
                              (boneId ? `&boneId=${encodeURIComponent(String(boneId))}` : "");
                            router.push(url);
                          }}
                          disabled={!imageCaseId}
                          className="inline-flex items-center gap-1 px-4 py-2 rounded-xl text-xs font-semibold
      bg-cyan-500 text-slate-900 shadow shadow-cyan-500/40
      hover:bg-cyan-400 transition-colors
      disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {t("bonevision.queryKnowledge")}
                        </button>

                        <button
                          onClick={() => {
                            const boneId = activeBox.bone_info?.bone_id;
                            if (!boneId) {
                              alert("目前沒有可對應的 3D 模型資料");
                              return;
                            }
                            router.push(`/model?boneId=${encodeURIComponent(String(boneId))}`);
                          }}
                          className="inline-flex items-center gap-1 px-4 py-2 rounded-xl text-xs font-semibold
      border border-slate-600 text-slate-100
      hover:bg-slate-800 transition-colors"
                        >
                          {t("bonevision.view3dModel")}
                        </button>
                      </div>

                      <div
                        className={`mt-8 pt-6 border-t ${isDarkMode ? "border-slate-800" : "border-slate-200"
                          }`}
                      >
                        <div className="flex items-center justify-between gap-4 flex-wrap">
                          <div>
                            <p
                              className={`text-sm font-bold ${isDarkMode ? "text-slate-100" : "text-slate-900"
                                }`}
                            >
                              整張 X 光影像測驗
                            </p>

                            <p
                              className={`mt-1 text-xs leading-relaxed ${isDarkMode ? "text-slate-400" : "text-slate-500"
                                }`}
                            >
                              根據目前影像中的所有辨識框，自動產生互動式選擇題。
                            </p>
                          </div>

                          <button
                            onClick={handleStartQuiz}
                            disabled={loadingQuiz}
                            className="inline-flex items-center justify-center rounded-2xl px-6 py-3
        bg-emerald-400 text-slate-950 text-sm font-bold
        hover:bg-emerald-300 transition-colors
        disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {loadingQuiz ? "載入測驗..." : "開始測驗"}
                          </button>
                        </div>
                      </div>


                    </>
                  ) : (
                    <p className="text-xs text-slate-500">
                      請從上方選擇一個偵測框，這裡會顯示該部位的資料。
                    </p>
                  )}
                </div>
              </>
            )}
          </div>
        </section>
      </main>

      {isGalleryOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className={`absolute inset-0 ${isDarkMode ? "bg-black/70" : "bg-black/35"
              }`}
            onClick={() => setIsGalleryOpen(false)}
          />

          <div
            className={`relative w-full max-w-7xl h-[88vh] rounded-[28px] overflow-hidden shadow-2xl border ${modalSurfaceClass} flex flex-col`}
          >
            <div
              className={`absolute inset-x-0 top-0 h-28 pointer-events-none ${isDarkMode
                ? "bg-gradient-to-r from-cyan-500/10 via-sky-500/5 to-fuchsia-500/10"
                : "bg-gradient-to-r from-cyan-500/8 via-sky-500/6 to-fuchsia-500/8"
                }`}
            />

            <div
              className={`relative shrink-0 flex items-start justify-between gap-4 px-7 py-6 border-b ${modalBorderClass}`}
            >
              <div>
                <h3 className="text-2xl font-bold tracking-tight">範例影像庫</h3>
                <p className={`text-sm mt-2 ${modalTextSubClass}`}>
                  可直接使用該部位影像進行辨識，或下載到本機
                </p>
              </div>

              <button
                type="button"
                onClick={() => setIsGalleryOpen(false)}
                className={`px-5 py-3 rounded-2xl border text-sm font-medium transition-colors ${modalButtonClass}`}
              >
                關閉
              </button>
            </div>

            <div className={`relative shrink-0 px-7 py-6 border-b ${modalBorderClass}`}>
              <div className="mb-4">
                <div
                  className={`flex items-center gap-3 rounded-2xl border px-4 py-3 ${isDarkMode
                    ? "border-slate-700 bg-slate-900 text-slate-100"
                    : "border-slate-300 bg-white text-slate-900"
                    }`}
                >
                  <span className="text-sm opacity-70">搜尋</span>

                  <input
                    value={galleryKeyword}
                    onChange={(e) => setGalleryKeyword(e.target.value)}
                    placeholder="可搜尋骨骼中文名稱、英文名稱、部位或口語描述"
                    className={`flex-1 bg-transparent text-sm outline-none ${isDarkMode ? "placeholder:text-slate-500" : "placeholder:text-slate-400"
                      }`}
                  />

                  {galleryKeyword.trim() && (
                    <button
                      type="button"
                      onClick={() => setGalleryKeyword("")}
                      className={`text-xs rounded-full px-3 py-1 border transition-colors ${isDarkMode
                        ? "border-slate-700 text-slate-300 hover:bg-slate-800"
                        : "border-slate-300 text-slate-600 hover:bg-slate-100"
                        }`}
                    >
                      清除
                    </button>
                  )}
                </div>

                <p className={`mt-2 text-xs ${modalTextSubClass}`}>
                  可搜尋目前範例影像庫中的骨骼中文名稱、英文名稱或部位。
                </p>
              </div>

              {/* 小螢幕：下拉選單 */}
              <div className="block sm:hidden">
                <select
                  value={galleryFilter}
                  onChange={(e) => setGalleryFilter(e.target.value)}
                  className={`w-full rounded-2xl border px-4 py-3 text-sm outline-none ${isDarkMode
                    ? "border-slate-700 bg-slate-900 text-slate-100"
                    : "border-slate-300 bg-white text-slate-900"
                    }`}
                >
                  {filterOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </div>

              {/* 平板以上：分類按鈕 */}
              <div className="hidden sm:flex flex-wrap gap-2">
                {filterOptions.map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setGalleryFilter(option)}
                    className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${galleryFilter === option
                      ? "bg-cyan-500 text-slate-900"
                      : filterInactiveClass
                      }`}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </div>

            <div
              className={`flex-1 min-h-0 overflow-y-auto overscroll-contain p-7 pb-10 ${modalSubBgClass}`}
            >
              {filteredSamples.length === 0 ? (
                <div className={`text-sm text-center py-12 ${modalTextSubClass}`}>
                  {galleryKeyword.trim()
                    ? `查無「${galleryKeyword}」符合的範例影像，請改用骨骼名稱、英文名稱或分類按鈕搜尋。`
                    : "目前這個分類尚無範例影像"}
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-6">
                  {filteredSamples.map((sample) => (
                    <div
                      key={sample.id}
                      className={`rounded-[24px] overflow-hidden border ${cardClass}`}
                    >
                      <div className="relative">
                        <div
                          className={`absolute top-4 left-4 z-10 rounded-full px-3 py-1 text-[11px] border ${categoryBadgeClass}`}
                        >
                          {sample.bone_zh ? cleanBoneZh(sample.bone_zh) : "未分類"}
                        </div>

                        <div
                          className={`h-[290px] flex items-center justify-center ${imageFrameClass}`}
                        >
                          <img
                            src={`${API_BASE}${sample.preview_url}`}
                            alt={sample.bone_zh ? cleanBoneZh(sample.bone_zh) : sample.name}
                            className="max-h-[245px] max-w-[88%] object-contain"
                          />
                        </div>
                      </div>

                      <div className="p-5">
                        <h4 className="text-xl font-semibold">
                          {sample.bone_zh ? cleanBoneZh(sample.bone_zh) : sample.name}
                        </h4>

                        <p className={`mt-2 text-sm ${modalTextSubClass}`}>
                          {cleanText(sample.bone_en) || "未提供英文名稱"}
                        </p>

                        <p className={`mt-1 text-xs ${modalTextSubClass}`}>
                          {sample.bone_region || "未分類區域"}
                        </p>

                        <p className={`mt-2 text-xs line-clamp-2 ${modalTextSubClass}`}>
                          {sample.bone_desc || "目前無描述"}
                        </p>

                        <div className="mt-5 grid grid-cols-2 gap-3">
                          <button
                            type="button"
                            onClick={() => handleUseSampleImage(sample)}
                            className="rounded-2xl py-3 text-sm font-semibold bg-cyan-500 text-slate-900 hover:bg-cyan-400 transition-colors"
                          >
                            使用此照片
                          </button>

                          <button
                            type="button"
                            onClick={() => handleDownloadSampleImage(sample)}
                            className={`rounded-2xl py-3 text-sm font-semibold border transition-colors ${secondaryActionClass}`}
                          >
                            下載照片
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}


      {isHistoryOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className={`absolute inset-0 ${isDarkMode ? "bg-black/70" : "bg-black/35"}`}
            onClick={() => setIsHistoryOpen(false)}
          />

          <div
            className={`relative w-full max-w-7xl h-[88vh] rounded-[28px] shadow-2xl border ${modalSurfaceClass} flex flex-col overflow-hidden`}
          >
            <div className={`shrink-0 px-7 py-6 border-b ${modalBorderClass}`}>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-2xl font-bold tracking-tight">歷史紀錄</h3>
                  <p className={`text-sm mt-2 ${modalTextSubClass}`}>
                    查看個人辨識歷程與後續紀錄
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => setIsHistoryOpen(false)}
                  className={`px-5 py-3 rounded-2xl border text-sm font-medium transition-colors ${modalButtonClass}`}
                >
                  關閉
                </button>
              </div>
            </div>

            {!currentUser ? (
              <div className="flex-1 min-h-0 px-8 py-16 flex flex-col items-center justify-center text-center overflow-y-auto">
                <p className="text-lg font-semibold">
                  請先登入或註冊後查看歷史紀錄
                </p>

                <p className={`mt-2 text-sm ${modalTextSubClass}`}>
                  登入後即可查看個人辨識歷程與後續紀錄
                </p>

                <div className="mt-6 flex gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      window.location.href = "https://140.136.155.157/auth?mode=login";
                    }}
                    className="rounded-2xl px-6 py-3 text-sm font-semibold bg-cyan-500 text-slate-900 hover:bg-cyan-400 transition-colors"
                  >
                    前往登入
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      window.location.href = "https://140.136.155.157/auth?mode=register";
                    }}
                    className={`rounded-2xl px-6 py-3 text-sm font-semibold border transition-colors ${secondaryActionClass}`}
                  >
                    前往註冊
                  </button>
                </div>
              </div>
            ) : (
              <div className={`flex-1 min-h-0 grid grid-cols-1 md:grid-cols-[340px_minmax(0,1fr)] ${modalSubBgClass}`}>
                <div className={`border-r ${modalBorderClass} flex flex-col min-h-0`}>
                  <div className="shrink-0 p-4">
                    <input
                      type="text"
                      value={historyKeyword}
                      onChange={(e) => setHistoryKeyword(e.target.value)}
                      placeholder="搜尋歷史紀錄"
                      className={`w-full rounded-2xl border px-4 py-3 text-sm outline-none ${isDarkMode
                        ? "border-slate-700 bg-slate-900 text-slate-100 placeholder:text-slate-500"
                        : "border-slate-300 bg-white text-slate-900 placeholder:text-slate-400"
                        }`}
                    />
                  </div>

                  <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 pb-4 space-y-3">
                    {loadingHistory && (
                      <div className={`text-sm ${modalTextSubClass}`}>載入中...</div>
                    )}

                    {!loadingHistory && historyError && (
                      <div className="text-sm text-red-400 whitespace-pre-wrap break-words">
                        {historyError}
                      </div>
                    )}

                    {!loadingHistory && !historyError && filteredHistoryList.length === 0 && (
                      <div className={`text-sm ${modalTextSubClass}`}>尚無歷史紀錄</div>
                    )}

                    {!loadingHistory &&
                      !historyError &&
                      filteredHistoryList.map((item) => {
                        const selected = selectedHistoryId === item.image_case_id;
                        return (
                          <button
                            key={item.image_case_id}
                            type="button"
                            onClick={() => loadHistoryDetail(item.image_case_id)}
                            className={`w-full text-left rounded-2xl border p-4 transition-colors ${selected
                              ? isDarkMode
                                ? "border-cyan-400 bg-cyan-500/10"
                                : "border-cyan-500 bg-cyan-50"
                              : isDarkMode
                                ? "border-slate-800 bg-slate-900 hover:bg-slate-800"
                                : "border-slate-200 bg-white hover:bg-slate-50"
                              }`}
                          >
                            <div className="text-sm font-semibold">
                              {item.image_name || `案例 ${item.image_case_id}`}
                            </div>
                            <div className={`mt-1 text-xs ${modalTextSubClass}`}>
                              {formatDateTime(item.created_at)}
                            </div>
                            <div className="mt-2 text-xs text-cyan-400">
                              偵測數量：{item.detection_count ?? 0}
                            </div>
                          </button>
                        );
                      })}
                  </div>
                </div>

                <div className="flex flex-col min-h-0">
                  <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-6">
                    {!selectedHistoryDetail ? (
                      <div className={`h-full flex items-center justify-center text-sm ${modalTextSubClass}`}>
                        請從左側選擇一筆歷史紀錄
                      </div>
                    ) : loadingHistoryDetail ? (
                      <div className={`text-sm ${modalTextSubClass}`}>載入詳細資料中...</div>
                    ) : (
                      <div className="space-y-5 pb-2">
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <div className={`text-sm ${modalTextSubClass}`}>
                              {formatDateTime(selectedHistoryDetail.created_at)}
                            </div>
                            <h4 className="mt-1 text-2xl font-bold">
                              {selectedHistoryDetail.image_name || `案例 ${selectedHistoryDetail.image_case_id}`}
                            </h4>
                            <div className={`mt-2 text-sm ${modalTextSubClass}`}>
                              偵測數量：{selectedHistoryDetail.detection_count ?? 0}
                            </div>
                          </div>

                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                applyHistoryDetailToCanvas(selectedHistoryDetail);
                                setIsHistoryOpen(false);
                                router.push(`/bonevision?caseId=${selectedHistoryDetail.image_case_id}`);
                              }}
                              className="flex items-center gap-2 rounded-2xl bg-cyan-500 px-5 py-2.5 text-sm font-semibold text-slate-900 hover:bg-cyan-400 transition-colors"
                            >
                              回到辨識
                            </button>

                            <button
                              type="button"
                              disabled={loadingHistoryDetail}
                              onClick={() => handleDeleteHistory(selectedHistoryDetail.image_case_id)}
                              className="flex items-center gap-2 rounded-2xl border border-red-300 px-5 py-2.5 text-sm font-semibold text-red-500 hover:bg-red-50 transition-colors disabled:opacity-50"
                            >
                              刪除
                            </button>
                          </div>
                        </div>

                        {selectedHistoryDetail.bone_image_id != null && (
                          <div className={`rounded-3xl border p-4 ${cardClass}`}>
                            <div className={`mb-3 text-sm ${modalTextSubClass}`}>影像預覽</div>
                            <div className="flex items-center justify-center">
                              <img
                                src={`${HISTORY_IMAGE_URL}/${selectedHistoryDetail.bone_image_id}`}
                                alt={selectedHistoryDetail.image_name || "history preview"}
                                className="max-h-[280px] max-w-full object-contain rounded-2xl"
                                onError={(e) => {
                                  console.error("history preview failed:", {
                                    bone_image_id: selectedHistoryDetail.bone_image_id,
                                    src: (e.currentTarget as HTMLImageElement).src,
                                    detail: selectedHistoryDetail,
                                  });
                                }}
                              />
                            </div>
                          </div>
                        )}

                        <div className={`rounded-3xl border p-4 ${cardClass}`}>
                          <div className={`mb-3 text-sm ${modalTextSubClass}`}>辨識項目</div>
                          {selectedHistoryDetail.detections.length === 0 ? (
                            <div className={`text-sm ${modalTextSubClass}`}>這筆紀錄沒有 detection。</div>
                          ) : (
                            <div className="space-y-3">
                              {selectedHistoryDetail.detections.map((d, idx) => (
                                <div
                                  key={d.detection_id}
                                  className={`rounded-2xl border px-4 py-3 ${isDarkMode ? "border-slate-800" : "border-slate-200"}`}
                                >
                                  <div className="text-sm font-semibold">
                                    {d.bone_info?.bone_zh ||
                                      (d.label41 != null ? `label41=${d.label41}` : `Detection ${idx + 1}`)}
                                  </div>
                                  <div className={`mt-1 text-xs ${modalTextSubClass}`}>
                                    confidence: {typeof d.confidence === "number" ? d.confidence.toFixed(3) : "—"}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            <div
              className={`shrink-0 px-8 py-4 border-t text-xs ${modalBorderClass} ${modalTextSubClass}`}
            >
              按 ESC 可關閉
            </div>
          </div>
        </div>
      )}
      {isQuizOpen && quizData && (
        <div
          className={`fixed inset-0 z-[100] flex items-center justify-center p-6 ${isDarkMode ? "bg-black/70" : "bg-black/45"
            }`}
        >
          <div
            className={`w-full max-w-6xl h-[88vh] rounded-[32px] overflow-hidden flex shadow-2xl border ${isDarkMode
              ? "border-slate-800 bg-slate-950 text-slate-100"
              : "border-slate-200 bg-white text-slate-900"
              }`}
          >
            {/* 左邊 */}
            <div
              className={`w-[48%] border-r p-6 flex flex-col ${isDarkMode ? "border-slate-800" : "border-slate-200"
                }`}
            >
              <div
                className={`text-lg font-bold mb-4 ${isDarkMode ? "text-white" : "text-slate-900"
                  }`}
              >
                骨骼辨識測驗
              </div>

              <div
                className={`flex-1 flex items-center justify-center rounded-3xl overflow-hidden ${isDarkMode ? "bg-slate-900" : "bg-slate-100"
                  }`}
              >
                <div ref={quizDisplayRef} className="relative">
                  <img
                    src={previewUrl || ""}
                    alt="quiz"
                    className="max-w-full max-h-[520px] object-contain"
                    onLoad={measureQuizLayout}
                  />

                  {(() => {
                    const q = quizData?.questions?.[quizIndex];
                    const poly = q?.poly || [];
                    const points = quizPolyToPoints(poly);

                    if (!points) return null;

                    return (
                      <svg
                        className="absolute inset-0 w-full h-full pointer-events-none"
                        viewBox={`0 0 ${quizImgBox.width || 100} ${quizImgBox.height || 100}`}
                        preserveAspectRatio="none"
                        style={{ zIndex: 20 }}
                      >
                        <polygon
                          points={points}
                          fill="rgba(34, 211, 238, 0.20)"
                          stroke="#22d3ee"
                          strokeWidth={4}
                          className="drop-shadow-[0_0_14px_rgba(34,211,238,0.9)]"
                        />
                      </svg>
                    );
                  })()}
                </div>
              </div>

              <div
                className={`mt-4 text-xs ${isDarkMode ? "text-slate-400" : "text-slate-500"
                  }`}
              >
                題目 {quizIndex + 1} / {quizData.questions.length}
              </div>
            </div>

            {/* 右邊 */}
            <div
              className={`flex-1 p-8 overflow-y-auto ${isDarkMode ? "bg-slate-950" : "bg-slate-50"
                }`}
            >
              {!quizFinished ? (
                (() => {
                  const q = quizData.questions[quizIndex];
                  const selectedAnswer = quizAnswers[quizIndex];
                  const hasAnswered = Boolean(selectedAnswer);

                  return (
                    <>
                      <div
                        className="
                    inline-flex items-center rounded-full
                    bg-cyan-500/10 text-cyan-400
                    px-3 py-1 text-xs font-semibold mb-4
                  "
                      >
                        骨骼測驗
                      </div>

                      <h2
                        className={`text-2xl font-bold leading-relaxed ${isDarkMode ? "text-white" : "text-slate-900"
                          }`}
                      >
                        {q.question}
                      </h2>

                      <div className="mt-8 space-y-4">
                        {q.options.map((opt: string) => {
                          const isSelected = selectedAnswer === opt;
                          const isCorrect = opt === q.correct_answer;
                          const isWrongSelected = isSelected && !isCorrect;

                          return (
                            <button
                              key={opt}
                              disabled={hasAnswered}
                              onClick={() => {
                                setQuizAnswers((prev) => ({
                                  ...prev,
                                  [quizIndex]: opt,
                                }));
                              }}
                              className={`
                          w-full rounded-2xl border px-5 py-4 text-left transition-all
                          disabled:cursor-default
                          ${hasAnswered && isCorrect
                                  ? "border-emerald-400 bg-emerald-50 text-emerald-700"
                                  : hasAnswered && isWrongSelected
                                    ? "border-red-400 bg-red-50 text-red-600"
                                    : isSelected
                                      ? "border-cyan-400 bg-cyan-50 text-cyan-700"
                                      : isDarkMode
                                        ? "border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800"
                                        : "border-slate-300 bg-white text-slate-800 hover:bg-slate-100"
                                }
                        `}
                            >
                              <div className="flex items-center justify-between gap-3">
                                <span>{opt}</span>

                                {hasAnswered && isCorrect && (
                                  <span className="text-sm font-bold">✓ 正確</span>
                                )}

                                {hasAnswered && isWrongSelected && (
                                  <span className="text-sm font-bold">✕ 錯誤</span>
                                )}
                              </div>
                            </button>
                          );
                        })}
                      </div>

                      {hasAnswered && (
                        <div
                          className={`
                      mt-6 rounded-2xl border px-5 py-4 text-sm leading-relaxed
                      ${selectedAnswer === q.correct_answer
                              ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                              : "border-red-300 bg-red-50 text-red-600"
                            }
                    `}
                        >
                          <div className="font-bold mb-1">
                            {selectedAnswer === q.correct_answer
                              ? "答對了！"
                              : "答錯了"}
                          </div>

                          <div>正確答案：{q.correct_answer}</div>

                          {q.explanation && (
                            <div className="mt-2 opacity-90">
                              說明：{q.explanation}
                            </div>
                          )}
                        </div>
                      )}

                      <div className="mt-8 flex justify-between">
                        <button
                          onClick={() => setIsQuizOpen(false)}
                          className={`px-5 py-3 rounded-2xl border ${isDarkMode
                            ? "border-slate-700 text-slate-300 hover:bg-slate-800"
                            : "border-slate-300 text-slate-600 hover:bg-slate-100"
                            }`}
                        >
                          關閉
                        </button>

                        <button
                          disabled={!hasAnswered}
                          onClick={() => {
                            if (selectedAnswer === q.correct_answer) {
                              setQuizScore((prev) => prev + 1);
                            }

                            if (quizIndex + 1 >= quizData.questions.length) {
                              setQuizFinished(true);
                            } else {
                              setQuizIndex((prev) => prev + 1);

                              requestAnimationFrame(() => {
                                measureQuizLayout();
                              });
                            }
                          }}
                          className="
                      px-6 py-3 rounded-2xl
                      bg-cyan-500 text-slate-950 font-semibold
                      hover:bg-cyan-400
                      disabled:opacity-50 disabled:cursor-not-allowed
                    "
                        >
                          {quizIndex + 1 >= quizData.questions.length
                            ? "完成測驗"
                            : "下一題"}
                        </button>
                      </div>
                    </>
                  );
                })()
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-center">
                  <div className="mb-6 flex justify-center">
                    <video
                      src="/video/800171160.433056.mp4"
                      autoPlay
                      muted
                      playsInline
                      className="w-40 h-40 object-contain"
                    />
                  </div>

                  <h2
                    className={`text-3xl font-bold ${isDarkMode ? "text-white" : "text-slate-900"
                      }`}
                  >
                    測驗完成
                  </h2>

                  <p
                    className={`mt-4 text-xl ${isDarkMode ? "text-cyan-300" : "text-cyan-600"
                      }`}
                  >
                    得分：{quizScore} / {quizData.questions.length}
                  </p>

                  <button
                    onClick={() => setIsQuizOpen(false)}
                    className="
                mt-8 px-6 py-3 rounded-2xl
                bg-cyan-500 text-slate-950 font-semibold
                hover:bg-cyan-400
              "
                  >
                    完成
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}