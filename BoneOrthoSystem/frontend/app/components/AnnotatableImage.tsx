"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

export type BBox = {
  id: string;
  // 以「顯示中的圖片尺寸」為座標系（px）
  x: number;
  y: number;
  w: number;
  h: number;
};

function uid() {
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

type Props = {
  src: string;
  alt?: string;
  initialWidth?: number; // 顯示寬度（px）
  minWidth?: number;
  maxWidth?: number;
  onBoxesChange?: (boxes: BBox[], normalized: Array<{ x: number; y: number; w: number; h: number }>) => void;
};

export default function AnnotatableImage({
  src,
  alt = "image",
  initialWidth = 420,
  minWidth = 240,
  maxWidth = 820,
  onBoxesChange,
}: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [displayW, setDisplayW] = useState<number>(initialWidth);
  const [boxes, setBoxes] = useState<BBox[]>([]);
  const [isDrawing, setIsDrawing] = useState(false);

  const [draft, setDraft] = useState<null | { x0: number; y0: number; x1: number; y1: number }>(null);

  const [natural, setNatural] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [renderSize, setRenderSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

  // 把 px bbox 轉成 0..1 正規化 bbox（方便存 DB 或送後端）
  const normalized = useMemo(() => {
    const w = renderSize.w || 1;
    const h = renderSize.h || 1;
    return boxes.map((b) => ({
      x: b.x / w,
      y: b.y / h,
      w: b.w / w,
      h: b.h / h,
    }));
  }, [boxes, renderSize.w, renderSize.h]);

  useEffect(() => {
    onBoxesChange?.(boxes, normalized);
  }, [boxes, normalized, onBoxesChange]);

  function getLocalXY(e: React.PointerEvent) {
    const wrap = wrapRef.current;
    if (!wrap) return { x: 0, y: 0 };
    const r = wrap.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    return { x, y };
  }

  function syncCanvasToWrap() {
    const wrap = wrapRef.current;
    const cv = canvasRef.current;
    if (!wrap || !cv) return;
    const r = wrap.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width));
    const h = Math.max(1, Math.round(r.height));
    cv.width = w;
    cv.height = h;
    setRenderSize({ w, h });
    draw();
  }

  function draw() {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, cv.width, cv.height);

    // 畫已完成 boxes
    for (const b of boxes) {
      ctx.lineWidth = 2;
      ctx.strokeStyle = "rgba(34,197,94,0.95)"; // 綠色框
      ctx.fillStyle = "rgba(34,197,94,0.12)";
      ctx.strokeRect(b.x, b.y, b.w, b.h);
      ctx.fillRect(b.x, b.y, b.w, b.h);
    }

    // 畫 draft（正在拉）
    if (draft) {
      const x = Math.min(draft.x0, draft.x1);
      const y = Math.min(draft.y0, draft.y1);
      const w = Math.abs(draft.x1 - draft.x0);
      const h = Math.abs(draft.y1 - draft.y0);

      ctx.lineWidth = 2;
      ctx.strokeStyle = "rgba(59,130,246,0.95)"; // 藍色框
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(x, y, w, h);
      ctx.setLineDash([]);
    }
  }

  useEffect(() => {
    draw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boxes, draft]);

  useEffect(() => {
    // ResizeObserver：顯示寬度變動 or RWD 時自動同步 canvas
    const wrap = wrapRef.current;
    if (!wrap) return;

    const ro = new ResizeObserver(() => {
      syncCanvasToWrap();
    });
    ro.observe(wrap);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onImgLoad() {
    const img = imgRef.current;
    if (!img) return;
    setNatural({ w: img.naturalWidth, h: img.naturalHeight });
    // 等 layout 穩定後 sync
    requestAnimationFrame(() => syncCanvasToWrap());
  }

  function handlePointerDown(e: React.PointerEvent) {
    // 右鍵不要畫
    if (e.button === 2) return;

    const { x, y } = getLocalXY(e);
    setIsDrawing(true);
    setDraft({ x0: x, y0: y, x1: x, y1: y });

    // 讓移動過程不會丟 pointer
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (!isDrawing || !draft) return;
    const { x, y } = getLocalXY(e);
    setDraft({ ...draft, x1: x, y1: y });
  }

  function handlePointerUp(e: React.PointerEvent) {
    if (!isDrawing || !draft) return;
    setIsDrawing(false);

    const x = Math.min(draft.x0, draft.x1);
    const y = Math.min(draft.y0, draft.y1);
    const w = Math.abs(draft.x1 - draft.x0);
    const h = Math.abs(draft.y1 - draft.y0);

    setDraft(null);

    // 太小的不算（避免手抖）
    if (w < 8 || h < 8) return;

    setBoxes((prev) => [...prev, { id: uid(), x, y, w, h }]);
  }

  function removeBox(id: string) {
    setBoxes((prev) => prev.filter((b) => b.id !== id));
  }

  function clearBoxes() {
    setBoxes([]);
    setDraft(null);
    setIsDrawing(false);
  }

  return (
    <div className="w-full">
      {/* 工具列 */}
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="text-[11px] opacity-80">
          圖片寬度：{displayW}px　｜　框數：{boxes.length}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={clearBoxes}
            className="px-2 py-1 rounded-lg text-[11px] border"
            style={{ backgroundColor: "rgba(148,163,184,0.12)" }}
          >
            清空框
          </button>
        </div>
      </div>

      {/* 寬度滑桿 */}
      <input
        type="range"
        min={minWidth}
        max={maxWidth}
        value={displayW}
        onChange={(e) => setDisplayW(Number(e.target.value))}
        className="w-full mb-2"
      />

      {/* 圖片 + Canvas 疊圖 */}
      <div
        ref={wrapRef}
        className="relative select-none"
        style={{
          width: `${displayW}px`,
          maxWidth: "100%",
          borderRadius: "12px",
          overflow: "hidden",
          border: "1px solid rgba(51,65,85,0.6)",
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onContextMenu={(e) => e.preventDefault()}
        title="拖曳滑鼠（或觸控）即可畫框"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          ref={imgRef}
          src={src}
          alt={alt}
          className="block w-full h-auto"
          onLoad={onImgLoad}
          draggable={false}
        />

        <canvas
          ref={canvasRef}
          className="absolute inset-0"
          style={{ touchAction: "none" }}
        />
      </div>

      {/* 框列表（可刪） */}
      {boxes.length > 0 && (
        <div className="mt-2 space-y-1 text-[11px] opacity-90">
          {boxes.map((b, idx) => (
            <div key={b.id} className="flex items-center justify-between gap-2">
              <div className="font-mono">
                #{idx + 1} px: x={b.x.toFixed(1)} y={b.y.toFixed(1)} w={b.w.toFixed(1)} h={b.h.toFixed(1)}
                {"  "}
                | norm: x={ (b.x / (renderSize.w || 1)).toFixed(3) } y={ (b.y / (renderSize.h || 1)).toFixed(3) } w={ (b.w / (renderSize.w || 1)).toFixed(3) } h={ (b.h / (renderSize.h || 1)).toFixed(3) }
              </div>
              <button
                type="button"
                onClick={() => removeBox(b.id)}
                className="px-2 py-1 rounded-lg border"
                style={{ backgroundColor: "rgba(239,68,68,0.12)" }}
              >
                刪除
              </button>
            </div>
          ))}
          <div className="opacity-60">
            （座標以「畫面顯示尺寸」為基準；要送後端建議用 norm 0..1）
          </div>
        </div>
      )}

      {/* Debug：自然尺寸 */}
      <div className="mt-2 text-[10px] opacity-60">
        natural: {natural.w}×{natural.h} | render: {renderSize.w}×{renderSize.h}
      </div>
    </div>
  );
}
