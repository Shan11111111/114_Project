"use client";


import { useEffect, useMemo, useState } from "react";
import {
  s0Api,
  BigBone,
  SmallBone,
  ImageCase,
} from "../../lib/s0Api";

export default function S0Page() {
  const [imageCases, setImageCases] = useState<ImageCase[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);

  const [bigBones, setBigBones] = useState<BigBone[]>([]);
  const [smallBones, setSmallBones] = useState<SmallBone[]>([]);
  const [selectedBoneId, setSelectedBoneId] = useState<number | null>(null);
  const [selectedSmallBoneId, setSelectedSmallBoneId] =
    useState<number | null>(null);

  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const currentCase: ImageCase | null = useMemo(() => {
    if (!imageCases.length) return null;
    return imageCases[currentIndex] ?? imageCases[0];
  }, [imageCases, currentIndex]);

  // 初始化：抓待標註影像 + 大骨
  useEffect(() => {
    console.log("pending cases from API:", imageCases);
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

  // 選大骨時抓小骨
  const handleSelectBigBone = async (boneId: number) => {
    setSelectedBoneId(boneId);
    setSelectedSmallBoneId(null);
    setSmallBones([]);

    try {
      const data = await s0Api.getSmallBones(boneId);
      setSmallBones(data);
    } catch (err: any) {
      setStatus(`取得小骨失敗：${err.message}`);
    }
  };

  // 影像輪播切換
  const gotoPrev = () => {
    if (!imageCases.length) return;
    setCurrentIndex((prev) =>
      prev === 0 ? imageCases.length - 1 : prev - 1
    );
  };

  const gotoNext = () => {
    if (!imageCases.length) return;
    setCurrentIndex((prev) =>
      prev === imageCases.length - 1 ? 0 : prev + 1
    );
  };

  // 送標註
  const handleSave = async () => {
    if (!currentCase) {
      setStatus("沒有選到影像案例。");
      return;
    }
    if (!selectedBoneId) {
      setStatus("請先選擇大骨。");
      return;
    }
    if (!selectedSmallBoneId) {
      setStatus("請先選擇小骨。");
      return;
    }

    setSaving(true);
    setStatus("送出標註中...");

    try {
      await s0Api.saveAnnotations({
        imageCaseId: currentCase.imageCaseId,
        boxes: [
          {
            boneId: selectedBoneId,
            smallBoneId: selectedSmallBoneId,
            // TODO: 之後改成前端真的畫出來的座標
            x_min: 100,
            y_min: 120,
            x_max: 360,
            y_max: 420,
          },
        ],
      });

      setStatus(
        `✅ 已為 Case #${currentCase.imageCaseId} 建立一筆標註。`
      );
    } catch (err: any) {
      setStatus(`❌ 儲存失敗：${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="s0-page">
      <h1 className="s0-title">影像標註站（S0）</h1>
      <p className="s0-subtitle">
        選擇最新的待標註 X 光影像，指定骨頭名稱，送出標註結果提供 S1 / S2 模型訓練與驗證。
      </p>

      <section className="s0-top">
        {/* 左：待標註影像卡 */}
        <div className="s0-card s0-card-left">
          <div className="s0-card-header">
            <div>
              <h2 className="s0-card-title">待標註影像</h2>
              <p className="s0-card-sub">
                從左下方縮圖或左右箭頭切換影像，會自動帶入對應的 CaseId。
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
                <div className="s0-image-frame">
                  <img
                    src={currentCase.imageUrl}
                    alt={`case-${currentCase.imageCaseId}`}
                    className="s0-main-image"
                  />
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
                    onClick={() => setCurrentIndex(idx)}
                  >
                    <img
                      src={c.thumbnailUrl}
                      alt={`case-thumb-${c.imageCaseId}`}
                      className="s0-thumb-image"
                    />
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* 右：骨頭選擇卡 */}
        <div className="s0-card s0-card-right">
          <h2 className="s0-card-title">骨頭標註</h2>
          <p className="s0-card-sub">
            先選擇大骨，再從下方清單中選擇對應的小骨名稱。
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
              <div className="s0-smallbone-list">
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
                    </div>
                    <div className="s0-smallbone-en">
                      {s.smallBoneEn}
                    </div>
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

          <button
            className="s0-btn-primary"
            onClick={handleSave}
            disabled={saving || !currentCase}
          >
            {saving ? "送出中…" : "送出標註到後端"}
          </button>
        </div>
      </section>

      {status && <p className="s0-status">{status}</p>}
    </main>
  );
}
