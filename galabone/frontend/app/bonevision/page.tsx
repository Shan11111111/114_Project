"use client";

import React, { useState, useRef, useEffect } from "react";

const PREDICT_URL = "http://127.0.0.1:8000/predict";

type PolyPoint = [number, number];

type DetectionBox = {
  id: number;
  cls_name: string;
  conf: number;
  poly: PolyPoint[]; // [[x1,y1], [x2,y2], [x3,y3], [x4,y4]] (normalized 0~1)
};

type ImgBox = {
  left: number;
  top: number;
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

  const [wrapperSize, setWrapperSize] = useState({ w: 0, h: 0 });
  const [imgBox, setImgBox] = useState<ImgBox>({
    left: 0,
    top: 0,
    width: 0,
    height: 0,
  });

  // 量容器大小
  useEffect(() => {
    function updateWrapperSize() {
      if (wrapperRef.current) {
        const rect = wrapperRef.current.getBoundingClientRect();
        setWrapperSize({ w: rect.width, h: rect.height });
      }
    }
    updateWrapperSize();
    window.addEventListener("resize", updateWrapperSize);
    return () => window.removeEventListener("resize", updateWrapperSize);
  }, []);

  // 量圖片在容器裡的位置與尺寸
  const measureImgBox = () => {
    if (!wrapperRef.current || !imgRef.current) return;
    const wRect = wrapperRef.current.getBoundingClientRect();
    const iRect = imgRef.current.getBoundingClientRect();
    setImgBox({
      left: iRect.left - wRect.left,
      top: iRect.top - wRect.top,
      width: iRect.width,
      height: iRect.height,
    });
  };

  useEffect(() => {
    // 視窗大小改變時重新量一次 img
    window.addEventListener("resize", measureImgBox);
    return () => window.removeEventListener("resize", measureImgBox);
  }, []);

  // 檔案選擇
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setDetections([]);
    setRawResponse(null);
    setActiveId(null);

    const reader = new FileReader();
    reader.onload = () => {
      setPreviewUrl(reader.result as string);
    };
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

      const boxes: DetectionBox[] = (data.boxes || []).map(
        (b: any, idx: number) => ({
          id: idx,
          cls_name: b.cls_name ?? `class_${b.cls_id ?? idx}`,
          conf: typeof b.conf === "number" ? b.conf : 0,
          poly: (b.poly as number[][]).map((p) => [
            Number(p[0]),
            Number(p[1]),
          ]),
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

  // 把 normalized poly 轉成 SVG points（考慮圖片在容器中的 offset）
  const polyToPoints = (poly: PolyPoint[]): string => {
    const { w, h } = wrapperSize;
    if (!w || !h || !imgBox.width || !imgBox.height) return "";

    return poly
      .map(([nx, ny]) => {
        // clamp：有些會略超過 0~1
        const cx = Math.min(1, Math.max(0, nx));
        const cy = Math.min(1, Math.max(0, ny));

        const x = imgBox.left + cx * imgBox.width;
        const y = imgBox.top + cy * imgBox.height;
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
              {rawResponse ? JSON.stringify(rawResponse, null, 2) : "// 目前尚無結果"}
            </pre>
          </div>
        </section>

        {/* 中間：影像 + OBB */}
        <section className="w-full lg:w-1/3">
          <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-4 h-full flex flex-col">
            <h2 className="text-sm font-semibold mb-3">影像預覽與結果</h2>

            <div
              ref={wrapperRef}
              className="relative flex-1 bg-slate-950 rounded-2xl overflow-hidden border border-slate-800/70 flex items-center justify-center"
            >
              {previewUrl ? (
                <>
                  <img
                    ref={imgRef}
                    src={previewUrl}
                    alt="preview"
                    className="max-h-full max-w-full object-contain"
                    onLoad={measureImgBox}
                  />
                  {/* OBB overlay */}
                  {detections.length > 0 && (
                    <svg
                      className="absolute inset-0 w-full h-full pointer-events-none"
                      viewBox={`0 0 ${wrapperSize.w || 100} ${wrapperSize.h || 100}`}
                      preserveAspectRatio="none"
                    >
                      {detections.map((box) => (
                        <polygon
                          key={box.id}
                          points={polyToPoints(box.poly)}
                          fill="none"
                          stroke={
                            activeId === box.id ? "#22d3ee" : "rgba(34,211,238,0.6)"
                          }
                          strokeWidth={activeId === box.id ? 3 : 2}
                          strokeDasharray={activeId === box.id ? "0" : "4 4"}
                          className="drop-shadow-[0_0_6px_rgba(34,211,238,0.7)]"
                        />
                      ))}
                    </svg>
                  )}
                </>
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

        {/* 右側：骨骼列表 */}
        <section className="w-full lg:w-1/3">
          <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-4 h-full flex flex-col">
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
                      {box.cls_name}{" "}
                      <span className="opacity-70">
                        ({box.conf.toFixed(2)})
                      </span>
                    </button>
                  ))}
                </div>

                {activeId !== null && (
                  <div className="mt-2 text-xs space-y-2 bg-slate-950/60 border border-slate-800 rounded-xl p-3">
                    {(() => {
                      const box = detections.find((b) => b.id === activeId)!;
                      return (
                        <>
                          <p>
                            <span className="text-slate-400">名稱：</span>
                            <span className="font-semibold text-cyan-300">
                              {box.cls_name}
                            </span>
                          </p>
                          <p>
                            <span className="text-slate-400">信心值：</span>
                            {box.conf.toFixed(3)}
                          </p>
                          <p className="text-slate-400">
                            poly 座標（normalized）：
                          </p>
                          <pre className="text-[11px] text-green-400 whitespace-pre-wrap">
                            {JSON.stringify(box.poly, null, 2)}
                          </pre>
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
