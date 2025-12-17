"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  s0Api,
  BigBone,
  SmallBone,
  ImageCase,
  askAgentFromS0,
} from "../../lib/s0Api";

// 一個標註框的型別（0~1 normalized）
type AnnotationBox = {
  id: number;
  boneId: number | null;
  smallBoneId: number | null;
  boneZh: string;
  smallBoneZh: string;
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
};

export default function S0Page() {
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

  // 畫框相關狀態
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(
    null
  );
  const [imgRect, setImgRect] = useState<DOMRect | null>(null);
  // 正在拖曳中的「預覽框」
  const [draftBox, setDraftBox] = useState<{
    xMin: number;
    yMin: number;
    xMax: number;
    yMax: number;
  } | null>(null);

  // ⭐ S2 問答用
  const [qaLoading, setQaLoading] = useState(false);
  const [qaAnswer, setQaAnswer] = useState("");

  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  const currentCase: ImageCase | null = useMemo(() => {
    if (!imageCases.length) return null;
    return imageCases[currentIndex] ?? imageCases[0];
  }, [imageCases, currentIndex]);

  const canSubmit = !!currentCase && boxes.length > 0;

  // ======================
  // 初始化：抓待標註影像 + 大骨
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
  // 影像尺寸量測（畫框要用）
  // ======================
  const measureImageRect = () => {
    if (!wrapperRef.current) return;
    const rect = wrapperRef.current.getBoundingClientRect();
    setImgRect(rect);
  };

  const handleImageLoad = () => {
    measureImageRect();
  };

  useEffect(() => {
    window.addEventListener("resize", measureImageRect);
    return () => window.removeEventListener("resize", measureImageRect);
  }, []);

  // ======================
  // 切換 Case 時，載入舊的標註框（如果有）
  // ======================
  useEffect(() => {
    if (!currentCase) return;

    async function loadExisting() {
      if (!currentCase) return;
      const caseId = currentCase.imageCaseId;
      try {
        const raw = await s0Api.getAnnotations(caseId);
        console.log("[S0] annotations from API:", raw);

        const list: AnnotationBox[] = (raw || []).map(
          (a: any, idx: number): AnnotationBox => {
            // 後端主要欄位：BoneId / SmallBoneId
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

            return {
              id:
                a.annotationId ??
                a.AnnotationId ??
                a.imageAnnotationId ??
                idx,
              boneId,
              smallBoneId,
              boneZh,
              smallBoneZh: smallZh,
              xMin: Number(a.x_min ?? a.X_min ?? a.XMin ?? 0),
              yMin: Number(a.y_min ?? a.Y_min ?? a.YMin ?? 0),
              xMax: Number(a.x_max ?? a.X_max ?? a.XMax ?? 1),
              yMax: Number(a.y_max ?? a.Y_max ?? a.YMax ?? 1),
            };
          }
        );

        setBoxes(list);
        setActiveBoxId(null);
        setDraftBox(null);

        if (list.length) {
          setStatus(
            `這張影像已經有 ${list.length} 筆標註，你可以點選下方其中一個框 → 再在圖片上重新拉框，就會覆蓋原本的位置。`
          );
        } else {
          setStatus("");
        }
      } catch (err) {
        console.error("[S0] loadExisting error:", err);
      }
    }

    loadExisting();
  }, [currentCase?.imageCaseId, bigBones.length]);

  // ======================
  // 選大骨時抓該大骨的小骨（不會清除既有框）
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

  // ======================
  // 影像輪播切換
  // ======================
  const gotoPrev = () => {
    if (!imageCases.length) return;
    setCurrentIndex((prev) =>
      prev === 0 ? imageCases.length - 1 : prev - 1
    );
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
  // 畫框：滑鼠事件 + 同步預覽
  // ======================
  const pointFromEvent = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!imgRect) return null;
    const x = e.clientX - imgRect.left;
    const y = e.clientY - imgRect.top;
    if (x < 0 || y < 0 || x > imgRect.width || y > imgRect.height) {
      return null;
    }
    return {
      x: x / imgRect.width,
      y: y / imgRect.height,
    };
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!imgRect) return;
    if (selectedBoneId == null || selectedSmallBoneId == null) {
      setStatus("請先在右側選擇大骨與小骨，再開始畫框。");
      return;
    }
    const p = pointFromEvent(e);
    if (!p) return;

    setIsDrawing(true);
    setDrawStart(p);

    // 一開始就先產生一個很小的暫時框，讓使用者有視覺回饋
    setDraftBox({
      xMin: p.x,
      yMin: p.y,
      xMax: p.x,
      yMax: p.y,
    });
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isDrawing || !drawStart || !imgRect) return;
    const p = pointFromEvent(e);
    if (!p) return;

    const xMin = Math.min(drawStart.x, p.x);
    const yMin = Math.min(drawStart.y, p.y);
    const xMax = Math.max(drawStart.x, p.x);
    const yMax = Math.max(drawStart.y, p.y);

    setDraftBox({ xMin, yMin, xMax, yMax });
  };

  const finishDrawing = (box: {
    xMin: number;
    yMin: number;
    xMax: number;
    yMax: number;
  }) => {
    setIsDrawing(false);
    setDrawStart(null);
    setDraftBox(null);

    // 太小的框就當誤觸
    if (box.xMax - box.xMin < 0.01 || box.yMax - box.yMin < 0.01) {
      return;
    }
    if (selectedBoneId == null || selectedSmallBoneId == null) return;

    const big = bigBones.find((b) => b.boneId === selectedBoneId);
    const small = smallBones.find((s) => s.smallBoneId === selectedSmallBoneId);

    if (activeBoxId != null) {
      // 編輯模式：更新目前選取的那一框位置
      setBoxes((prev) =>
        prev.map((b) =>
          b.id === activeBoxId
            ? {
                ...b,
                xMin: box.xMin,
                yMin: box.yMin,
                xMax: box.xMax,
                yMax: box.yMax,
                boneId: selectedBoneId,
                smallBoneId: selectedSmallBoneId,
                boneZh: big?.boneZh ?? b.boneZh,
                smallBoneZh: small?.smallBoneZh ?? b.smallBoneZh,
              }
            : b
        )
      );
      setStatus("已更新目前選取的標註框位置。");
      // 自動問一次 Dr.Bone（如果之前沒回答過）
      if (!qaAnswer) {
        void askDrBone(selectedBoneId, selectedSmallBoneId);
      }
      return;
    }

    // 新增模式：新增一個框
    const newBox: AnnotationBox = {
      id: Date.now(),
      boneId: selectedBoneId,
      smallBoneId: selectedSmallBoneId,
      boneZh: big?.boneZh ?? "",
      smallBoneZh: small?.smallBoneZh ?? "",
      xMin: box.xMin,
      yMin: box.yMin,
      xMax: box.xMax,
      yMax: box.yMax,
    };

    setBoxes((prev) => [...prev, newBox]);
    setActiveBoxId(newBox.id);
    setStatus(`已新增一個框：${newBox.boneZh} / ${newBox.smallBoneZh}`);

    // 第一次畫框就自動呼叫 Dr.Bone 解說
    if (!qaAnswer) {
      void askDrBone(newBox.boneId!, newBox.smallBoneId!);
    }
  };

  const handleMouseUp = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isDrawing || !drawStart || !imgRect) {
      setIsDrawing(false);
      setDrawStart(null);
      setDraftBox(null);
      return;
    }
    const end = pointFromEvent(e);
    if (!end) {
      setIsDrawing(false);
      setDrawStart(null);
      setDraftBox(null);
      return;
    }

    const xMin = Math.min(drawStart.x, end.x);
    const yMin = Math.min(drawStart.y, end.y);
    const xMax = Math.max(drawStart.x, end.x);
    const yMax = Math.max(drawStart.y, end.y);

    finishDrawing({ xMin, yMin, xMax, yMax });
  };

  const handleMouseLeave = () => {
    if (isDrawing) {
      setIsDrawing(false);
      setDrawStart(null);
      setDraftBox(null);
    }
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
  // 送標註：把目前畫面上的「全部框」丟給後端 → 後端覆蓋舊資料
  // ======================
  const handleSave = async () => {
    if (!currentCase) {
      setStatus("沒有選到影像案例。");
      return;
    }
    const valid = boxes.filter(
      (b) => b.boneId != null && b.smallBoneId != null
    );
    if (!valid.length) {
      setStatus("請先畫至少一個有大骨 / 小骨的框。");
      return;
    }

    setSaving(true);
    setStatus("送出標註中...");

    try {
      const payload = {
        imageCaseId: currentCase.imageCaseId,
        boxes: valid.map((b) => ({
          boneId: b.boneId,
          smallBoneId: b.smallBoneId,
          x_min: b.xMin,
          y_min: b.yMin,
          x_max: b.xMax,
          y_max: b.yMax,
        })),
      };

      await s0Api.saveAnnotations(payload);

      setStatus(
        `✅ 已為 Case #${currentCase.imageCaseId} 建立 / 覆蓋 ${valid.length} 筆標註。`
      );
    } catch (err: any) {
      setStatus(`❌ 儲存失敗：${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  // ======================
  // Dr.Bone 問答（共用邏輯）
  // ======================
  const askDrBone = async (boneId: number, smallBoneId: number) => {
    if (!currentCase) return;

    setQaLoading(true);
    setStatus("");

    try {
      const big = bigBones.find((b) => b.boneId === boneId);
      // 小骨列表只抓目前選中的大骨，如果找不到就算了，文字照樣產
      const small =
        smallBones.find((s) => s.smallBoneId === smallBoneId) ?? null;

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
    if (
      !currentCase ||
      selectedBoneId == null ||
      selectedSmallBoneId == null
    ) {
      setStatus("請先選好大骨與小骨，再詢問 GalaBone。");
      return;
    }
    await askDrBone(selectedBoneId, selectedSmallBoneId);
  };

  // ======================
  // 把 normalized box 轉成 CSS style
  // ======================
  const renderBoxStyle = (b: {
    xMin: number;
    yMin: number;
    xMax: number;
    yMax: number;
    isActive?: boolean;
    isDraft?: boolean;
  }): React.CSSProperties => {
    if (!imgRect) return { display: "none" };
    const left = b.xMin * imgRect.width;
    const top = b.yMin * imgRect.height;
    const width = (b.xMax - b.xMin) * imgRect.width;
    const height = (b.yMax - b.yMin) * imgRect.height;

    let borderColor = "#22c55e";
    if (b.isDraft) borderColor = "#60a5fa";
    else if (b.isActive) borderColor = "#0ea5e9";

    return {
      position: "absolute",
      left,
      top,
      width,
      height,
      border: `2px solid ${borderColor}`,
      boxSizing: "border-box",
      pointerEvents: "none",
    };
  };

  // ======================
  // JSX
  // ======================
  return (
    <main className="s0-page">
      <h1 className="s0-title">影像標註站（S0）</h1>
      <p className="s0-subtitle">
        STEP 1：選影像 → STEP 2：選大骨 → STEP 3：選小骨 → STEP 4：在影像上框出骨頭，按「送出」即可建立或覆蓋標註；也可以請
        GalaBone 解說。
      </p>

      <section className="s0-top">
        {/* 左：待標註影像卡 + 畫框區 */}
        <div className="s0-card s0-card-left">
          <div className="s0-card-header">
            <div>
              <h2 className="s0-card-title">待標註影像</h2>
              <p className="s0-card-sub">
                從下方縮圖或左右箭頭切換影像，會自動帶入 CaseId。先在右側選好骨頭，再回來在圖片上拖曳滑鼠畫框；
                若要調整大小，先點選底下某一個框 → 再在圖片上重新拉框。
              </p>
            </div>
            {currentCase && (
              <span className="s0-badge">
                Case #{currentCase.imageCaseId}
              </span>
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
                <button
                  type="button"
                  className="s0-nav-btn"
                  onClick={gotoPrev}
                >
                  ◀
                </button>

                <div
                  className="s0-image-frame"
                  ref={wrapperRef}
                  onMouseDown={handleMouseDown}
                  onMouseMove={handleMouseMove}
                  onMouseUp={handleMouseUp}
                  onMouseLeave={handleMouseLeave}
                >
                  <img
                    ref={imgRef}
                    src={currentCase.imageUrl}
                    alt={`case-${currentCase.imageCaseId}`}
                    className="s0-main-image"
                    onLoad={handleImageLoad}
                  />

                  {/* 已標註的框 */}
                  {boxes.map((b) => (
                    <div
                      key={b.id}
                      style={renderBoxStyle({
                        xMin: b.xMin,
                        yMin: b.yMin,
                        xMax: b.xMax,
                        yMax: b.yMax,
                        isActive: activeBoxId === b.id,
                      })}
                      className="s0-annot-box"
                    />
                  ))}

                  {/* 正在拖曳中的預覽框 */}
                  {draftBox && (
                    <div
                      style={renderBoxStyle({
                        ...draftBox,
                        isDraft: true,
                      })}
                      className="s0-annot-box s0-annot-box--draft"
                    />
                  )}
                </div>

                <button
                  type="button"
                  className="s0-nav-btn"
                  onClick={gotoNext}
                >
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
                  <>
                    <button
                      type="button"
                      className="s0-link-btn"
                      onClick={handleClearBoxes}
                    >
                      清除本圖全部框
                    </button>
                  </>
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
                      onClick={() => setActiveBoxId(b.id)}
                    >
                      <div className="s0-annot-label">
                        #{idx + 1} — {b.boneZh} / {b.smallBoneZh}
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

        {/* 右：骨頭選擇卡 */}
        <div className="s0-card s0-card-right">
          <h2 className="s0-card-title">骨頭標註</h2>
          <p className="s0-card-sub">
            STEP 2：先選擇大骨 → STEP 3：選小骨 → 然後在左邊影像上拖曳滑鼠畫出框。已標過的也可以重新調整後再送出。
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
                    onClick={() =>
                      setSelectedSmallBoneId(s.smallBoneId)
                    }
                  >
                    <div className="s0-smallbone-name">
                      {s.smallBoneZh}
                      {s.place ? `（${s.place}）` : ""}
                    </div>
                    <div className="s0-smallbone-en">
                      {s.smallBoneEn}
                      {s.serialNumber != null
                        ? ` · #${s.serialNumber}`
                        : ""}
                    </div>
                    {s.note && (
                      <div className="s0-smallbone-note">
                        {s.note}
                      </div>
                    )}
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

          {/* 選擇摘要 */}
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
                  smallBones.find(
                    (s) => s.smallBoneId === selectedSmallBoneId
                  )?.smallBoneZh
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
        </div>
      </section>

      {status && <p className="s0-status">{status}</p>}
    </main>
  );
}
