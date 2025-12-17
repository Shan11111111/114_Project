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
  poly: PolyPoint[]; // [[x1,y1],[x2,y2],[x3,y3],[x4,y4]] normalized 0~1
  bone_info?: BoneInfo;
  sub_label?: string | null; // 小類（例如 C4 / T7 / L3）
};

type ImgBox = {
  width: number;
  height: number;
};

export default function BoneVisionPage() {
  const router = useRouter();

  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [detections, setDetections] = useState<DetectionBox[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [rawResponse, setRawResponse] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // ✅ 存 S1 這次辨識寫入 DB 的 ImageCaseId（S1→S2 交接關鍵）
  const [imageCaseId, setImageCaseId] = useState<number | null>(null);

  // 是否只顯示目前選取框
  const [showOnlyActive, setShowOnlyActive] = useState(false);

  // 影像與框線用
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const displayRef = useRef<HTMLDivElement | null>(null);
  const [imgBox, setImgBox] = useState<ImgBox>({
    width: 0,
    height: 0,
  });

  // Zoom & Pan
  const [zoom, setZoom] = useState(1); // 1 = 100%
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStart = useRef<{ x: number; y: number } | null>(null);

  const clampZoom = (z: number) => Math.min(2, Math.max(0.5, z)); // 50% ~ 200%

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

  /**
   * 量 displayRef（img+svg 容器）的實際寬高
   * 讓 SVG 的 viewBox 跟實際呈現大小一致 → poly 轉像素才不會歪
   */
  const measureLayout = useCallback(() => {
    if (!displayRef.current) return;
    const rect = displayRef.current.getBoundingClientRect();
    setImgBox({
      width: rect.width,
      height: rect.height,
    });
  }, []);

  // 初次掛載 & 視窗縮放時 re-measure
  useEffect(() => {
    measureLayout();
    window.addEventListener("resize", measureLayout);
    return () => window.removeEventListener("resize", measureLayout);
  }, [measureLayout]);

  // 圖片載入 / 辨識結果更新 / zoom 變化後，再量一次
  useEffect(() => {
    if (!previewUrl) return;
    requestAnimationFrame(() => {
      measureLayout();
    });
  }, [previewUrl, detections.length, zoom, measureLayout]);

  // 檔案選擇
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;

    setFile(f);
    setDetections([]);
    setRawResponse(null);
    setActiveId(null);
    setErrorMsg(null);
    setShowOnlyActive(false);
    setImageCaseId(null); // ✅ 換圖就清掉（避免用到舊 caseId）
    handleResetView();

    const reader = new FileReader();
    reader.onload = () => setPreviewUrl(reader.result as string);
    reader.readAsDataURL(f);
  };

  // 呼叫 /predict
  const handleDetect = async () => {
    if (!file) {
      alert("請先選擇 X 光圖片");
      return;
    }
    setLoading(true);
    setErrorMsg(null);

    try {
      const fd = new FormData();
      fd.append("file", file);

      const res = await fetch(PREDICT_URL, {
        method: "POST",
        body: fd,
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`後端回傳錯誤 ${res.status}：${text}`);
      }

      const data = await res.json();
      setRawResponse(data);

      // ✅ 抓 ImageCaseId（支援多種 key 命名）
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

      // ✅ 沒回傳 caseId 就警告（不擋你看結果，但會讓「了解更多」不能用）
      if (!cid) {
        console.warn(
          "⚠️ /predict 沒回傳 image_case_id（或 imageCaseId），了解更多將無法帶入 S2 bootstrap"
        );
      }
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.message ?? "推論失敗，請檢查後端");
    } finally {
      setLoading(false);
    }
  };

  // 把 normalized poly 轉成 SVG points（使用 imgBox.width/height 當座標系）
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

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 flex flex-col lg:flex-row gap-6 px-6 py-6">
        {/* 左側：上傳 & 控制 */}
        <section className="w-full lg:w-5/20 space-y-4">
          <div className="card border border-slate-800/70 shadow-xl shadow-slate-900/40">
            <h2 className="text-sm font-semibold mb-3">資料與設定</h2>

            <label className="block">
              <span className="text-xs text-slate-400">上傳 X 光影像</span>
              <input
                type="file"
                accept="image/*"
                onChange={handleFileChange}
                className="mt-2 block w-full text-sm text-slate-200
                           file:mr-4 file:py-2 file:px-4
                           file:rounded-full file:border-0
                           file:text-sm file:font-semibold
                           file:bg-cyan-500 file:text-slate-900
                           hover:file:bg-cyan-400 cursor-pointer"
              />
            </label>

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

            {/* ✅ 顯示本次 DB caseId（方便你 debug 跳轉） */}
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

          {/* JSON debug 區塊 */}
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

                {/* 只顯示目前選取框切換按鈕 */}
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

                  {/* OBB overlay */}
                  {detections.length > 0 && (
                    <svg
                      className="absolute inset-0 w-full h-full pointer-events-none"
                      viewBox={`0 0 ${imgBox.width || 100} ${
                        imgBox.height || 100
                      }`}
                      preserveAspectRatio="none"
                    >
                      {/* 非 active 的框 */}
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

                      {/* active 的框 */}
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
                {/* 上方 chips */}
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

                {/* 下方詳細說明卡片 */}
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

                      {/* 顯示節數 / 小類 */}
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

                      {/* ✅ 改這顆：帶 caseId 去 LLM，讓 LLM 用 bootstrap-from-s1 從 DB 撈圖 + detections */}
                      <button
                        onClick={() => {
                          if (!imageCaseId) {
                            alert(
                              "目前沒有 ImageCaseId（/predict 需要回傳 image_case_id 才能帶入 S2）"
                            );
                            return;
                          }
                          // 可選：帶 boneId 讓 LLM 頁面做聚焦/預設提示（不影響 bootstrap）
                          const boneId = activeBox.bone_info?.bone_id ?? "";
                          const url =
                            `/llm?caseId=${encodeURIComponent(
                              String(imageCaseId)
                            )}` + (boneId ? `&boneId=${encodeURIComponent(String(boneId))}` : "");
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
                        了解更多（galabone）
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
    </div>
  );
}
