"use client";

import React, {
  useState,
  useRef,
  useEffect,
  useCallback,
  MouseEvent,
} from "react";

const PREDICT_URL = "http://127.0.0.1:8000/predict";

type PolyPoint = [number, number];

type BoneInfo = {
  bone_id: number;
  bone_en: string;
  bone_zh: string;
  bone_region: string;
  bone_desc: string;
} | null;

type DetectionBox = {
  id: number;
  cls_name: string;
  conf: number;
  poly: PolyPoint[]; // [[x1,y1],[x2,y2],[x3,y3],[x4,y4]] normalized 0~1
  bone_info: BoneInfo;
};

type ImgBox = {
  width: number;
  height: number;
};

export default function BoneVisionPage() {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [detections, setDetections] = useState<DetectionBox[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [rawResponse, setRawResponse] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  // 只記「圖片實際顯示寬高」，不再管 wrapper
  const [imgBox, setImgBox] = useState<ImgBox>({
    width: 0,
    height: 0,
  });

  // ====== Zoom & Pan 狀態 ======
  const [zoom, setZoom] = useState(1); // 1 = 100%
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const lastPan = useRef<{ x: number; y: number } | null>(null);

  const clampZoom = (z: number) => Math.min(3, Math.max(0.5, z));

  const handleZoomIn = () => {
    setZoom((z) => clampZoom(z + 0.2));
  };

  const handleZoomOut = () => {
    setZoom((z) => clampZoom(z - 0.2));
  };

  const handleResetView = () => {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  };

  const handlePanStart = (e: MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsPanning(true);
    lastPan.current = { x: e.clientX, y: e.clientY };
  };

  const handlePanMove = (e: MouseEvent<HTMLDivElement>) => {
    if (!isPanning || !lastPan.current) return;
    const dx = e.clientX - lastPan.current.x;
    const dy = e.clientY - lastPan.current.y;
    lastPan.current = { x: e.clientX, y: e.clientY };
    setOffset((prev) => ({ x: prev.x + dx, y: prev.y + dy }));
  };

  const handlePanEnd = () => {
    setIsPanning(false);
    lastPan.current = null;
  };

  /**
   * 量圖片實際顯示的寬高（用 img 自己的 rect），
   * 不用再管 wrapper 的座標，SVG 直接貼在這個尺寸上就好。
   */
  const measureLayout = useCallback(() => {
    if (!imgRef.current) return;
    const rect = imgRef.current.getBoundingClientRect();
    setImgBox({
      width: rect.width,
      height: rect.height,
    });
  }, []);

  useEffect(() => {
    // 視窗大小變化時，重新量一次（避免 RWD 壓縮）
    window.addEventListener("resize", measureLayout);
    return () => window.removeEventListener("resize", measureLayout);
  }, [measureLayout]);

  // 檔案選擇
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setDetections([]);
    setRawResponse(null);
    setActiveId(null);

    const reader = new FileReader();
    reader.onload = () => setPreviewUrl(reader.result as string);
    reader.readAsDataURL(f);

    // 換圖時視角重置
    setZoom(1);
    setOffset({ x: 0, y: 0 });
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
        })
      );

      setDetections(boxes);
      setActiveId(boxes.length ? boxes[0].id : null);
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.message ?? "推論失敗，請檢查後端");
    } finally {
      setLoading(false);
    }
  };

  // 把 normalized poly 轉成 SVG points（座標系 = 0~imgBox.width / 0~imgBox.height）
  const polyToPoints = (poly: PolyPoint[]): string => {
    if (!imgBox.width || !imgBox.height) return "";

    return poly
      .map(([nx, ny]) => {
        const cx = Math.min(1, Math.max(0, nx));
        const cy = Math.min(1, Math.max(0, ny));

        const x = cx * imgBox.width;
        const y = cy * imgBox.height;
        return `${x},${y}`;
      })
      .join(" ");
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50 flex flex-col">
      {/* Top bar */}
      <header className="border-b border-slate-800 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-cyan-400 shadow-lg shadow-cyan-500/40 flex items-center justify-center text-slate-900 font-bold">
            B
          </div>
          <div>
            <h1 className="text-xl font-semibold">BoneVision</h1>
            <p className="text-xs text-slate-400">
              Next.js + FastAPI + YOLO OBB
            </p>
          </div>
        </div>
        <span className="text-xs text-slate-400">骨骼偵測 Demo</span>
      </header>

      <main className="flex-1 flex flex-col lg:flex-row gap-6 px-6 py-6">
        {/* 左側：上傳 & 控制 */}
        <section className="w-full lg:w-1/3 space-y-4">
          <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-4 shadow-xl shadow-slate-900/60">
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

            {errorMsg && (
              <p className="mt-3 text-xs text-red-400 whitespace-pre-wrap">
                {errorMsg}
              </p>
            )}
          </div>

          {/* JSON debug 區塊 */}
          <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-4 max-h-72 overflow-auto text-xs">
            <h3 className="text-xs font-semibold mb-2">辨識結果（原始 JSON）</h3>
            <pre className="whitespace-pre-wrap text-[11px] text-green-400">
              {rawResponse
                ? JSON.stringify(rawResponse, null, 2)
                : "// 目前尚無結果"}
            </pre>
          </div>
        </section>

        {/* 中間：影像 + OBB + Zoom / Pan */}
        <section className="w-full lg:w-1/3">
          <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-4 h-full flex flex-col">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold">影像預覽與結果</h2>

              {/* Zoom 控制列 */}
              <div className="flex items-center gap-1 text-xs">
                <span className="text-slate-400 mr-1">Zoom</span>
                <button
                  onClick={handleZoomOut}
                  className="w-6 h-6 rounded-full bg-slate-800 flex items-center justify-center hover:bg-slate-700"
                >
                  -
                </button>
                <span className="w-12 text-center text-slate-300">
                  {Math.round(zoom * 100)}%
                </span>
                <button
                  onClick={handleZoomIn}
                  className="w-6 h-6 rounded-full bg-slate-800 flex items-center justify-center hover:bg-slate-700"
                >
                  +
                </button>
                <button
                  onClick={handleResetView}
                  className="ml-1 px-2 py-1 rounded-full bg-slate-800 hover:bg-slate-700"
                >
                  Reset
                </button>
              </div>
            </div>

            <div
              ref={wrapperRef}
              className="relative flex-1 bg-slate-950 rounded-2xl overflow-hidden border border-slate-800/70"
            >
              {previewUrl ? (
                // 這一層用來做拖曳
                <div
                  className={`absolute inset-0 flex items-center justify-center ${
                    isPanning ? "cursor-grabbing" : "cursor-grab"
                  }`}
                  onMouseDown={handlePanStart}
                  onMouseMove={handlePanMove}
                  onMouseUp={handlePanEnd}
                  onMouseLeave={handlePanEnd}
                >
                  {/* 這一層同時套用 scale + translate，圖片和框一起動 */}
                  <div
                    className="relative inline-block"
                    style={{
                      transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
                      transformOrigin: "center center",
                      transition: isPanning ? "none" : "transform 0.12s ease-out",
                    }}
                  >
                    <img
                      ref={imgRef}
                      src={previewUrl}
                      alt="preview"
                      className="max-h-[480px] max-w-full object-contain"
                      onLoad={measureLayout} // 圖片載入後量一次寬高
                    />

                    {/* OBB overlay：跟圖片一樣大小的 SVG，座標系 0~imgBox.width/height */}
                    {detections.length > 0 && imgBox.width > 0 && imgBox.height > 0 && (
                      <svg
                        className="absolute inset-0 pointer-events-none"
                        width={imgBox.width}
                        height={imgBox.height}
                        viewBox={`0 0 ${imgBox.width} ${imgBox.height}`}
                        preserveAspectRatio="none"
                      >
                        {/* 先畫非選中的框（下層） */}
                        {detections
                          .filter((b) => b.id !== activeId)
                          .map((box) => {
                            const pts = polyToPoints(box.poly);
                            if (!pts) return null;
                            return (
                              <polygon
                                key={box.id}
                                points={pts}
                                fill="none"
                                stroke="#0076a8ff"
                                strokeWidth={2}
                                strokeDasharray="0"
                                opacity={0.8}
                              />
                            );
                          })}

                        {/* 再畫被選中的框（在最上層） */}
                        {activeId !== null &&
                          (() => {
                            const box = detections.find(
                              (b) => b.id === activeId
                            );
                            if (!box) return null;
                            const pts = polyToPoints(box.poly);
                            if (!pts) return null;
                            return (
                              <polygon
                                key={`${box.id}_active`}
                                points={pts}
                                fill="none"
                                stroke="#22d3ee"
                                strokeWidth={4}
                                strokeDasharray="0"
                                className="drop-shadow-[0_0_12px_rgba(34,211,238,0.9)]"
                              />
                            );
                          })()}
                      </svg>
                    )}
                  </div>
                </div>
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <p className="text-xs text-slate-500">
                    尚未上傳圖片，請先選擇一張 X 光影像。
                  </p>
                </div>
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

        {/* 右側：骨骼列表 + Bone_Info 說明 */}
        <section className="w-full lg:w-1/3">
          <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-4 h-full flex flex-col">
            <h2 className="text-sm font-semibold mb-3">辨識出的部位</h2>

            {detections.length === 0 ? (
              <p className="text-xs text-slate-500">
                尚未有偵測結果，請上傳圖片並點選「開始辨識（模型）」。
              </p>
            ) : (
              <>
                {/* bone chips 列表 */}
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
                      {box.cls_name}{" "}
                      <span className="opacity-70">
                        ({box.conf.toFixed(2)})
                      </span>
                    </button>
                  ))}
                </div>

                {/* 詳細資訊（含資料庫 Bone_Info） */}
                {activeId !== null && (
                  <div className="mt-2 text-xs space-y-3 bg-slate-950/60 border border-slate-800 rounded-xl p-3 flex-1 overflow-auto">
                    {(() => {
                      const box = detections.find((b) => b.id === activeId)!;
                      const info = box.bone_info;

                      return (
                        <>
                          <div>
                            <p className="text-slate-400">模型類別名稱：</p>
                            <p className="font-semibold text-cyan-300">
                              {box.cls_name}{" "}
                              <span className="text-slate-400 text-[11px] ml-1">
                                conf {box.conf.toFixed(3)}
                              </span>
                            </p>
                          </div>

                          <div className="h-px bg-slate-800 my-1" />

                          {info ? (
                            <>
                              <div>
                                <p className="text-slate-400">骨頭名稱：</p>
                                <p className="font-semibold text-slate-50">
                                  {info.bone_zh}{" "}
                                  <span className="text-cyan-300 text-[11px] ml-1">
                                    {info.bone_en}
                                  </span>
                                </p>
                              </div>

                              <div>
                                <p className="text-slate-400">部位區域：</p>
                                <p className="text-slate-200">
                                  {info.bone_region || "（未填寫）"}
                                </p>
                              </div>

                              <div>
                                <p className="text-slate-400 mb-1">說明：</p>
                                <p className="text-slate-200 leading-relaxed whitespace-pre-wrap">
                                  {info.bone_desc || "（尚無說明文字）"}
                                </p>
                              </div>
                            </>
                          ) : (
                            <p className="text-slate-400">
                              此骨頭在資料庫（Bone_Info）中尚無對應說明。
                            </p>
                          )}

                          <div className="h-px bg-slate-800 my-1" />

                          <div>
                            <p className="text-slate-400">
                              poly 座標（normalized 0~1）：
                            </p>
                            <pre className="text-[11px] text-green-400 whitespace-pre-wrap">
                              {JSON.stringify(box.poly, null, 2)}
                            </pre>
                          </div>
                        </>
                      );
                    })()}
                  </div>
                )}
              </>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
