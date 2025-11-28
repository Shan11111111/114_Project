import React, { useEffect, useState, useRef } from "react";
import {
  fetchImageCases,
  fetchImageDetail,
  saveAnnotations,
  uploadImage,
  fetchBoneOptions,
} from "./api/annotation";

const panelStyle = {
  display: "flex",
  height: "100vh",
  fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
  fontSize: 13,
};

const sidebarStyle = {
  width: "240px",
  borderRight: "1px solid #ddd",
  padding: "8px",
  overflowY: "auto",
  background: "#fafafa",
};

const mainStyle = {
  flex: 1,
  display: "flex",
  flexDirection: "column",
  padding: "8px",
  gap: "8px",
};

const topBarStyle = {
  display: "flex",
  alignItems: "center",
  gap: "8px",
};

const canvasRowStyle = {
  flex: 1,
  display: "flex",
  gap: "8px",
  minHeight: 0,
};

const canvasWrapperStyle = {
  flex: 3,
  position: "relative",
  border: "1px solid #ddd",
  background: "#f7f7f7",
  overflow: "auto",
  borderRadius: "4px",
};

const rightPanelStyle = {
  flex: 2,
  border: "1px solid #ddd",
  borderRadius: "4px",
  padding: "8px",
  display: "flex",
  flexDirection: "column",
  minWidth: "260px",
};

const buttonStyle = (active) => ({
  padding: "4px 10px",
  borderRadius: "4px",
  border: active ? "1px solid #1976d2" : "1px solid #ccc",
  background: active ? "#e3f2fd" : "#fff",
  cursor: "pointer",
  fontSize: 12,
});

const smallButtonStyle = {
  padding: "2px 6px",
  borderRadius: "4px",
  border: "1px solid #ccc",
  background: "#fff",
  cursor: "pointer",
  fontSize: 11,
};

function AnnotationPage() {
  const [imageCases, setImageCases] = useState([]);
  const [loadingCases, setLoadingCases] = useState(false);

  const [selectedCase, setSelectedCase] = useState(null);
  const [imageDetail, setImageDetail] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });

  const [annotations, setAnnotations] = useState([]); // 畫面上的人工標註
  const [mode, setMode] = useState("draw"); // "draw" | "view"

  const [bones, setBones] = useState([]);
  const [smallBones, setSmallBones] = useState([]);

  // 畫框狀態
  const [isDrawing, setIsDrawing] = useState(false);
  const [startPt, setStartPt] = useState(null); // {x,y} px
  const [currentRect, setCurrentRect] = useState(null);

  const [uploading, setUploading] = useState(false);
  const [uploadFileObj, setUploadFileObj] = useState(null);

  const imgRef = useRef(null);

  // 載入 ImageCase 清單
  useEffect(() => {
    const loadCases = async () => {
      setLoadingCases(true);
      try {
        const data = await fetchImageCases();
        setImageCases(data);
      } catch (err) {
        console.error("載入 ImageCase 失敗：", err);
        alert("載入 ImageCase 失敗，請看 console");
      } finally {
        setLoadingCases(false);
      }
    };
    loadCases();
  }, []);

  // 載入骨頭選單
  useEffect(() => {
    const loadBones = async () => {
      try {
        const data = await fetchBoneOptions();
        setBones(data.bones || []);
        setSmallBones(data.small_bones || []);
      } catch (err) {
        console.error("載入骨頭選單失敗：", err);
      }
    };
    loadBones();
  }, []);

  // 選一個 ImageCase
  const handleSelectCase = async (imageCase) => {
    setSelectedCase(imageCase);
    setImageDetail(null);
    setImageSize({ width: 0, height: 0 });
    setAnnotations([]);
    setCurrentRect(null);
    setIsDrawing(false);

    setLoadingDetail(true);
    try {
      const detail = await fetchImageDetail(imageCase.image_case_id);
      setImageDetail(detail);

      // 只抓 source = human_gt 的人工標註
      const humanGt = (detail.annotations || []).filter(
        (a) => a.source === "human_gt"
      );
      setAnnotations(humanGt);
    } catch (err) {
      console.error("載入影像詳細資料失敗：", err);
      alert("載入影像詳細資料失敗，請看 console");
    } finally {
      setLoadingDetail(false);
    }
  };

  // 圖片載入完，拿到目前顯示尺寸
  const handleImageLoad = () => {
    if (imgRef.current) {
      const rect = imgRef.current.getBoundingClientRect();
      setImageSize({
        width: rect.width,
        height: rect.height,
      });
    }
  };

  // [0,1] → px
  const ratioToPx = (bbox) => {
    const { width, height } = imageSize;
    if (!width || !height) return { left: 0, top: 0, width: 0, height: 0 };

    return {
      left: bbox.x_min * width,
      top: bbox.y_min * height,
      width: (bbox.x_max - bbox.x_min) * width,
      height: (bbox.y_max - bbox.y_min) * height,
    };
  };

  // px → [0,1]
  const pxToRatio = (rect) => {
    const { width, height } = imageSize;
    if (!width || !height) {
      return { x_min: 0, y_min: 0, x_max: 0, y_max: 0 };
    }
    const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

    const x1 = clamp(rect.x1, 0, width);
    const y1 = clamp(rect.y1, 0, height);
    const x2 = clamp(rect.x2, 0, width);
    const y2 = clamp(rect.y2, 0, height);

    const xmin = Math.min(x1, x2);
    const xmax = Math.max(x1, x2);
    const ymin = Math.min(y1, y2);
    const ymax = Math.max(y1, y2);

    return {
      x_min: xmin / width,
      y_min: ymin / height,
      x_max: xmax / width,
      y_max: ymax / height,
    };
  };

  // 滑鼠點到圖上的座標（相對於目前顯示的圖片）
  const getRelativePoint = (event) => {
    const img = imgRef.current;
    if (!img) return null;
    const rect = img.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    return { x, y };
  };

  // 開始畫框
  const handleMouseDown = (event) => {
    if (mode !== "draw") return;
    if (!imageDetail || !imageSize.width) return;
    const pt = getRelativePoint(event);
    if (!pt) return;
    setIsDrawing(true);
    setStartPt(pt);
    setCurrentRect({ x1: pt.x, y1: pt.y, x2: pt.x, y2: pt.y });
  };

  // 畫到一半（更新目前框）
  const handleMouseMove = (event) => {
    if (!isDrawing || !startPt || mode !== "draw") return;
    const pt = getRelativePoint(event);
    if (!pt) return;

    setCurrentRect({
      x1: startPt.x,
      y1: startPt.y,
      x2: pt.x,
      y2: pt.y,
    });
  };

  // 結束畫框
  const handleMouseUp = () => {
    if (mode !== "draw") {
      setIsDrawing(false);
      setCurrentRect(null);
      return;
    }

    // 必須有一個有效框
    if (!isDrawing || !startPt || !currentRect) {
      setIsDrawing(false);
      setCurrentRect(null);
      return;
    }

    setIsDrawing(false);

    const dx = Math.abs(currentRect.x2 - currentRect.x1);
    const dy = Math.abs(currentRect.y2 - currentRect.y1);
    if (dx < 5 || dy < 5) {
      // 太小當誤觸
      setCurrentRect(null);
      return;
    }

    const ratioBbox = pxToRatio(currentRect);

    const newAnn = {
      annotation_id: Date.now(), // 前端暫時 id
      source: "human_gt",
      bone_id: null,
      small_bone_id: null,
      x_min: ratioBbox.x_min,
      y_min: ratioBbox.y_min,
      x_max: ratioBbox.x_max,
      y_max: ratioBbox.y_max,
      created_by: "s0_ui",
      created_at: new Date().toISOString(),
    };

    setAnnotations((prev) => [...prev, newAnn]);
    setCurrentRect(null);
  };

  const handleMouseLeave = () => {
    if (isDrawing) {
      setIsDrawing(false);
      setCurrentRect(null);
    }
  };

  // 儲存到後端
  const handleSave = async () => {
    if (!selectedCase) return;
    if (annotations.length === 0) {
      alert("目前沒有標註，不用儲存。");
      return;
    }

    const imageCaseId = selectedCase.image_case_id;
    const payload = annotations.map((a) => ({
      source: "human_gt",
      bone_id: a.bone_id,
      small_bone_id: a.small_bone_id,
      x_min: a.x_min,
      y_min: a.y_min,
      x_max: a.x_max,
      y_max: a.y_max,
      created_by: a.created_by || "s0_ui",
    }));

    try {
      await saveAnnotations(imageCaseId, payload);
      alert("標註已儲存");

      // 重新撈一次，確認跟 DB 一致
      const detail = await fetchImageDetail(imageCaseId);
      const humanGt = (detail.annotations || []).filter(
        (a) => a.source === "human_gt"
      );
      setImageDetail(detail);
      setAnnotations(humanGt);
    } catch (err) {
      console.error("儲存失敗：", err);
      alert("儲存失敗，請看 console");
    }
  };

  // 上傳圖片
  const handleUpload = async () => {
    if (!uploadFileObj) {
      alert("請先選一張圖片");
      return;
    }
    setUploading(true);
    try {
      const result = await uploadImage(uploadFileObj);
      // 新增一筆到 ImageCases 列表最前面
      const newCase = {
        image_case_id: result.image_case_id,
        source: result.source,
        created_at: result.created_at,
        has_annotations: false,
      };
      setImageCases((prev) => [newCase, ...prev]);
      // 自動切換到新圖
      await handleSelectCase(newCase);
      setUploadFileObj(null);
    } catch (err) {
      console.error("上傳失敗：", err);
      alert("上傳失敗，請看 console");
    } finally {
      setUploading(false);
    }
  };

  // 刪除單一標註
  const handleDeleteAnnotation = (annotationId) => {
    setAnnotations((prev) =>
      prev.filter((a) => a.annotation_id !== annotationId)
    );
  };

  // 清空所有標註
  const handleClearAnnotations = () => {
    if (!window.confirm("確定要清除這張圖上所有人工標註嗎？")) return;
    setAnnotations([]);
  };

  // 右側：選骨頭大類
  const handleChangeBone = (annotationId, newBoneId) => {
    setAnnotations((prev) =>
      prev.map((a) => {
        if (a.annotation_id !== annotationId) return a;
        return {
          ...a,
          bone_id: newBoneId ? Number(newBoneId) : null,
          // 換了大類就重置細項
          small_bone_id: null,
        };
      })
    );
  };

  // 右側：選細項骨
  const handleChangeSmallBone = (annotationId, newSmallBoneId) => {
    setAnnotations((prev) =>
      prev.map((a) => {
        if (a.annotation_id !== annotationId) return a;
        return {
          ...a,
          small_bone_id: newSmallBoneId ? Number(newSmallBoneId) : null,
        };
      })
    );
  };

  const filteredSmallBonesFor = (annotation) => {
    if (!annotation.bone_id) {
      return [];
    }
    return smallBones.filter((sb) => sb.bone_id === annotation.bone_id);
  };

  return (
    <div style={panelStyle}>
      {/* 左側列表 */}
      <div style={sidebarStyle}>
        <h3 style={{ marginTop: 0, fontSize: 14 }}>Image Cases</h3>
        {loadingCases && <div>載入中...</div>}
        {!loadingCases && imageCases.length === 0 && (
          <div>目前沒有 ImageCase 資料</div>
        )}
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {imageCases.map((c) => (
            <li
              key={c.image_case_id}
              style={{
                padding: "4px 6px",
                marginBottom: "4px",
                borderRadius: "4px",
                cursor: "pointer",
                backgroundColor:
                  selectedCase &&
                  selectedCase.image_case_id === c.image_case_id
                    ? "#e3f2fd"
                    : "#fff",
                border: c.has_annotations
                  ? "2px solid #4caf50"
                  : "1px solid #ddd",
              }}
              onClick={() => handleSelectCase(c)}
            >
              <div>
                <strong>ID:</strong> {c.image_case_id}
              </div>
              <div>
                <strong>Source:</strong> {c.source}
              </div>
              <div>
                <strong>標註:</strong>{" "}
                {c.has_annotations ? "✅ 有" : "❌ 無"}
              </div>
            </li>
          ))}
        </ul>
      </div>

      {/* 右側主畫面 */}
      <div style={mainStyle}>
        {/* 上方工具列 */}
        <div style={topBarStyle}>
          <h3 style={{ margin: 0, flex: 1 }}>S0 Annotation Tool</h3>
          <div style={{ display: "flex", gap: "4px", alignItems: "center" }}>
            <span>模式：</span>
            <button
              style={buttonStyle(mode === "draw")}
              onClick={() => {
                setMode("draw");
                setIsDrawing(false);
                setCurrentRect(null);
              }}
            >
              畫框
            </button>
            <button
              style={buttonStyle(mode === "view")}
              onClick={() => {
                setMode("view");
                setIsDrawing(false);
                setCurrentRect(null);
              }}
            >
              檢視
            </button>
          </div>

          <div style={{ marginLeft: "16px", display: "flex", gap: "6px" }}>
            <input
              type="file"
              accept="image/png,image/jpeg,image/jpg"
              onChange={(e) => setUploadFileObj(e.target.files[0] || null)}
              style={{ fontSize: 11 }}
            />
            <button
              style={buttonStyle(false)}
              onClick={handleUpload}
              disabled={uploading || !uploadFileObj}
            >
              {uploading ? "上傳中..." : "上傳圖片"}
            </button>
          </div>

          <div style={{ marginLeft: "auto", fontSize: 12, color: "#555" }}>
            人工標註數：<strong>{annotations.length}</strong>{" "}
            <button
              style={{ ...smallButtonStyle, marginLeft: 6 }}
              onClick={handleClearAnnotations}
              disabled={annotations.length === 0}
            >
              清除全部
            </button>
            <button
              style={{ ...smallButtonStyle, marginLeft: 6 }}
              onClick={handleSave}
              disabled={!selectedCase || annotations.length === 0}
            >
              儲存標註
            </button>
          </div>
        </div>

        {/* 中間：圖片 + 右側標註列表 */}
        <div style={canvasRowStyle}>
          {/* 影像區 */}
          <div style={canvasWrapperStyle}>
            {loadingDetail && <div style={{ padding: 8 }}>載入影像中...</div>}

            {!loadingDetail && imageDetail && imageDetail.image_url && (
              <div
                style={{
                  position: "relative",
                  display: "inline-block",
                }}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseLeave}
              >
                <img
                  ref={imgRef}
                  src={imageDetail.image_url}
                  alt="bone"
                  onLoad={handleImageLoad}
                  style={{ display: "block", maxWidth: "100%" }}
                />

                {/* YOLO 偵測框（紅） */}
                {imageSize.width > 0 &&
                  (imageDetail.detections || []).map((d) => {
                    const rect = ratioToPx(d);
                    return (
                      <div
                        key={`det-${d.detection_id}`}
                        style={{
                          position: "absolute",
                          left: rect.left,
                          top: rect.top,
                          width: rect.width,
                          height: rect.height,
                          border: "2px solid rgba(255,0,0,0.8)",
                          boxSizing: "border-box",
                          pointerEvents: "none",
                        }}
                        title={`YOLO det #${d.detection_id}`}
                      />
                    );
                  })}

                {/* 人工標註框（綠） */}
                {imageSize.width > 0 &&
                  annotations.map((a) => {
                    const rect = ratioToPx(a);
                    return (
                      <div
                        key={`ann-${a.annotation_id}`}
                        style={{
                          position: "absolute",
                          left: rect.left,
                          top: rect.top,
                          width: rect.width,
                          height: rect.height,
                          border: "2px solid rgba(0,200,0,0.95)",
                          boxSizing: "border-box",
                          pointerEvents: "none",
                        }}
                        title={`BoneId=${a.bone_id || "-"}, SmallBoneId=${
                          a.small_bone_id || "-"
                        }`}
                      />
                    );
                  })}

                {/* 正在畫的框（藍色虛線） */}
                {imageSize.width > 0 && currentRect && (
                  <div
                    style={{
                      position: "absolute",
                      left: Math.min(currentRect.x1, currentRect.x2),
                      top: Math.min(currentRect.y1, currentRect.y2),
                      width: Math.abs(currentRect.x2 - currentRect.x1),
                      height: Math.abs(currentRect.y2 - currentRect.y1),
                      border: "2px dashed rgba(0,0,255,0.9)",
                      boxSizing: "border-box",
                      pointerEvents: "none",
                    }}
                  />
                )}
              </div>
            )}

            {!loadingDetail && (!imageDetail || !imageDetail.image_url) && (
              <div style={{ padding: 8, color: "#777" }}>
                {selectedCase
                  ? "這個 ImageCase 沒有 image_url，可以檢查 Bone_Images.image_path。"
                  : "請先在左側選一個 ImageCase，或上傳新圖片。"}
              </div>
            )}
          </div>

          {/* 右側標註列表 */}
          <div style={rightPanelStyle}>
            <div
              style={{
                marginBottom: 6,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <strong>標註列表</strong>
            </div>

            <div
              style={{
                flex: 1,
                overflowY: "auto",
                borderTop: "1px solid #eee",
                paddingTop: 4,
              }}
            >
              {annotations.length === 0 && (
                <div style={{ color: "#777" }}>目前尚未新增人工標註。</div>
              )}

              {annotations.map((a, idx) => {
                const sbOptions = filteredSmallBonesFor(a);
                return (
                  <div
                    key={a.annotation_id}
                    style={{
                      border: "1px solid #ddd",
                      borderRadius: "4px",
                      padding: "4px",
                      marginBottom: "4px",
                      background: "#fff",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        marginBottom: 4,
                      }}
                    >
                      <span>
                        #{idx + 1}{" "}
                        <span style={{ color: "#999" }}>
                          ({a.x_min.toFixed(3)}, {a.y_min.toFixed(3)}) - (
                          {a.x_max.toFixed(3)}, {a.y_max.toFixed(3)})
                        </span>
                      </span>
                      <button
                        style={smallButtonStyle}
                        onClick={() => handleDeleteAnnotation(a.annotation_id)}
                      >
                        刪除
                      </button>
                    </div>

                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: "4px",
                      }}
                    >
                      <label>
                        大類骨：
                        <select
                          value={a.bone_id || ""}
                          onChange={(e) =>
                            handleChangeBone(a.annotation_id, e.target.value)
                          }
                          style={{ marginLeft: 4 }}
                        >
                          <option value="">未指定</option>
                          {bones.map((b) => (
                            <option key={b.bone_id} value={b.bone_id}>
                              {b.bone_zh} ({b.bone_en})
                            </option>
                          ))}
                        </select>
                      </label>

                      <label>
                        細項骨：
                        <select
                          value={a.small_bone_id || ""}
                          onChange={(e) =>
                            handleChangeSmallBone(
                              a.annotation_id,
                              e.target.value
                            )
                          }
                          style={{ marginLeft: 4 }}
                          disabled={!a.bone_id}
                        >
                          <option value="">未指定</option>
                          {sbOptions.map((sb) => (
                            <option
                              key={sb.small_bone_id}
                              value={sb.small_bone_id}
                            >
                              {sb.small_bone_zh} ({sb.small_bone_en})
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default AnnotationPage;
