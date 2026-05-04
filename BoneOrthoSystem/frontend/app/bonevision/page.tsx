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
    "的",
    "一下",
  ];

  const SAMPLE_SEARCH_KEYWORDS = [
    "顱骨",
    "胸椎",
    "腰椎",
    "鎖骨",
    "肩胛骨",
    "肱骨",
    "尺骨",
    "橈骨",
    "腕骨",
    "掌骨",
    "指骨",
    "肋骨",
    "胸骨",
    "股骨",
    "脛骨",
    "腓骨",
    "上肢",
    "下肢",
    "手",
    "腳",
    "skull",
    "humerus",
    "humeri",
    "ulna",
    "radius",
    "femur",
    "tibia",
    "fibula",
    "clavicle",
    "scapula",
    "sternum",
    "rib",
    "ribs",
  ];

  const extractGallerySearchTerms = (keyword: string) => {
    let q = normalizeKeyword(keyword);
    if (!q) return [];

    SAMPLE_SEARCH_STOP_WORDS.forEach((word) => {
      q = q.replaceAll(normalizeKeyword(word), "");
    });

    const matchedTerms = SAMPLE_SEARCH_KEYWORDS
      .map(normalizeKeyword)
      .filter((term) => term.length >= 2 && q.includes(term));

    if (matchedTerms.length > 0) {
      return matchedTerms;
    }

    return q.length >= 2 ? [q] : [];
  };

  const isSampleMatchedByKeyword = (img: SampleImage, keyword: string) => {
    const q = normalizeKeyword(keyword);
    if (!q) return true;

    const nameFields = [
      cleanBoneZh(img.bone_zh),
      cleanText(img.bone_en),
      img.name,
      img.filename,
      img.category,
    ]
      .map(normalizeKeyword)
      .join(" ");

    const regionFields = [cleanText(img.bone_region)]
      .map(normalizeKeyword)
      .join(" ");

    // 1. 先比對骨頭名稱、英文名稱、檔名、分類
    if (nameFields.includes(q)) return true;

    // 2. 只有使用者明確搜部位時，才比對部位
    const regionKeywords = ["上肢", "下肢", "頭部", "胸部", "軀幹", "手", "足", "腳"];
    const isRegionSearch = regionKeywords.some((word) =>
      normalizeKeyword(word).includes(q) || q.includes(normalizeKeyword(word))
    );

    if (isRegionSearch && regionFields.includes(q)) return true;

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
        sub_label: null,
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

    const token = localStorage.getItem("galabone_access_token");

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
            <h2 className="text-sm font-semibold mb-3">資料與設定</h2>

            <div className="space-y-3">
              <div>
                <span className="text-xs text-slate-400">上傳 X 光影像</span>

                <label className="block mt-1">
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleFileChange}
                    className="block w-full text-sm text-slate-200
                   file:mr-4 file:py-2.5 file:px-4
                   file:rounded-full file:border-0
                   file:text-sm file:font-semibold
                   file:bg-cyan-500 file:text-slate-900
                   hover:file:bg-cyan-400 cursor-pointer"
                  />
                </label>
              </div>

              <button
                type="button"
                onClick={() => {
                  setGalleryFilter("全部");
                  setIsGalleryOpen(true);
                }}
                className="w-full rounded-full py-2.5 text-sm font-semibold
               border border-cyan-500/40 text-cyan-300
               bg-cyan-500/10 hover:bg-cyan-500/15
               transition-colors"
              >
                查看範例影像庫
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
              {loading ? "辨識中..." : "開始辨識（模型）"}
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
              歷史紀錄
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
              <h2 className="text-sm font-semibold">影像預覽與結果</h2>
              <div className="flex items-center gap-2 text-xs text-slate-300">
                <span>Zoom</span>
                <button
                  onClick={handleZoomOut}
                  className="w-6 h-6 rounded-full border border-slate-600 flex items-center justify-center hover:bg-slate-700"
                >
                  −
                </button>
                <span className="w-12 text-center">
                  {Math.round(zoom * 100)}%
                </span>
                <button
                  onClick={handleZoomIn}
                  className="w-6 h-6 rounded-full border border-slate-600 flex items-center justify-center hover:bg-slate-700"
                >
                  +
                </button>
                <button
                  onClick={handleResetView}
                  className="ml-2 px-2 py-1 rounded-full border border-slate-600 hover:bg-slate-700"
                >
                  Reset
                </button>

                <button
                  onClick={() => setShowOnlyActive((v) => !v)}
                  className={`ml-2 px-2 py-1 rounded-full border text-[11px] ${showOnlyActive
                    ? "border-cyan-400 bg-cyan-500/20 text-cyan-300"
                    : "border-slate-600 hover:bg-slate-700 text-slate-300"
                    }`}
                >
                  {showOnlyActive ? "顯示全部框" : "只顯示目前框"}
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
                      className="absolute inset-0 w-full h-full pointer-events-none"
                      viewBox={`0 0 ${imgBox.width || 100} ${imgBox.height || 100}`}
                      preserveAspectRatio="none"
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
                                fill="none"
                                stroke="#0ea5e9"
                                strokeWidth={2}
                                opacity={0.7}
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
                              fill="none"
                              stroke="#22d3ee"
                              strokeWidth={4}
                              className="drop-shadow-[0_0_12px_rgba(34,211,238,0.9)]"
                            />
                          );
                        })()}
                    </svg>
                  )}
                </div>
              ) : (
                <p className="text-xs text-slate-500">
                  尚未上傳圖片，請先選擇一張 X 光影像。
                </p>
              )}
            </div>

            <p className="mt-3 text-xs text-slate-400">
              已偵測到{" "}
              <span className="text-cyan-400 font-semibold">
                {detections.length}
              </span>{" "}
              個骨骼框
            </p>
          </div>
        </section>

        <section className="w-full lg:w-7/20">
          <div className="card border border-slate-800 rounded-2xl h-full flex flex-col">
            <h2 className="text-sm font-semibold mb-3">辨識出的部位</h2>

            {detections.length === 0 ? (
              <p className="text-xs text-slate-500">
                尚未有偵測結果，請上傳圖片並點選「開始辨識（模型）」。
              </p>
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
                      {box.sub_label ? ` - ${box.sub_label}` : ""}{" "}
                      <span className="opacity-70">({box.conf.toFixed(2)})</span>
                    </button>
                  ))}
                </div>
                <div className="mt-2 text-xs space-y-3 card border border-slate-800 flex-1 overflow-auto rounded-xl">
                  {activeBox ? (
                    <>
                      <p className="text-slate-400">
                        辨識部位：{" "}
                        <span className="font-semibold text-cyan-300">
                          {getDisplayBoneName(activeBox)}
                        </span>{" "}
                        <span className="ml-1 text-slate-500">
                          conf {activeBox.conf.toFixed(3)}
                        </span>
                      </p>
                      {activeBox.sub_label && (
                        <p className="text-slate-400 mt-1">
                          節數 / 小類：{" "}
                          <span className="font-semibold text-emerald-300">
                            {activeBox.sub_label}
                          </span>
                        </p>
                      )}

                      <hr className="border-slate-800" />

                      <p>
                        <span className="text-slate-400">骨頭名稱：</span>
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
                        <span className="text-slate-400">部位區域：</span>
                        <span className="text-slate-100">
                          {activeBox.bone_info?.bone_region ?? "—"}
                        </span>
                      </p>

                      <div>
                        <p className="text-slate-400 mb-1">說明：</p>
                        <p className="text-slate-100 whitespace-pre-wrap leading-relaxed">
                          {activeBox.bone_info?.bone_desc ?? "—"}
                        </p>
                      </div>

                      <div className="mt-2 flex flex-wrap gap-2">
                        <button
                          onClick={() => {
                            if (!imageCaseId) {
                              alert(
                                "目前沒有 ImageCaseId（/predict 需要回傳 image_case_id 才能帶入 S2）"
                              );
                              return;
                            }
                            const boneId = activeBox.bone_info?.bone_id ?? "";
                            const url =
                              `/llm?caseId=${encodeURIComponent(String(imageCaseId))}` +
                              (boneId
                                ? `&boneId=${encodeURIComponent(String(boneId))}`
                                : "");
                            router.push(url);
                          }}
                          disabled={!imageCaseId}
                          className="inline-flex items-center gap-1 px-4 py-2 rounded-xl text-xs font-semibold
               bg-cyan-500 text-slate-900 shadow shadow-cyan-500/40
               hover:bg-cyan-400 transition-colors
               disabled:opacity-50 disabled:cursor-not-allowed"
                          title={
                            imageCaseId
                              ? "前往 LLM（會帶入本次辨識結果）"
                              : "需要 /predict 回傳 image_case_id 才能使用"
                          }
                        >
                          查詢知識庫
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
                          title="查看此部位的 3D 模型"
                        >
                          查看此部位 3D 模型
                        </button>
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
                    placeholder="輸入骨骼名稱、英文名稱或部位，例如：尺骨、ulna、上肢"
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

                          <button
                            type="button"
                            onClick={() => {
                              applyHistoryDetailToCanvas(selectedHistoryDetail);
                              setIsHistoryOpen(false);
                              router.push(`/bonevision?caseId=${selectedHistoryDetail.image_case_id}`);
                            }}
                            className="rounded-2xl px-5 py-3 text-sm font-semibold bg-cyan-500 text-slate-900 hover:bg-cyan-400 transition-colors shrink-0"
                          >
                            回到這次辨識
                          </button>
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
    </div>
  );
}