// src/pages/S0AnnotationPage.tsx
import {
  useEffect,
  useState,
  useRef,
  MouseEvent,
} from "react";
import {
  fetchBigBones,
  fetchSmallBones,
  saveAnnotations,
  loadAnnotations,
  BigBone,
  SmallBone,
  BBoxPayload,
  AnnotationResponse,
} from "../api/s0";

interface S0AnnotationPageProps {
  imageCaseId: number;
  imageUrl: string;
}

// 用來顯示 bbox 的型別（儲存為 0~1 的相對座標）
interface BoxView {
  id: string;
  boneId?: number | null;
  smallBoneId?: number | null;
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
}

export default function S0AnnotationPage({
  imageCaseId,
  imageUrl,
}: S0AnnotationPageProps) {
  const [bigBones, setBigBones] = useState<BigBone[]>([]);
  const [smallBones, setSmallBones] = useState<SmallBone[]>([]);
  const [selectedBoneId, setSelectedBoneId] = useState<number | null>(null);
  const [selectedSmallBoneId, setSelectedSmallBoneId] = useState<number | null>(null);

  const [boxes, setBoxes] = useState<BoxView[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [activeBoxId, setActiveBoxId] = useState<string | null>(null);

  // 畫框相關狀態
  const imgContainerRef = useRef<HTMLDivElement | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [startX, setStartX] = useState(0);
  const [startY, setStartY] = useState(0);
  const [currentX, setCurrentX] = useState(0);
  const [currentY, setCurrentY] = useState(0);

  useEffect(() => {
    async function init() {
      try {
        const [bigList, existing] = await Promise.all([
          fetchBigBones(),
          loadAnnotations(imageCaseId),
        ]);
        setBigBones(bigList);
        setBoxes(existing.map(mapAnnotationToBoxView));
      } catch (err) {
        console.error(err);
        alert("載入骨頭或既有標註失敗，請檢查後端或網路");
      }
    }
    init();
  }, [imageCaseId]);

  useEffect(() => {
    if (selectedBoneId == null) {
      setSmallBones([]);
      setSelectedSmallBoneId(null);
      return;
    }
    async function loadSmall() {
      try {
        const list = await fetchSmallBones(selectedBoneId);
        setSmallBones(list);
        setSelectedSmallBoneId(null);
      } catch (err) {
        console.error(err);
        alert("載入小骨列表失敗");
      }
    }
    loadSmall();
  }, [selectedBoneId]);

  function mapAnnotationToBoxView(a: AnnotationResponse): BoxView {
    return {
      id: String(a.annotationId),
      boneId: a.boneId ?? null,
      smallBoneId: a.smallBoneId ?? null,
      xMin: a.x_min,
      yMin: a.y_min,
      xMax: a.x_max,
      yMax: a.y_max,
    };
  }

  function makeBoxId() {
    return `box-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function findBigBoneName(boneId?: number | null) {
    if (!boneId) return "";
    const b = bigBones.find((x) => x.boneId === boneId);
    return b ? b.nameZh : "";
  }

  function findSmallBoneName(smallBoneId?: number | null) {
    if (!smallBoneId) return "";
    const s = smallBones.find((x) => x.smallBoneId === smallBoneId);
    return s ? s.nameZh : "";
  }

  function handleMouseDown(e: MouseEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    if (!imgContainerRef.current) return;
    const rect = imgContainerRef.current.getBoundingClientRect();
    setIsDrawing(true);
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    setStartX(x);
    setStartY(y);
    setCurrentX(x);
    setCurrentY(y);
  }

  function handleMouseMove(e: MouseEvent<HTMLDivElement>) {
    if (!isDrawing || !imgContainerRef.current) return;
    const rect = imgContainerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    setCurrentX(x);
    setCurrentY(y);
  }

  function handleMouseUp() {
    if (!isDrawing || !imgContainerRef.current) return;
    setIsDrawing(false);

    const rect = imgContainerRef.current.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;

    const x1 = Math.max(0, Math.min(startX, currentX));
    const x2 = Math.min(width, Math.max(startX, currentX));
    const y1 = Math.max(0, Math.min(startY, currentY));
    const y2 = Math.min(height, Math.max(startY, currentY));

    const w = x2 - x1;
    const h = y2 - y1;
    if (w < 5 || h < 5) return;

    const xMin = x1 / width;
    const yMin = y1 / height;
    const xMax = x2 / width;
    const yMax = y2 / height;

    const newBox: BoxView = {
      id: makeBoxId(),
      boneId: selectedBoneId ?? null,
      smallBoneId: selectedSmallBoneId ?? null,
      xMin,
      yMin,
      xMax,
      yMax,
    };

    if (!newBox.boneId && !newBox.smallBoneId) {
      alert("請先選擇大類或小類再畫框");
      return;
    }

    setBoxes((prev) => [...prev, newBox]);
  }

  function handleDeleteBox(id: string) {
    setBoxes((prev) => prev.filter((b) => b.id !== id));
    if (activeBoxId === id) setActiveBoxId(null);
  }

  async function handleSave() {
    if (boxes.length === 0) {
      alert("沒有框可以儲存");
      return;
    }
    const invalid = boxes.find(
      (b) => !b.boneId && !b.smallBoneId,
    );
    if (invalid) {
      alert("有框沒有骨頭資訊（boneId / smallBoneId），請刪除或補齊");
      return;
    }

    const payload: BBoxPayload[] = boxes.map((b) => ({
      boneId: b.boneId ?? null,
      smallBoneId: b.smallBoneId ?? null,
      x_min: b.xMin,
      y_min: b.yMin,
      x_max: b.xMax,
      y_max: b.yMax,
    }));

    try {
      setIsSaving(true);
      await saveAnnotations(imageCaseId, payload);
      alert("儲存成功");
    } catch (err) {
      console.error(err);
      alert("儲存失敗，請看 console log");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div style={{ display: "flex", gap: 16, padding: 16 }}>
      {/* 左側：控制面板 */}
      <div style={{ width: 280, display: "flex", flexDirection: "column", gap: 12 }}>
        <h2>S0 標註工具</h2>

        <div>
          <label>大骨（Bone_Info）</label>
          <select
            style={{ width: "100%", padding: 4 }}
            value={selectedBoneId ?? ""}
            onChange={(e) => {
              const v = e.target.value;
              setSelectedBoneId(v ? Number(v) : null);
            }}
          >
            <option value="">-- 請選擇 --</option>
            {bigBones.map((b) => (
              <option key={b.boneId} value={b.boneId}>
                {b.region ? `[${b.region}] ` : ""}
                {b.nameZh} ({b.nameEn})
              </option>
            ))}
          </select>
        </div>

        <div>
          <label>小骨（bone.Bone_small，可選）</label>
          <select
            style={{ width: "100%", padding: 4 }}
            value={selectedSmallBoneId ?? ""}
            onChange={(e) => {
              const v = e.target.value;
              setSelectedSmallBoneId(v ? Number(v) : null);
            }}
            disabled={smallBones.length === 0}
          >
            <option value="">-- 不選小骨 --</option>
            {smallBones.map((s) => (
              <option key={s.smallBoneId} value={s.smallBoneId}>
                {s.serialNumber ? `${s.serialNumber}. ` : ""}
                {s.nameZh} ({s.nameEn})
              </option>
            ))}
          </select>
        </div>

        <button
          onClick={handleSave}
          disabled={isSaving}
          style={{
            padding: "8px 12px",
            marginTop: 8,
            cursor: isSaving ? "not-allowed" : "pointer",
          }}
        >
          {isSaving ? "儲存中..." : "儲存目前所有框"}
        </button>

        <hr />

        <div>
          <h3>目前框列表</h3>
          {boxes.length === 0 && <p style={{ fontSize: 12 }}>尚未新增任何框</p>}
          <ul style={{ listStyle: "none", padding: 0, maxHeight: 260, overflowY: "auto" }}>
            {boxes.map((b, idx) => (
              <li
                key={b.id}
                onClick={() => setActiveBoxId(b.id)}
                style={{
                  padding: 6,
                  marginBottom: 4,
                  borderRadius: 4,
                  border: b.id === activeBoxId ? "2px solid #007bff" : "1px solid #ccc",
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                <div>
                  #{idx + 1}{" "}
                  {findBigBoneName(b.boneId) ||
                    (b.boneId ? `BoneId=${b.boneId}` : "未選大類")}
                  {" / "}
                  {findSmallBoneName(b.smallBoneId) ||
                    (b.smallBoneId ? `SmallBoneId=${b.smallBoneId}` : "未選小類")}
                </div>
                <div style={{ opacity: 0.7 }}>
                  x: {b.xMin.toFixed(2)}~{b.xMax.toFixed(2)}, y:{" "}
                  {b.yMin.toFixed(2)}~{b.yMax.toFixed(2)}
                </div>
                <button
                  style={{
                    marginTop: 4,
                    padding: "2px 6px",
                    fontSize: 11,
                  }}
                  onClick={(ev) => {
                    ev.stopPropagation();
                    handleDeleteBox(b.id);
                  }}
                >
                  刪除
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* 右側：影像 + bbox 畫布 */}
      <div style={{ flex: 1 }}>
        <div
          ref={imgContainerRef}
          style={{
            position: "relative",
            width: "100%",
            paddingTop: "60%",
            backgroundColor: "#222",
            backgroundImage: `url(${imageUrl})`,
            backgroundSize: "contain",
            backgroundRepeat: "no-repeat",
            backgroundPosition: "center",
            overflow: "hidden",
            cursor: "crosshair",
          }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
        >
          {boxes.map((b) => {
            const left = b.xMin * 100;
            const top = b.yMin * 100;
            const width = (b.xMax - b.xMin) * 100;
            const height = (b.yMax - b.yMin) * 100;
            return (
              <div
                key={b.id}
                style={{
                  position: "absolute",
                  left: `${left}%`,
                  top: `${top}%`,
                  width: `${width}%`,
                  height: `${height}%`,
                  border: b.id === activeBoxId ? "2px solid #00ff00" : "2px solid #ff0000",
                  boxSizing: "border-box",
                  pointerEvents: "none",
                }}
              />
            );
          })}

          {isDrawing && imgContainerRef.current && (
            <div
              style={{
                position: "absolute",
                left: `${(Math.min(startX, currentX) /
                  imgContainerRef.current.getBoundingClientRect().width) *
                  100}%`,
                top: `${(Math.min(startY, currentY) /
                  imgContainerRef.current.getBoundingClientRect().height) *
                  100}%`,
                width: `${(Math.abs(currentX - startX) /
                  imgContainerRef.current.getBoundingClientRect().width) *
                  100}%`,
                height: `${(Math.abs(currentY - startY) /
                  imgContainerRef.current.getBoundingClientRect().height) *
                  100}%`,
                border: "1px dashed #00ffff",
                boxSizing: "border-box",
                pointerEvents: "none",
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
