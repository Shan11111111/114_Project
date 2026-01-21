// frontend/app/s0/page.tsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  s0Api,
  BigBone,
  SmallBone,
  ImageCase,
  askAgentFromS0,
} from "../../lib/s0Api";

type PolyPoint = [number, number];

// 一個標註框的型別（0~1 normalized）
type AnnotationBox = {
  id: number;
  boneId: number | null;
  smallBoneId: number | null;
  boneZh: string;
  smallBoneZh: string;

  // AABB (normalized) - 後端儲存用
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;

  // OBB (normalized) - 前端互動/視覺用
  poly?: PolyPoint[]; // 4 points
  cx?: number;
  cy?: number;
  obbW?: number; // width
  obbH?: number; // height
  angleDeg?: number; // degrees
};

// ✅ 實際顯示影像在 frame 內的位置（解 object-fit: contain 偏移）
type ImgBox = { left: number; top: number; width: number; height: number };

// ====== S1 偵測結果型別（審核模式用）======
type S1Detection = {
  id: number | string;
  boneId: number | null;
  smallBoneId: number | null;
  confidence: number | null;
  poly: PolyPoint[]; // normalized 4 points
};

type UserMode = "student" | "expert"; // student=醫學生, expert=醫師/教師

// 只給本頁 fetch 用（不改 lib 也能跑）
const API_BASE = (
  process.env.NEXT_PUBLIC_BACKEND_URL || "http://127.0.0.1:8000"
).replace(/\/+$/, "");

export default function S0Page() {
  // ====== 分流模式 ======
  const [mode, setMode] = useState<UserMode>("student");

  const [imageCases, setImageCases] = useState<ImageCase[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);

  const [bigBones, setBigBones] = useState<BigBone[]>([]);
  const [smallBones, setSmallBones] = useState<SmallBone[]>([]);
  const [selectedBoneId, setSelectedBoneId] = useState<number | null>(null);
  const [selectedSmallBoneId, setSelectedSmallBoneId] =
    useState<number | null>(null);

  const [boxes, setBoxes] = useState<AnnotationBox[]>([]);
  const [activeBoxId, setActiveBoxId] = useState<number | null>(null);

  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  // Draw
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(
    null
  );

  // Rotate
  const [isRotating, setIsRotating] = useState(false);
  const rotatePointerIdRef = useRef<number | null>(null);
  const rotateStartRadRef = useRef<number>(0);
  const rotateStartDegRef = useRef<number>(0);
  const obbStartRef = useRef<{
    cx: number;
    cy: number;
    obbW: number;
    obbH: number;
    angleDeg: number;
  } | null>(null);

  // Move / Resize
  const [isMoving, setIsMoving] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const moveStartRef = useRef<{ x: number; y: number } | null>(null);

  type ResizeHandle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
  const resizeHandleRef = useRef<ResizeHandle | null>(null);

  const [imgBox, setImgBox] = useState<ImgBox | null>(null);

  // draft AABB
  const [draftBox, setDraftBox] = useState<{
    xMin: number;
    yMin: number;
    xMax: number;
    yMax: number;
  } | null>(null);

  // ⭐ S2 問答用（醫學生模式主打）
  const [qaLoading, setQaLoading] = useState(false);
  const [qaAnswer, setQaAnswer] = useState("");

  // ====== S1 偵測結果（專家模式主打）======
  const [showS1, setShowS1] = useState(false);
  const [s1Loading, setS1Loading] = useState(false);
  const [s1Detections, setS1Detections] = useState<S1Detection[]>([]);

  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  const currentCase: ImageCase | null = useMemo(() => {
    if (!imageCases.length) return null;
    return imageCases[currentIndex] ?? imageCases[0];
  }, [imageCases, currentIndex]);

  const canSubmit = !!currentCase && boxes.length > 0;

  // ======================
  // Helpers (先宣告再使用，避免紅蚯蚓)
  // ======================

  const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
  const deg2rad = (d: number) => (d * Math.PI) / 180;
  const rad2deg = (r: number) => (r * 180) / Math.PI;

  const rotatePoint = (
    p: PolyPoint,
    cx: number,
    cy: number,
    rad: number
  ): PolyPoint => {
    const dx = p[0] - cx;
    const dy = p[1] - cy;
    const x = cx + dx * Math.cos(rad) - dy * Math.sin(rad);
    const y = cy + dx * Math.sin(rad) + dy * Math.cos(rad);
    return [clamp01(x), clamp01(y)];
  };

  const polyCenter = (poly: PolyPoint[]) => {
    const cx = poly.reduce((s, p) => s + p[0], 0) / poly.length;
    const cy = poly.reduce((s, p) => s + p[1], 0) / poly.length;
    return { cx, cy };
  };

  const polyToAabb = (poly: PolyPoint[]) => {
    const xs = poly.map((p) => p[0]);
    const ys = poly.map((p) => p[1]);
    return {
      xMin: clamp01(Math.min(...xs)),
      yMin: clamp01(Math.min(...ys)),
      xMax: clamp01(Math.max(...xs)),
      yMax: clamp01(Math.max(...ys)),
    };
  };

  const aabbToPoly = (xMin: number, yMin: number, xMax: number, yMax: number) => {
    const xmin = clamp01(Math.min(xMin, xMax));
    const xmax = clamp01(Math.max(xMin, xMax));
    const ymin = clamp01(Math.min(yMin, yMax));
    const ymax = clamp01(Math.max(yMin, yMax));
    const p1: PolyPoint = [xmin, ymin];
    const p2: PolyPoint = [xmax, ymin];
    const p3: PolyPoint = [xmax, ymax];
    const p4: PolyPoint = [xmin, ymax];
    const cx = (xmin + xmax) / 2;
    const cy = (ymin + ymax) / 2;
    return { poly: [p1, p2, p3, p4] as PolyPoint[], cx, cy };
  };

  const obbToPoly = (
    cx: number,
    cy: number,
    w: number,
    h: number,
    angleDeg: number
  ): PolyPoint[] => {
    const hw = w / 2;
    const hh = h / 2;
    const rad = deg2rad(angleDeg);
    const corners: PolyPoint[] = [
      [cx - hw, cy - hh],
      [cx + hw, cy - hh],
      [cx + hw, cy + hh],
      [cx - hw, cy + hh],
    ];
    return corners.map((p) => rotatePoint(p, cx, cy, rad));
  };

  const ensureObb = (b: AnnotationBox) => {
    if (
      b.cx == null ||
      b.cy == null ||
      b.obbW == null ||
      b.obbH == null ||
      b.angleDeg == null
    ) {
      const cx = (b.xMin + b.xMax) / 2;
      const cy = (b.yMin + b.yMax) / 2;
      const obbW = Math.max(0.001, b.xMax - b.xMin);
      const obbH = Math.max(0.001, b.yMax - b.yMin);
      const angleDeg = 0;
      const poly = obbToPoly(cx, cy, obbW, obbH, angleDeg);
      return { ...b, cx, cy, obbW, obbH, angleDeg, poly };
    }
    const poly = b.poly ?? obbToPoly(b.cx, b.cy, b.obbW, b.obbH, b.angleDeg);
    return { ...b, poly };
  };

  const applyObbToBox = (
    b: AnnotationBox,
    next: { cx: number; cy: number; obbW: number; obbH: number; angleDeg: number }
  ) => {
    const poly = obbToPoly(next.cx, next.cy, next.obbW, next.obbH, next.angleDeg);
    const aabb = polyToAabb(poly);
    return { ...b, ...aabb, ...next, poly };
  };

  const getActiveBox = () =>
    activeBoxId != null ? boxes.find((b) => b.id === activeBoxId) ?? null : null;

  // poly -> SVG points(px in frame space)
  const polyToSvgPoints = (poly: PolyPoint[]) => {
    if (!imgBox) return "";
    return poly
      .map(([nx, ny]) => {
        const x = imgBox.left + clamp01(nx) * imgBox.width;
        const y = imgBox.top + clamp01(ny) * imgBox.height;
        return `${x},${y}`;
      })
      .join(" ");
  };

  const getRotateHandlePx = (poly: PolyPoint[]) => {
    if (!imgBox) return null;
    let topP = poly[0];
    for (const p of poly) if (p[1] < topP[1]) topP = p;
    const x = imgBox.left + topP[0] * imgBox.width;
    const y = imgBox.top + topP[1] * imgBox.height - 16;
    return { x, y };
  };

  // ----------------------
  // 命中測試：Resize handles / 內部點
  // ----------------------

  const pointInPoly = (pt: PolyPoint, poly: PolyPoint[]) => {
    const [x, y] = pt;
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i];
      const [xj, yj] = poly[j];
      const intersect =
        yi > y !== yj > y &&
        x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-12) + xi;
      if (intersect) inside = !inside;
    }
    return inside;
  };

  const mid = (a: PolyPoint, b: PolyPoint): PolyPoint => [
    (a[0] + b[0]) / 2,
    (a[1] + b[1]) / 2,
  ];

  const getHandles = (poly: PolyPoint[]) => {
    const [p0, p1, p2, p3] = poly;
    return {
      nw: p0,
      ne: p1,
      se: p2,
      sw: p3,
      n: mid(p0, p1),
      e: mid(p1, p2),
      s: mid(p2, p3),
      w: mid(p3, p0),
    } as Record<ResizeHandle, PolyPoint>;
  };

  const hitHandle = (e: React.PointerEvent<HTMLDivElement>, b: AnnotationBox): ResizeHandle | null => {
    if (!imgBox) return null;
    const bb = ensureObb(b);
    const poly = bb.poly!;
    const handles = getHandles(poly);

    const frame = wrapperRef.current?.getBoundingClientRect();
    if (!frame) return null;

    const x = e.clientX - frame.left;
    const y = e.clientY - frame.top;

    const r = 10;
    for (const k of Object.keys(handles) as ResizeHandle[]) {
      const [nx, ny] = handles[k];
      const hx = imgBox.left + nx * imgBox.width;
      const hy = imgBox.top + ny * imgBox.height;
      const dx = x - hx;
      const dy = y - hy;
      if (dx * dx + dy * dy <= r * r) return k;
    }
    return null;
  };

  const toLocal = (nx: number, ny: number, cx: number, cy: number, angleDeg: number) => {
    const rad = deg2rad(-angleDeg);
    const dx = nx - cx;
    const dy = ny - cy;
    const x = dx * Math.cos(rad) - dy * Math.sin(rad);
    const y = dx * Math.sin(rad) + dy * Math.cos(rad);
    return { x, y };
  };

  // ======================
  // ✅ object-fit: contain 同步計算 imgBox
  // ======================
  const computeContainImgBox = () => {
    const frame = wrapperRef.current;
    const img = imgRef.current;
    if (!frame || !img) return;

    const fw = frame.clientWidth;
    const fh = frame.clientHeight;

    const nw = img.naturalWidth;
    const nh = img.naturalHeight;
    if (!fw || !fh || !nw || !nh) return;

    const scale = Math.min(fw / nw, fh / nh);
    const w = nw * scale;
    const h = nh * scale;

    const left = (fw - w) / 2;
    const top = (fh - h) / 2;

    setImgBox({ left, top, width: w, height: h });
  };

  const handleImageLoad = () => {
    requestAnimationFrame(() =>
      requestAnimationFrame(() => computeContainImgBox())
    );
  };

  useEffect(() => {
    const onResize = () => computeContainImgBox();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // ======================
  // 分流模式：記住使用者選擇（避免每次重開都回到 student）
  // ======================
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("galabone_mode") as UserMode | null;
      if (saved === "student" || saved === "expert") setMode(saved);
    } catch {}
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem("galabone_mode", mode);
    } catch {}
    // 切模式時清一下狀態避免誤會
    setStatus("");
    setQaAnswer("");
    setShowS1(false);
  }, [mode]);

  // ======================
  // 初始化
  // ======================
  useEffect(() => {
    async function init() {
      try {
        setLoading(true);
        const [cases, bones] = await Promise.all([
          s0Api.getPendingCases(),
          s0Api.getBigBones(),
        ]);
        setImageCases(cases);
        setBigBones(bones);
        if (!cases.length) {
          setStatus("目前沒有待標註影像，請先在辨識頁面上傳 X 光。");
        } else {
          setStatus("");
        }
      } catch (err: any) {
        setStatus(`載入資料失敗：${err.message}`);
      } finally {
        setLoading(false);
      }
    }
    init();
  }, []);

  // ======================
  // 切換 Case 時載入舊標註
  // ======================
  useEffect(() => {
    const caseId = currentCase?.imageCaseId ?? null;
    if (!caseId) return;

    async function loadExisting() {
      try {
        const raw = await s0Api.getAnnotations(caseId as number);
        console.log("[S0] annotations from API:", raw);

        const list: AnnotationBox[] = (raw || []).map(
          (a: any, idx: number): AnnotationBox => {
            const boneId =
              typeof a.boneId === "number"
                ? a.boneId
                : typeof a.BoneId === "number"
                ? a.BoneId
                : null;

            const smallBoneId =
              typeof a.smallBoneId === "number"
                ? a.smallBoneId
                : typeof a.SmallBoneId === "number"
                ? a.SmallBoneId
                : null;

            const big = boneId
              ? bigBones.find((b) => b.boneId === boneId)
              : undefined;

            const boneZh = big?.boneZh ?? (boneId ? `Bone ${boneId}` : "Bone ?");
            const smallZh =
              smallBoneId != null ? `SmallBone #${smallBoneId}` : "SmallBone ?";

            const xMin = Number(a.x_min ?? a.X_min ?? a.XMin ?? 0);
            const yMin = Number(a.y_min ?? a.Y_min ?? a.YMin ?? 0);
            const xMax = Number(a.x_max ?? a.X_max ?? a.XMax ?? 1);
            const yMax = Number(a.y_max ?? a.Y_max ?? a.YMax ?? 1);

            // 若後端有 polyJson / PolyJson，就嘗試讀進來
            // ✅ 優先吃後端回傳的 poly（已經是 array），再吃 polyJson 字串，再吃 P1..P4
            let poly: PolyPoint[] | undefined = undefined;

            try {
              // 1) 後端新版：直接回 poly: [[x,y]*4]
              const direct = a.poly ?? a.Poly ?? null;
              if (Array.isArray(direct) && direct.length === 4) {
                poly = direct.map((p: any) => [Number(p[0]), Number(p[1])]) as PolyPoint[];
              }

              // 2) 舊版：polyJson / PolyJson 字串
              if (!poly) {
                const pj = a.polyJson ?? a.PolyJson ?? null;
                if (typeof pj === "string" && pj.trim().startsWith("[")) {
                  const parsed = JSON.parse(pj);
                  if (Array.isArray(parsed) && parsed.length === 4) {
                    poly = parsed.map((p: any) => [Number(p[0]), Number(p[1])]) as PolyPoint[];
                  }
                }
              }

              // 3) 只有點：P1X..P4Y
              if (!poly) {
                const p1x = a.p1x ?? a.P1X, p1y = a.p1y ?? a.P1Y;
                const p2x = a.p2x ?? a.P2X, p2y = a.p2y ?? a.P2Y;
                const p3x = a.p3x ?? a.P3X, p3y = a.p3y ?? a.P3Y;
                const p4x = a.p4x ?? a.P4X, p4y = a.p4y ?? a.P4Y;
                if ([p1x,p1y,p2x,p2y,p3x,p3y,p4x,p4y].every((v) => typeof v === "number")) {
                  poly = [
                    [Number(p1x), Number(p1y)],
                    [Number(p2x), Number(p2y)],
                    [Number(p3x), Number(p3y)],
                    [Number(p4x), Number(p4y)],
                  ];
                }
              }
            } catch {}









            const basePoly = poly ?? aabbToPoly(xMin, yMin, xMax, yMax).poly;
            const { cx, cy } = polyCenter(basePoly);

            const obbW = Math.max(0.001, xMax - xMin);
            const obbH = Math.max(0.001, yMax - yMin);
            const angleDeg = Number(a.angleDeg ?? a.AngleDeg ?? 0) || 0;

            const poly2 = poly ?? obbToPoly(cx, cy, obbW, obbH, angleDeg);
            const aabb = polyToAabb(poly2);

            return {
              id: a.annotationId ?? a.AnnotationId ?? a.imageAnnotationId ?? idx,
              boneId,
              smallBoneId,
              boneZh,
              smallBoneZh: smallZh,
              ...aabb,
              poly: poly2,
              cx,
              cy,
              obbW,
              obbH,
              angleDeg,
            };
          }
        );

        setBoxes(list);
        setActiveBoxId(null);
        setDraftBox(null);

        if (list.length) {
          setStatus(
            `這張影像已經有 ${list.length} 筆標註。可點選框後：拖框內平移、拉角/邊縮放、拖上方把手旋轉。`
          );
        } else {
          setStatus("");
        }
      } catch (err) {
        console.error("[S0] loadExisting error:", err);
      }
    }

    loadExisting();
    setImgBox(null);
    requestAnimationFrame(() => computeContainImgBox());

    // 專家模式：切換 case 時先清 S1 偵測（避免看到上一張的殘影）
    setS1Detections([]);
    setShowS1(false);

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentCase?.imageCaseId, bigBones.length]);

  // ======================
  // 選大骨抓小骨
  // ======================
  const handleSelectBigBone = async (boneId: number) => {
    setSelectedBoneId(boneId);
    setSelectedSmallBoneId(null);
    setSmallBones([]);
    setQaAnswer("");

    try {
      const data = await s0Api.getSmallBones(boneId);
      setSmallBones(data);
      setStatus("");
    } catch (err: any) {
      setStatus(`取得小骨失敗：${err.message}`);
    }
  };

  // 點框/點清單
  const handleSelectBox = (boxId: number) => {
    const b = boxes.find((x) => x.id === boxId);
    if (!b) return;

    setActiveBoxId(boxId);

    if (b.boneId != null) {
      setSelectedBoneId(b.boneId);
      setSelectedSmallBoneId(b.smallBoneId ?? null);

      void (async () => {
        try {
          const data = await s0Api.getSmallBones(b.boneId!);
          setSmallBones(data);
        } catch {}
      })();
    }
  };

  // ======================
  // 影像輪播
  // ======================
  const gotoPrev = () => {
    if (!imageCases.length) return;
    setCurrentIndex((prev) => (prev === 0 ? imageCases.length - 1 : prev - 1));
    setQaAnswer("");
  };

  const gotoNext = () => {
    if (!imageCases.length) return;
    setCurrentIndex((prev) =>
      prev === imageCases.length - 1 ? 0 : prev + 1
    );
    setQaAnswer("");
  };

  // ======================
  // Pointer helpers（座標永遠 clamp）
  // ======================
  const pointFromEvent = (e: React.PointerEvent<HTMLDivElement>) => {
    const frame = wrapperRef.current;
    if (!frame) return null;

    const fr = frame.getBoundingClientRect();
    const xInFrame = e.clientX - fr.left;
    const yInFrame = e.clientY - fr.top;

    const base = imgBox ?? { left: 0, top: 0, width: fr.width, height: fr.height };
    const xInImg = xInFrame - base.left;
    const yInImg = yInFrame - base.top;

    const nx = clamp01(xInImg / base.width);
    const ny = clamp01(yInImg / base.height);

    return { x: nx, y: ny, xInImg, yInImg, base, xInFrame, yInFrame };
  };

  const isInsideImg = (xInImg: number, yInImg: number, base: ImgBox) => {
    const eps = 2;
    return (
      xInImg >= -eps &&
      yInImg >= -eps &&
      xInImg <= base.width + eps &&
      yInImg <= base.height + eps
    );
  };

  // 點到旋轉把手？
  const hitRotateHandle = (e: React.PointerEvent<HTMLDivElement>) => {
    const active = getActiveBox();
    if (!active || !imgBox) return false;

    const bb = ensureObb(active);
    const poly = bb.poly!;
    const h = getRotateHandlePx(poly);
    if (!h) return false;

    const frame = wrapperRef.current?.getBoundingClientRect();
    if (!frame) return false;

    const x = e.clientX - frame.left;
    const y = e.clientY - frame.top;

    const dx = x - h.x;
    const dy = y - h.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    return dist <= 14;
  };

  // ======================
  // Pointer events：Draw / Move / Resize / Rotate
  // ======================
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();

    if (!imgBox) computeContainImgBox();

    const p = pointFromEvent(e);
    if (!p) return;

    const active = getActiveBox();

    // ① Rotate（優先）
    if (active && hitRotateHandle(e)) {
      const bb = ensureObb(active);

      rotatePointerIdRef.current = e.pointerId;
      rotateStartDegRef.current = bb.angleDeg ?? 0;
      obbStartRef.current = {
        cx: bb.cx!,
        cy: bb.cy!,
        obbW: bb.obbW!,
        obbH: bb.obbH!,
        angleDeg: bb.angleDeg ?? 0,
      };

      const cxPx = imgBox!.left + bb.cx! * imgBox!.width;
      const cyPx = imgBox!.top + bb.cy! * imgBox!.height;
      const startRad = Math.atan2(p.yInFrame - cyPx, p.xInFrame - cxPx);
      rotateStartRadRef.current = startRad;

      (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);

      setIsRotating(true);
      setIsMoving(false);
      setIsResizing(false);
      setIsDrawing(false);
      setDrawStart(null);
      setDraftBox(null);
      setStatus("旋轉模式：拖曳把手旋轉，放開完成。");
      return;
    }

    // ② Resize
    if (active) {
      const h = hitHandle(e, active);
      if (h) {
        const bb = ensureObb(active);
        resizeHandleRef.current = h;
        obbStartRef.current = {
          cx: bb.cx!,
          cy: bb.cy!,
          obbW: bb.obbW!,
          obbH: bb.obbH!,
          angleDeg: bb.angleDeg ?? 0,
        };
        (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);

        setIsResizing(true);
        setIsMoving(false);
        setIsRotating(false);
        setIsDrawing(false);
        setDrawStart(null);
        setDraftBox(null);
        setStatus("縮放模式：拖曳角點/邊中點調整大小。");
        return;
      }
    }

    // ③ Move（點框內）
    if (active) {
      const bb = ensureObb(active);
      if (pointInPoly([p.x, p.y], bb.poly!)) {
        moveStartRef.current = { x: p.x, y: p.y };
        obbStartRef.current = {
          cx: bb.cx!,
          cy: bb.cy!,
          obbW: bb.obbW!,
          obbH: bb.obbH!,
          angleDeg: bb.angleDeg ?? 0,
        };
        (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);

        setIsMoving(true);
        setIsResizing(false);
        setIsRotating(false);
        setIsDrawing(false);
        setDrawStart(null);
        setDraftBox(null);
        setStatus("平移模式：拖曳框內部移動位置。");
        return;
      }
    }

    // ④ Draw（需要先選骨頭）
    if (selectedBoneId == null || selectedSmallBoneId == null) {
      setStatus("請先在右側選擇大骨與小骨，再開始畫框。");
      return;
    }

    if (!isInsideImg(p.xInImg, p.yInImg, p.base)) return;

    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);

    setIsDrawing(true);
    setIsMoving(false);
    setIsResizing(false);
    setIsRotating(false);

    setDrawStart({ x: p.x, y: p.y });
    setDraftBox({ xMin: p.x, yMin: p.y, xMax: p.x, yMax: p.y });
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const p = pointFromEvent(e);
    if (!p) return;

    // Rotate
    if (
      isRotating &&
      rotatePointerIdRef.current === e.pointerId &&
      imgBox &&
      activeBoxId != null
    ) {
      const start = obbStartRef.current;
      if (!start) return;

      const cxPx = imgBox.left + start.cx * imgBox.width;
      const cyPx = imgBox.top + start.cy * imgBox.height;
      const nowRad = Math.atan2(p.yInFrame - cyPx, p.xInFrame - cxPx);
      const delta = nowRad - rotateStartRadRef.current;

      const nextAngle = rotateStartDegRef.current + rad2deg(delta);

      setBoxes((prev) =>
        prev.map((b) =>
          b.id === activeBoxId
            ? applyObbToBox(ensureObb(b), {
                cx: start.cx,
                cy: start.cy,
                obbW: start.obbW,
                obbH: start.obbH,
                angleDeg: nextAngle,
              })
            : b
        )
      );
      return;
    }

    // Resize（中心對稱縮放：穩、好用、不飄）
    if (
      isResizing &&
      activeBoxId != null &&
      resizeHandleRef.current &&
      obbStartRef.current
    ) {
      const start = obbStartRef.current;
      const handle = resizeHandleRef.current;

      const local = toLocal(p.x, p.y, start.cx, start.cy, start.angleDeg);

      let newW = start.obbW;
      let newH = start.obbH;

      if (handle.includes("e") || handle.includes("w"))
        newW = Math.max(0.01, Math.abs(local.x) * 2);
      if (handle.includes("n") || handle.includes("s"))
        newH = Math.max(0.01, Math.abs(local.y) * 2);
      if (handle === "e" || handle === "w") newH = start.obbH;
      if (handle === "n" || handle === "s") newW = start.obbW;

      setBoxes((prev) =>
        prev.map((b) =>
          b.id === activeBoxId
            ? applyObbToBox(ensureObb(b), {
                cx: start.cx,
                cy: start.cy,
                obbW: newW,
                obbH: newH,
                angleDeg: start.angleDeg,
              })
            : b
        )
      );
      return;
    }

    // Move
    if (
      isMoving &&
      activeBoxId != null &&
      moveStartRef.current &&
      obbStartRef.current
    ) {
      const s = moveStartRef.current;
      const start = obbStartRef.current;
      const dx = p.x - s.x;
      const dy = p.y - s.y;

      const halfW = start.obbW / 2;
      const halfH = start.obbH / 2;

      const cx = clamp01(start.cx + dx);
      const cy = clamp01(start.cy + dy);

      const safeCx = Math.min(1 - halfW, Math.max(halfW, cx));
      const safeCy = Math.min(1 - halfH, Math.max(halfH, cy));

      setBoxes((prev) =>
        prev.map((b) =>
          b.id === activeBoxId
            ? applyObbToBox(ensureObb(b), {
                cx: safeCx,
                cy: safeCy,
                obbW: start.obbW,
                obbH: start.obbH,
                angleDeg: start.angleDeg,
              })
            : b
        )
      );
      return;
    }

    // Draw
    if (!isDrawing || !drawStart) return;

    const xMin = Math.min(drawStart.x, p.x);
    const yMin = Math.min(drawStart.y, p.y);
    const xMax = Math.max(drawStart.x, p.x);
    const yMax = Math.max(drawStart.y, p.y);

    setDraftBox({ xMin, yMin, xMax, yMax });
  };

  const finishDrawing = (box: { xMin: number; yMin: number; xMax: number; yMax: number }) => {
    setIsDrawing(false);
    setDrawStart(null);
    setDraftBox(null);

    if (box.xMax - box.xMin < 0.01 || box.yMax - box.yMin < 0.01) return;
    if (selectedBoneId == null || selectedSmallBoneId == null) return;

    const big = bigBones.find((b) => b.boneId === selectedBoneId);
    const small = smallBones.find((s) => s.smallBoneId === selectedSmallBoneId);

    const cx = (box.xMin + box.xMax) / 2;
    const cy = (box.yMin + box.yMax) / 2;
    const obbW = Math.max(0.01, box.xMax - box.xMin);
    const obbH = Math.max(0.01, box.yMax - box.yMin);
    const angleDeg = 0;

    const poly = obbToPoly(cx, cy, obbW, obbH, angleDeg);
    const aabb = polyToAabb(poly);

    if (activeBoxId != null) {
      setBoxes((prev) =>
        prev.map((b) =>
          b.id === activeBoxId
            ? {
                ...b,
                boneId: selectedBoneId,
                smallBoneId: selectedSmallBoneId,
                boneZh: big?.boneZh ?? b.boneZh,
                smallBoneZh: small?.smallBoneZh ?? b.smallBoneZh,
                ...aabb,
                cx,
                cy,
                obbW,
                obbH,
                angleDeg,
                poly,
              }
            : b
        )
      );
      setStatus("已更新目前選取的標註框（含 OBB 參數）。");
      if (mode === "student" && !qaAnswer) void askDrBone(selectedBoneId, selectedSmallBoneId);
      return;
    }

    const newBox: AnnotationBox = {
      id: Date.now(),
      boneId: selectedBoneId,
      smallBoneId: selectedSmallBoneId,
      boneZh: big?.boneZh ?? "",
      smallBoneZh: small?.smallBoneZh ?? "",
      ...aabb,
      cx,
      cy,
      obbW,
      obbH,
      angleDeg,
      poly,
    };

    setBoxes((prev) => [...prev, newBox]);
    setActiveBoxId(newBox.id);
    setStatus(`已新增一個框：${newBox.boneZh} / ${newBox.smallBoneZh}`);
    if (mode === "student" && !qaAnswer) void askDrBone(newBox.boneId!, newBox.smallBoneId!);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    try {
      (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId);
    } catch {}

    if (isRotating && rotatePointerIdRef.current === e.pointerId) {
      setIsRotating(false);
      rotatePointerIdRef.current = null;
      obbStartRef.current = null;
      setStatus("✅ 旋轉完成（記得按送出存到後端）。");
      return;
    }

    if (isResizing) {
      setIsResizing(false);
      resizeHandleRef.current = null;
      obbStartRef.current = null;
      setStatus("✅ 縮放完成（記得按送出存到後端）。");
      return;
    }

    if (isMoving) {
      setIsMoving(false);
      moveStartRef.current = null;
      obbStartRef.current = null;
      setStatus("✅ 平移完成（記得按送出存到後端）。");
      return;
    }

    if (!isDrawing || !drawStart) {
      setIsDrawing(false);
      setDrawStart(null);
      setDraftBox(null);
      return;
    }

    const p = pointFromEvent(e);
    const end = p ? { x: p.x, y: p.y } : null;

    const finalBox =
      end
        ? {
            xMin: Math.min(drawStart.x, end.x),
            yMin: Math.min(drawStart.y, end.y),
            xMax: Math.max(drawStart.x, end.x),
            yMax: Math.max(drawStart.y, end.y),
          }
        : draftBox;

    if (!finalBox) {
      setIsDrawing(false);
      setDrawStart(null);
      setDraftBox(null);
      return;
    }

    finishDrawing(finalBox);
  };

  const handlePointerCancel = () => {
    setIsDrawing(false);
    setIsRotating(false);
    setIsMoving(false);
    setIsResizing(false);
    rotatePointerIdRef.current = null;
    resizeHandleRef.current = null;
    moveStartRef.current = null;
    obbStartRef.current = null;
    setDrawStart(null);
    setDraftBox(null);
  };

  // ======================
  // 編輯 / 刪除 / 清空
  // ======================
  const handleDeleteBox = (id: number) => {
    setBoxes((prev) => prev.filter((b) => b.id !== id));
    if (activeBoxId === id) setActiveBoxId(null);
  };

  const handleClearBoxes = () => {
    setBoxes([]);
    setActiveBoxId(null);
  };

  // ======================
  // 送標註（仍只送 AABB，後端不改也能存）
  // ======================
  // ======================
// 送標註（✅ 同時送 AABB + OBB）
// ======================
const handleSave = async () => {
  if (!currentCase) {
    setStatus("沒有選到影像案例。");
    return;
  }
  const valid = boxes.filter((b) => b.boneId != null && b.smallBoneId != null);
  if (!valid.length) {
    setStatus("請先畫至少一個有大骨 / 小骨的框。");
    return;
  }

  setSaving(true);
  setStatus("送出標註中...");

  try {
    const payload = {
      imageCaseId: currentCase.imageCaseId,
      boxes: valid.map((b) => {
        const bb = ensureObb(b); // ✅ 確保 poly/cx/cy/obbW/obbH/angleDeg 都存在

        // 兼容：polyJson（字串）+ P1X..P4Y（可選）一起送，後端吃哪個都行
        const poly = bb.poly ?? null;

        return {
          boneId: bb.boneId,
          smallBoneId: bb.smallBoneId,

          // ✅ AABB：舊版後端也能存
          x_min: bb.xMin,
          y_min: bb.yMin,
          x_max: bb.xMax,
          y_max: bb.yMax,

          // ✅ OBB：讓後端可以存旋轉框
          polyJson: poly ? JSON.stringify(poly) : null,
          angleDeg: typeof bb.angleDeg === "number" ? bb.angleDeg : 0,
          cx: typeof bb.cx === "number" ? bb.cx : (bb.xMin + bb.xMax) / 2,
          cy: typeof bb.cy === "number" ? bb.cy : (bb.yMin + bb.yMax) / 2,
          obbW: typeof bb.obbW === "number" ? bb.obbW : Math.max(0.001, bb.xMax - bb.xMin),
          obbH: typeof bb.obbH === "number" ? bb.obbH : Math.max(0.001, bb.yMax - bb.yMin),

          // ✅ 可選：有些後端表結構是 P1X..P4Y（你也有 parsePolyFromAny）
          p1x: poly ? poly[0][0] : null,
          p1y: poly ? poly[0][1] : null,
          p2x: poly ? poly[1][0] : null,
          p2y: poly ? poly[1][1] : null,
          p3x: poly ? poly[2][0] : null,
          p3y: poly ? poly[2][1] : null,
          p4x: poly ? poly[3][0] : null,
          p4y: poly ? poly[3][1] : null,
        };
      }),
    };

    await s0Api.saveAnnotations(payload);

    setStatus(
      `✅ 已為 Case #${currentCase.imageCaseId} 建立 / 覆蓋 ${valid.length} 筆標註（已包含旋轉框資訊）。`
    );
  } catch (err: any) {
    setStatus(`❌ 儲存失敗：${err.message}`);
  } finally {
    setSaving(false);
  }
};


  // ======================
  // Dr.Bone 問答（醫學生模式）
  // ======================
  const askDrBone = async (boneId: number, smallBoneId: number) => {
    if (!currentCase) return;

    setQaLoading(true);
    setStatus("");

    try {
      const big = bigBones.find((b) => b.boneId === boneId);
      const small = smallBones.find((s) => s.smallBoneId === smallBoneId) ?? null;

      const defaultQuestion =
        small?.smallBoneZh && big?.boneZh
          ? `請用淺顯的方式介紹「${small.smallBoneZh}」這塊骨頭（隸屬於 ${big.boneZh}），包含位置、功能與常見骨折。`
          : "請介紹這個骨頭的名稱、位置與常見病變。";

      const answer = await askAgentFromS0({
        imageCaseId: currentCase.imageCaseId,
        boneId,
        smallBoneId,
        question: defaultQuestion,
      });

      setQaAnswer(answer);
    } catch (err: any) {
      setStatus(`詢問 AI 失敗：${err.message}`);
    } finally {
      setQaLoading(false);
    }
  };

  const handleAskAi = async () => {
    if (!currentCase || selectedBoneId == null || selectedSmallBoneId == null) {
      setStatus("請先選好大骨與小骨，再詢問 GalaBone。");
      return;
    }
    await askDrBone(selectedBoneId, selectedSmallBoneId);
  };

  // ======================
  // S1 偵測：解析 + 載入 + 套用（專家模式）
  // ======================

  const parsePolyFromAny = (d: any): PolyPoint[] | null => {
    // 1) polyJson / PolyJson
    try {
      const pj = d.polyJson ?? d.PolyJson ?? null;
      if (typeof pj === "string" && pj.trim().startsWith("[")) {
        const arr = JSON.parse(pj);
        if (Array.isArray(arr) && arr.length === 4) {
          return arr.map((p: any) => [Number(p[0]), Number(p[1])]) as PolyPoint[];
        }
      }
    } catch {}

    // 2) P1X..P4Y
    const p1x = d.p1x ?? d.P1X;
    const p1y = d.p1y ?? d.P1Y;
    const p2x = d.p2x ?? d.P2X;
    const p2y = d.p2y ?? d.P2Y;
    const p3x = d.p3x ?? d.P3X;
    const p3y = d.p3y ?? d.P3Y;
    const p4x = d.p4x ?? d.P4X;
    const p4y = d.p4y ?? d.P4Y;
    if ([p1x,p1y,p2x,p2y,p3x,p3y,p4x,p4y].every((v) => typeof v === "number")) {
      return [
        [Number(p1x), Number(p1y)],
        [Number(p2x), Number(p2y)],
        [Number(p3x), Number(p3y)],
        [Number(p4x), Number(p4y)],
      ];
    }

    // 3) AABB fallback
    const xMin = d.xMin ?? d.XMin ?? d.x_min ?? d.X_min;
    const yMin = d.yMin ?? d.YMin ?? d.y_min ?? d.Y_min;
    const xMax = d.xMax ?? d.XMax ?? d.x_max ?? d.X_max;
    const yMax = d.yMax ?? d.YMax ?? d.y_max ?? d.Y_max;
    if ([xMin,yMin,xMax,yMax].every((v) => typeof v === "number")) {
      return [
        [Number(xMin), Number(yMin)],
        [Number(xMax), Number(yMin)],
        [Number(xMax), Number(yMax)],
        [Number(xMin), Number(yMax)],
      ];
    }

    return null;
  };

  const loadS1Detections = async () => {
    if (!currentCase) return;

    setS1Loading(true);
    setStatus("");

    try {
      // 盡量相容：如果你已經在 s0Api 做好了，就用它
      const anyApi = s0Api as any;

      let raw: any = null;

      if (typeof anyApi.getDetections === "function") {
        raw = await anyApi.getDetections(currentCase.imageCaseId);
      } else {
        // fallback：猜幾個常見路徑（你後端用哪個就會中）
        const urls = [
          `${API_BASE}/s1/cases/${currentCase.imageCaseId}/detections`,
          `${API_BASE}/s0/cases/${currentCase.imageCaseId}/detections`,
          `${API_BASE}/vision/cases/${currentCase.imageCaseId}/detections`,
          `${API_BASE}/s1/detections?imageCaseId=${currentCase.imageCaseId}`,
        ];

        let ok = false;
        for (const u of urls) {
          try {
            const res = await fetch(u);
            if (res.ok) {
              raw = await res.json();
              ok = true;
              break;
            }
          } catch {}
        }
        if (!ok) {
          throw new Error(
            "找不到 S1 detections API。請在後端提供一支 detections endpoint，或在 s0Api 加上 getDetections(caseId)。"
          );
        }
      }

      const list = Array.isArray(raw) ? raw : raw?.detections ?? raw?.items ?? [];
      const dets: S1Detection[] = (list || [])
        .map((d: any, idx: number) => {
          const poly = parsePolyFromAny(d);
          if (!poly) return null;

          const boneId =
            typeof (d.boneId ?? d.BoneId) === "number" ? (d.boneId ?? d.BoneId) : null;
          const smallBoneId =
            typeof (d.smallBoneId ?? d.SmallBoneId) === "number" ? (d.smallBoneId ?? d.SmallBoneId) : null;

          const confRaw = d.confidence ?? d.Confidence ?? null;
          const confidence = typeof confRaw === "number" ? confRaw : null;

          return {
            id: d.detectionId ?? d.DetectionId ?? d.id ?? idx,
            boneId,
            smallBoneId,
            confidence,
            poly,
          } as S1Detection;
        })
        .filter(Boolean) as S1Detection[];

      setS1Detections(dets);
      setStatus(`✅ 已載入 S1 偵測 ${dets.length} 筆（可顯示疊加、也可套用成標註）。`);
    } catch (e: any) {
      setS1Detections([]);
      setShowS1(false);
      setStatus(`❌ 載入 S1 偵測失敗：${e?.message ?? e}`);
    } finally {
      setS1Loading(false);
    }
  };

  // 由 poly 推回 OBB 參數（用邊向量估 angle、用邊長估 w/h）
  const polyToObbParams = (poly: PolyPoint[]) => {
    const p0 = poly[0];
    const p1 = poly[1];
    const p2 = poly[2];

    const vx = p1[0] - p0[0];
    const vy = p1[1] - p0[1];
    const angle = Math.atan2(vy, vx);
    const angleDeg = rad2deg(angle);

    const w = Math.max(0.01, Math.hypot(vx, vy));
    const h = Math.max(0.01, Math.hypot(p2[0] - p1[0], p2[1] - p1[1]));

    const { cx, cy } = polyCenter(poly);
    return { cx, cy, obbW: w, obbH: h, angleDeg };
  };

  const applyDetectionAsNewBox = async (det: S1Detection) => {
    if (!currentCase) return;

    // 專家模式通常不一定會先選骨頭，所以這裡用 det 的 boneId/smallBoneId
    const boneId = det.boneId ?? null;
    const smallBoneId = det.smallBoneId ?? null;

    // 名稱先用 BigBone 查到的中文，small 先用 #id（避免你沒載小骨清單也能用）
    const big = boneId != null ? bigBones.find((b) => b.boneId === boneId) : undefined;
    const boneZh = big?.boneZh ?? (boneId != null ? `Bone ${boneId}` : "Bone ?");
    const smallBoneZh = smallBoneId != null ? `SmallBone #${smallBoneId}` : "SmallBone ?";

    const poly = det.poly;
    const aabb = polyToAabb(poly);
    const obb = polyToObbParams(poly);

    const newBox: AnnotationBox = {
      id: Date.now(),
      boneId,
      smallBoneId,
      boneZh,
      smallBoneZh,
      ...aabb,
      poly,
      ...obb,
    };

    setBoxes((prev) => [...prev, newBox]);
    setActiveBoxId(newBox.id);

    // 同步右側選取（有 boneId 才做）
    if (boneId != null) {
      setSelectedBoneId(boneId);
      try {
        const data = await s0Api.getSmallBones(boneId);
        setSmallBones(data);
        if (smallBoneId != null) setSelectedSmallBoneId(smallBoneId);
      } catch {}
    }

    setStatus(
      `✅ 已套用 S1 偵測成標註框（${boneZh}${smallBoneId != null ? ` / #${smallBoneId}` : ""}）。你可再微調後送出。`
    );
  };

  // ======================
  // 命中層：透明 div 讓你可以點選框（用 AABB）
  // ======================
  const renderHitStyle = (b: { xMin: number; yMin: number; xMax: number; yMax: number }): React.CSSProperties => {
    const base = imgBox;
    if (!base) return { display: "none" };

    const left = base.left + b.xMin * base.width;
    const top = base.top + b.yMin * base.height;
    const width = (b.xMax - b.xMin) * base.width;
    const height = (b.yMax - b.yMin) * base.height;

    return {
      position: "absolute",
      left,
      top,
      width,
      height,
      background: "transparent",
      border: "none",
      pointerEvents: isDrawing || isRotating || isMoving || isResizing ? "none" : "auto",
      cursor: isDrawing ? "crosshair" : "pointer",
    };
  };

  const active = getActiveBox();

  // ======================
  // JSX
  // ======================
  return (
    <main className="s0-page">
      {/* 頁首：模式切換（分流） */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="s0-title">影像標註站（S0）</h1>
          <p className="s0-subtitle">
            {mode === "student"
              ? "醫學生模式：依步驟學習標註 + 可請 GalaBone 解說。"
              : "醫師/教師模式：以審核/校正為主，可顯示 S1 偵測並快速套用修正。"}
          </p>
        </div>

        <div className="flex gap-2 items-center">
          <span className="text-sm opacity-70">使用模式</span>
          <button
            type="button"
            className={`s0-btn-secondary ${mode === "student" ? "opacity-100" : "opacity-60"}`}
            onClick={() => setMode("student")}
            title="給醫學生：練習標註 + 問 AI"
          >
            醫學生
          </button>
          <button
            type="button"
            className={`s0-btn-secondary ${mode === "expert" ? "opacity-100" : "opacity-60"}`}
            onClick={() => setMode("expert")}
            title="給醫師/醫學系教師：審核模型偵測 + 校正標註"
          >
            醫師/教師
          </button>
        </div>
      </div>

      <section className="s0-top">
        {/* 左：待標註影像卡 + 畫框區 */}
        <div className="s0-card s0-card-left">
          <div className="s0-card-header">
            <div>
              <h2 className="s0-card-title">
                {mode === "student" ? "待標註影像（學習用）" : "影像審核（專家用）"}
              </h2>
              <p className="s0-card-sub">
                {mode === "student"
                  ? "先在右側選好骨頭 → 回來拖曳畫框。選中框後：拖框內平移、拉角/邊縮放、拖上方把手旋轉。"
                  : "可載入 S1 偵測結果疊加顯示；也可一鍵把某個偵測框套用成標註，再微調後送出。"}
              </p>

              {/* 專家模式：S1 控制列 */}
              {mode === "expert" && currentCase && (
                <div className="flex gap-2 mt-2 flex-wrap items-center">
                  <button
                    type="button"
                    className="s0-btn-secondary"
                    onClick={loadS1Detections}
                    disabled={s1Loading}
                    title="從後端載入 S1 YOLO 偵測結果"
                  >
                    {s1Loading ? "載入 S1 中..." : "載入 S1 偵測結果"}
                  </button>

                  <button
                    type="button"
                    className="s0-btn-secondary"
                    onClick={() => setShowS1((v) => !v)}
                    disabled={s1Loading || s1Detections.length === 0}
                    title="疊加顯示/隱藏 S1 偵測框"
                  >
                    {showS1 ? "隱藏 S1 偵測框" : "顯示 S1 偵測框"}
                  </button>

                  <span className="text-xs opacity-70">
                    S1: {s1Detections.length} boxes
                  </span>
                </div>
              )}
            </div>

            {currentCase && (
              <span className="s0-badge">Case #{currentCase.imageCaseId}</span>
            )}
          </div>

          {loading ? (
            <p className="s0-hint">載入中…</p>
          ) : !currentCase ? (
            <p className="s0-hint">
              目前沒有待標註影像，請先回「辨識頁面」上傳 X 光。
            </p>
          ) : (
            <>
              <div className="s0-carousel-main">
                <button type="button" className="s0-nav-btn" onClick={gotoPrev}>
                  ◀
                </button>

                <div
                  className="s0-image-frame"
                  ref={wrapperRef}
                  style={{ touchAction: "none" }}
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  onPointerCancel={handlePointerCancel}
                >
                  <img
                    ref={imgRef}
                    src={currentCase.imageUrl}
                    alt={`case-${currentCase.imageCaseId}`}
                    className="s0-main-image"
                    onLoad={handleImageLoad}
                    draggable={false}
                    onDragStart={(e) => e.preventDefault()}
                  />

                  {/* ✅ 視覺層：SVG 畫 OBB（不吃事件） */}
                  {imgBox && (
                    <svg
                      className="absolute inset-0 w-full h-full"
                      viewBox={`0 0 ${wrapperRef.current?.clientWidth ?? 100} ${
                        wrapperRef.current?.clientHeight ?? 100
                      }`}
                      preserveAspectRatio="none"
                      style={{ pointerEvents: "none" }}
                    >
                      {/* ✅ S1 偵測框（專家模式才可能顯示） */}
                      {mode === "expert" && showS1 &&
                        s1Detections.map((d) => {
                          const pts = polyToSvgPoints(d.poly);
                          if (!pts) return null;
                          return (
                            <polygon
                              key={`s1_${d.id}`}
                              points={pts}
                              fill="none"
                              stroke="#a78bfa"
                              strokeWidth={2}
                              opacity={0.85}
                              strokeDasharray="8 6"
                            />
                          );
                        })
                      }

                      {/* 已標註框 */}
                      {boxes.map((b) => {
                        const bb = ensureObb(b);
                        const pts = polyToSvgPoints(bb.poly!);
                        if (!pts) return null;

                        const isActive = activeBoxId === b.id;
                        const stroke = isActive ? "#0ea5e9" : "#22c55e";
                        const strokeWidth = isActive ? 4 : 2;

                        return (
                          <polygon
                            key={b.id}
                            points={pts}
                            fill="none"
                            stroke={stroke}
                            strokeWidth={strokeWidth}
                            opacity={0.95}
                          />
                        );
                      })}

                      {/* 拖曳預覽框（AABB） */}
                      {draftBox &&
                        (() => {
                          const base = aabbToPoly(
                            draftBox.xMin,
                            draftBox.yMin,
                            draftBox.xMax,
                            draftBox.yMax
                          );
                          const pts = polyToSvgPoints(base.poly);
                          if (!pts) return null;
                          return (
                            <polygon
                              key="draft"
                              points={pts}
                              fill="none"
                              stroke="#60a5fa"
                              strokeWidth={2}
                              opacity={0.9}
                              strokeDasharray="6 4"
                            />
                          );
                        })()}

                      {/* ✅ Resize handles（只有 active 顯示） */}
                      {active &&
                        (() => {
                          const bb = ensureObb(active);
                          const handles = getHandles(bb.poly!);
                          return (Object.keys(handles) as ResizeHandle[]).map(
                            (k) => {
                              const [nx, ny] = handles[k];
                              const x = imgBox.left + nx * imgBox.width;
                              const y = imgBox.top + ny * imgBox.height;
                              return (
                                <circle
                                  key={`h_${k}`}
                                  cx={x}
                                  cy={y}
                                  r={5}
                                  fill="rgba(34,211,238,0.22)"
                                  stroke="#22d3ee"
                                  strokeWidth={2}
                                />
                              );
                            }
                          );
                        })()}

                      {/* 旋轉把手（只有 active 顯示） */}
                      {active &&
                        (() => {
                          const bb = ensureObb(active);
                          const h = getRotateHandlePx(bb.poly!);
                          if (!h) return null;
                          return (
                            <>
                              <line
                                x1={h.x}
                                y1={h.y + 16}
                                x2={h.x}
                                y2={h.y}
                                stroke="#22d3ee"
                                strokeWidth={2}
                                opacity={0.9}
                              />
                              <circle
                                cx={h.x}
                                cy={h.y}
                                r={8}
                                fill="rgba(34,211,238,0.25)"
                                stroke="#22d3ee"
                                strokeWidth={2}
                              />
                            </>
                          );
                        })()}
                    </svg>
                  )}

                  {/* ✅ 命中層：透明 div 讓你可以點選框 */}
                  {boxes.map((b) => (
                    <div
                      key={`${b.id}_hit`}
                      style={renderHitStyle(b)}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSelectBox(b.id);
                      }}
                      title="點選以選取此框（可平移/縮放/旋轉）"
                    />
                  ))}
                </div>

                <button type="button" className="s0-nav-btn" onClick={gotoNext}>
                  ▶
                </button>
              </div>

              <div className="s0-thumb-strip">
                {imageCases.map((c, idx) => (
                  <button
                    key={c.imageCaseId}
                    type="button"
                    className={`s0-thumb-wrap ${
                      idx === currentIndex ? "s0-thumb-wrap--active" : ""
                    }`}
                    onClick={() => {
                      setCurrentIndex(idx);
                      setQaAnswer("");
                    }}
                  >
                    <img
                      src={c.thumbnailUrl}
                      alt={`case-thumb-${c.imageCaseId}`}
                      className="s0-thumb-image"
                    />
                  </button>
                ))}
              </div>

              <div className="s0-annot-summary">
                <span>目前此影像共有 </span>
                <span className="s0-annot-count">{boxes.length}</span>
                <span> 個標註框。</span>
                {boxes.length > 0 && (
                  <button
                    type="button"
                    className="s0-link-btn"
                    onClick={handleClearBoxes}
                  >
                    清除本圖全部框
                  </button>
                )}
              </div>

              {boxes.length > 0 && (
                <div className="s0-annot-list">
                  {boxes.map((b, idx) => (
                    <div
                      key={b.id}
                      className={`s0-annot-item ${
                        activeBoxId === b.id ? "s0-annot-item--active" : ""
                      }`}
                      onClick={() => handleSelectBox(b.id)}
                    >
                      <div className="s0-annot-label">
                        #{idx + 1} — {b.boneZh} / {b.smallBoneZh}
                        {activeBoxId === b.id && (
                          <span style={{ marginLeft: 8, opacity: 0.8 }}>
                            {typeof b.angleDeg === "number"
                              ? `（旋轉 ${b.angleDeg.toFixed(1)}°）`
                              : ""}
                          </span>
                        )}
                      </div>
                      <button
                        type="button"
                        className="s0-annot-delete"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteBox(b.id);
                        }}
                      >
                        刪除
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* 右：控制卡（依模式分流） */}
        <div className="s0-card s0-card-right">
          {mode === "student" ? (
            <>
              <h2 className="s0-card-title">骨頭標註（醫學生）</h2>
              <p className="s0-card-sub">
                先選大骨 → 選小骨 → 左邊畫框。選取框後可平移/縮放/旋轉，再送出；也可請 GalaBone 解說。
              </p>

              <p className="s0-label">大骨（41 類）：</p>
              <div className="s0-bone-chip-row">
                {bigBones.map((b) => (
                  <button
                    key={b.boneId}
                    type="button"
                    className={`s0-bone-chip ${
                      selectedBoneId === b.boneId ? "s0-bone-chip--active" : ""
                    }`}
                    onClick={() => handleSelectBigBone(b.boneId)}
                  >
                    <span className="s0-bone-chip-main">{b.boneZh}</span>
                    <span className="s0-bone-chip-sub">{b.boneEn}</span>
                  </button>
                ))}
              </div>

              <p className="s0-label" style={{ marginTop: 16 }}>
                小骨（206 細項）：
              </p>
              {selectedBoneId ? (
                smallBones.length ? (
                  <div className="s0-smallbone-list" id="s0-smallbone-list">
                    {smallBones.map((s) => (
                      <button
                        key={s.smallBoneId}
                        type="button"
                        className={`s0-smallbone-item ${
                          selectedSmallBoneId === s.smallBoneId
                            ? "s0-smallbone-item--active"
                            : ""
                        }`}
                        onClick={() => setSelectedSmallBoneId(s.smallBoneId)}
                      >
                        <div className="s0-smallbone-name">
                          {s.smallBoneZh}
                          {s.place ? `（${s.place}）` : ""}
                        </div>
                        <div className="s0-smallbone-en">
                          {s.smallBoneEn}
                          {s.serialNumber != null ? ` · #${s.serialNumber}` : ""}
                        </div>
                        {s.note && <div className="s0-smallbone-note">{s.note}</div>}
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="s0-hint">
                    這個大骨目前查不到小骨，請確認資料表設定。
                  </p>
                )
              ) : (
                <p className="s0-hint">請先在上方選擇一個大骨。</p>
              )}

              {currentCase && selectedBoneId && selectedSmallBoneId && (
                <p className="s0-hint mt-3">
                  將為{" "}
                  <span className="font-semibold">
                    Case #{currentCase.imageCaseId}
                  </span>{" "}
                  標註：{" "}
                  <span className="font-semibold">
                    {bigBones.find((b) => b.boneId === selectedBoneId)?.boneZh}
                  </span>{" "}
                  →
                  <span className="font-semibold">
                    {
                      smallBones.find((s) => s.smallBoneId === selectedSmallBoneId)
                        ?.smallBoneZh
                    }
                  </span>
                </p>
              )}

              <div className="flex gap-3 mt-4">
                <button
                  className="s0-btn-secondary"
                  onClick={handleAskAi}
                  disabled={qaLoading || !selectedBoneId || !selectedSmallBoneId}
                >
                  {qaLoading ? "GalaBone 解說中…" : "請 GalaBone 解說這顆骨頭"}
                </button>

                <button
                  className="s0-btn-primary"
                  onClick={handleSave}
                  disabled={saving || !canSubmit}
                >
                  {saving ? "送出中…" : "送出標註到後端"}
                </button>
              </div>

              {qaAnswer && (
                <div className="s0-ai-answer">
                  <h3 className="s0-ai-title">GalaBone 解說</h3>
                  <p className="s0-ai-text whitespace-pre-wrap">{qaAnswer}</p>
                </div>
              )}
            </>
          ) : (
            <>
              <h2 className="s0-card-title">審核/校正（醫師/教師）</h2>
              <p className="s0-card-sub">
                建議流程：① 載入 S1 偵測 → ② 顯示疊加框 → ③ 選一筆偵測「套用成標註」→ ④ 微調後送出。  
                （這才像專家會做的事：少畫框、多校正）
              </p>

              <div className="flex gap-3 mt-4">
                <button
                  className="s0-btn-secondary"
                  onClick={loadS1Detections}
                  disabled={s1Loading || !currentCase}
                >
                  {s1Loading ? "載入中…" : "載入 S1 偵測"}
                </button>

                <button
                  className="s0-btn-secondary"
                  onClick={() => setShowS1((v) => !v)}
                  disabled={s1Loading || s1Detections.length === 0}
                >
                  {showS1 ? "隱藏疊加" : "顯示疊加"}
                </button>

                <button
                  className="s0-btn-primary"
                  onClick={handleSave}
                  disabled={saving || !canSubmit}
                  title="把你校正後的標註送回後端（可作為教學/模型回饋資料）"
                >
                  {saving ? "送出中…" : "送出校正結果"}
                </button>
              </div>

              <div className="mt-4">
                <div className="text-sm opacity-80 mb-2">
                  S1 偵測清單（點「套用」會變成可編輯標註框）
                </div>

                {s1Detections.length === 0 ? (
                  <div className="s0-hint">
                    尚未載入偵測。請先按「載入 S1 偵測」。  
                    如果一直失敗，代表你後端還沒提供 detections API（我可以補 FastAPI 那支）。
                  </div>
                ) : (
                  <div className="s0-annot-list">
                    {s1Detections
                      .slice()
                      .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))
                      .map((d) => {
                        const boneZh =
                          d.boneId != null
                            ? bigBones.find((b) => b.boneId === d.boneId)?.boneZh ??
                              `Bone ${d.boneId}`
                            : "Bone ?";
                        const sb = d.smallBoneId != null ? `#${d.smallBoneId}` : "?";
                        const conf = d.confidence != null ? `${(d.confidence * 100).toFixed(1)}%` : "—";

                        return (
                          <div
                            key={`det_${d.id}`}
                            className="s0-annot-item"
                            style={{ cursor: "default" }}
                          >
                            <div className="s0-annot-label">
                              {boneZh} / SmallBone {sb}{" "}
                              <span style={{ marginLeft: 8, opacity: 0.7 }}>
                                (conf {conf})
                              </span>
                            </div>

                            <button
                              type="button"
                              className="s0-btn-secondary"
                              onClick={() => applyDetectionAsNewBox(d)}
                              title="把這個偵測框直接變成一個可編輯標註框"
                            >
                              套用
                            </button>
                          </div>
                        );
                      })}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </section>

      {status && <p className="s0-status">{status}</p>}
    </main>
  );
}
