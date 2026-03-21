// frontend/app/bonevision/page.tsx
"use client";

import React, {
  useState,
  useRef,
  useEffect,
  useCallback,
  MouseEvent,
} from "react";
import { useRouter } from "next/navigation";

const PREDICT_URL = "http://127.0.0.1:8000/predict";

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

type SampleCategory = "全部" | "手部" | "足部" | "脊椎";

type SampleImage = {
  id: number;
  name: string;
  url: string;
  filename: string;
  category: Exclude<SampleCategory, "全部">;
};

const SAMPLE_IMAGES: SampleImage[] = [
  {
    id: 1,
    name: "手部 X 光 01",
    url: "/sample-xrays/xray-hand-1.jpg",
    filename: "xray-hand-1.jpg",
    category: "手部",
  },
  {
    id: 2,
    name: "手部 X 光 02",
    url: "/sample-xrays/xray-hand-2.jpg",
    filename: "xray-hand-2.jpg",
    category: "手部",
  },
  {
    id: 3,
    name: "足部 X 光 01",
    url: "/sample-xrays/xray-foot-1.jpg",
    filename: "xray-foot-1.jpg",
    category: "足部",
  },
  {
    id: 4,
    name: "足部 X 光 02",
    url: "/sample-xrays/xray-foot-2.jpg",
    filename: "xray-foot-2.jpg",
    category: "足部",
  },
  {
    id: 5,
    name: "脊椎 X 光 01",
    url: "/sample-xrays/xray-spine-1.jpg",
    filename: "xray-spine-1.jpg",
    category: "脊椎",
  },
  {
    id: 6,
    name: "脊椎 X 光 02",
    url: "/sample-xrays/xray-spine-2.jpg",
    filename: "xray-spine-2.jpg",
    category: "脊椎",
  },
];

const FILTER_OPTIONS: SampleCategory[] = ["全部", "手部", "足部", "脊椎"];

export default function BoneVisionPage() {
  const router = useRouter();

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
  const [galleryFilter, setGalleryFilter] = useState<SampleCategory>("全部");
  const [isDarkMode, setIsDarkMode] = useState(false);

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
    if (!isGalleryOpen) return;

    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") setIsGalleryOpen(false);
    };

    document.addEventListener("keydown", onKeyDown);
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = "";
    };
  }, [isGalleryOpen]);

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
        poly: (b.poly as number[][]).map((p) => [
          Number(p[0]),
          Number(p[1]),
        ]),
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

  const detectWithFile = async (targetFile: File) => {
    const fd = new FormData();
    fd.append("file", targetFile);

    const res = await fetch(PREDICT_URL, {
      method: "POST",
      body: fd,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`後端回傳錯誤 ${res.status}：${text}`);
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

      const res = await fetch(sample.url);
      if (!res.ok) throw new Error("無法載入範例圖片");

      const blob = await res.blob();
      const sampleFile = new File([blob], sample.filename, {
        type: blob.type || "image/jpeg",
      });

      setFile(sampleFile);
      resetDetectionState();
      setPreviewUrl(sample.url);
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
      const res = await fetch(sample.url);
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

  const filteredSamples =
    galleryFilter === "全部"
      ? SAMPLE_IMAGES
      : SAMPLE_IMAGES.filter((img) => img.category === galleryFilter);

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
        {/* 左側：上傳 & 控制 */}
        <section className="w-full lg:w-5/20 space-y-4">
          <div className="card border border-slate-800/70 shadow-xl shadow-slate-900/40">
            <h2 className="text-sm font-semibold mb-3">資料與設定</h2>

            <div className="space-y-2">
              <span className="text-xs text-slate-400">上傳 X 光影像</span>

              <label className="block">
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

            <div className="mt-3 text-[11px] text-slate-400">
              ImageCaseId：{" "}
              <span className="text-cyan-300 font-mono">
                {imageCaseId ?? "—"}
              </span>
            </div>

            {errorMsg && (
              <p className="mt-3 text-xs text-red-400 whitespace-pre-wrap">
                {errorMsg}
              </p>
            )}
          </div>

          <div className="card border border-slate-800 max-h-72 overflow-auto text-xs">
            <h3 className="text-xs font-semibold mb-2">辨識結果（原始 JSON）</h3>
            <pre className="whitespace-pre-wrap text-[11px] text-green-400">
              {rawResponse
                ? JSON.stringify(rawResponse, null, 2)
                : "// 目前尚無結果"}
            </pre>
          </div>
        </section>

        {/* 中間：影像 + OBB */}
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
                  className={`ml-2 px-2 py-1 rounded-full border text-[11px] ${
                    showOnlyActive
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
                      viewBox={`0 0 ${imgBox.width || 100} ${
                        imgBox.height || 100
                      }`}
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
              個骨骼框（Poly / OBB）
            </p>
          </div>
        </section>

        {/* 右側：骨骼列表 + 說明 */}
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
                      className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                        activeId === box.id
                          ? "bg-cyan-500 text-slate-900 shadow shadow-cyan-500/40"
                          : "bg-slate-800 text-slate-100 hover:bg-slate-700"
                      }`}
                    >
                      {box.cls_name}
                      {box.sub_label ? ` - ${box.sub_label}` : ""}{" "}
                      <span className="opacity-70">({box.conf.toFixed(2)})</span>
                    </button>
                  ))}
                </div>

                <div className="mt-2 text-xs space-y-3 card border border-slate-800 flex-1 overflow-auto rounded-xl">
                  {activeBox ? (
                    <>
                      <p className="text-slate-400">
                        模型類別名稱：{" "}
                        <span className="font-semibold text-cyan-300">
                          {activeBox.cls_name}
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
                          {activeBox.bone_info?.bone_zh ?? "—"}{" "}
                        </span>
                        <span className="text-slate-500">
                          {activeBox.bone_info?.bone_en
                            ? `(${activeBox.bone_info.bone_en})`
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
                            `/llm?caseId=${encodeURIComponent(
                              String(imageCaseId)
                            )}` +
                            (boneId
                              ? `&boneId=${encodeURIComponent(String(boneId))}`
                              : "");
                          router.push(url);
                        }}
                        disabled={!imageCaseId}
                        className="mt-2 inline-flex items-center gap-1 px-4 py-2 rounded-xl text-xs font-semibold
                                   bg-cyan-500 text-slate-900 shadow shadow-cyan-500/40
                                   hover:bg-cyan-400 transition-colors
                                   disabled:opacity-50 disabled:cursor-not-allowed"
                        title={
                          imageCaseId
                            ? "前往 LLM（會帶入本次辨識結果）"
                            : "需要 /predict 回傳 image_case_id 才能使用"
                        }
                      >
                        了解更多
                      </button>

                      <div className="mt-3">
                        <p className="text-slate-400 mb-1">
                          poly 座標（normalized 0–1）：
                        </p>
                        <pre className="text-[11px] text-green-400 whitespace-pre-wrap">
                          {JSON.stringify(activeBox.poly, null, 2)}
                        </pre>
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
            className={`absolute inset-0 ${
              isDarkMode ? "bg-black/70" : "bg-black/35"
            }`}
            onClick={() => setIsGalleryOpen(false)}
          />

          <div
            className={`relative w-full max-w-7xl max-h-[88vh] rounded-[28px] overflow-hidden shadow-2xl border ${modalSurfaceClass}`}
          >
            <div
              className={`absolute inset-x-0 top-0 h-28 pointer-events-none ${
                isDarkMode
                  ? "bg-gradient-to-r from-cyan-500/10 via-sky-500/5 to-fuchsia-500/10"
                  : "bg-gradient-to-r from-cyan-500/8 via-sky-500/6 to-fuchsia-500/8"
              }`}
            />

            <div
              className={`relative flex items-start justify-between gap-4 px-7 py-6 border-b ${modalBorderClass}`}
            >
              <div>
                <h3 className="text-2xl font-bold tracking-tight">範例影像庫</h3>
                <p className={`text-sm mt-2 ${modalTextSubClass}`}>
                  可直接使用範例 X 光進行辨識，或下載到本機
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

            <div className={`px-7 py-4 border-b ${modalBorderClass}`}>
              <div className="flex flex-wrap gap-2">
                {FILTER_OPTIONS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setGalleryFilter(option)}
                    className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                      galleryFilter === option
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
              className={`p-7 overflow-y-auto max-h-[calc(88vh-156px)] ${modalSubBgClass}`}
            >
              {filteredSamples.length === 0 ? (
                <div className={`text-sm text-center py-12 ${modalTextSubClass}`}>
                  目前這個分類尚無範例影像
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
                          {sample.category}
                        </div>

                        <div
                          className={`h-[290px] flex items-center justify-center ${imageFrameClass}`}
                        >
                          <img
                            src={sample.url}
                            alt={sample.name}
                            className="max-h-[245px] max-w-[88%] object-contain"
                          />
                        </div>
                      </div>

                      <div className="p-5">
                        <h4 className="text-xl font-semibold">{sample.name}</h4>
                        <p className={`mt-2 text-sm ${modalTextSubClass}`}>
                          預設範例影像，可直接送入模型測試
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
    </div>
  );
}