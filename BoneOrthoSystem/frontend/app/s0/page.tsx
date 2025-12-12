"use client";

import { useEffect, useState } from "react";
import { s0Api } from "../../lib/s0Api";

type Bone = {
  boneId: number;
  boneZh: string;
  boneEn: string;
};

type SmallBone = {
  smallBoneId: number;
  smallBoneZh: string;
  smallBoneEn: string;
};

export default function S0Page() {
  const [bigBones, setBigBones] = useState<Bone[]>([]);
  const [smallBones, setSmallBones] = useState<SmallBone[]>([]);
  const [selectedBoneId, setSelectedBoneId] = useState<number | null>(null);
  const [caseId, setCaseId] = useState<number | null>(null);
  const [status, setStatus] = useState<string>("");

  // 開頁就抓 41 大骨
  useEffect(() => {
    s0Api
      .getBigBones()
      .then(setBigBones)
      .catch((err) => setStatus(`getBigBones error: ${err.message}`));
  }, []);

  const handleBoneChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = Number(e.target.value);
    setSelectedBoneId(id || null);

    if (!id) {
      setSmallBones([]);
      return;
    }

    try {
      const data = await s0Api.getSmallBones(id);
      setSmallBones(data);
    } catch (err: any) {
      setStatus(`getSmallBones error: ${err.message}`);
    }
  };

  const handleTestSave = async () => {
    if (!caseId) {
      setStatus("請先填 caseId（先打通 API 就好）");
      return;
    }
    try {
      await s0Api.saveAnnotations({
        imageCaseId: caseId,
        boxes: [
          {
            boneId: selectedBoneId,
            smallBoneId: smallBones[0]?.smallBoneId ?? null,
            x_min: 100,
            y_min: 100,
            x_max: 300,
            y_max: 300,
          },
        ],
      });
      setStatus("✅ 假資料已送到 /s0/annotations/save");
    } catch (err: any) {
      setStatus(`saveAnnotations error: ${err.message}`);
    }
  };

  return (
    <main style={{ padding: 24 }}>
      <h1>S0 標註工具（測試版）</h1>

      <section style={{ marginBottom: 16 }}>
        <label>
          CaseId（先手動填，確認 API 通不通）：
          <input
            type="number"
            value={caseId ?? ""}
            onChange={(e) =>
              setCaseId(e.target.value ? Number(e.target.value) : null)
            }
            style={{ marginLeft: 8 }}
          />
        </label>
      </section>

      <section style={{ marginBottom: 16 }}>
        <div>選大骨：</div>
        <select onChange={handleBoneChange} defaultValue="">
          <option value="">請選擇骨頭</option>
          {bigBones.map((b) => (
            <option key={b.boneId} value={b.boneId}>
              {b.boneZh} / {b.boneEn}
            </option>
          ))}
        </select>
      </section>

      {smallBones.length > 0 && (
        <section style={{ marginBottom: 16 }}>
          <div>對應的小骨（示意顯示）：</div>
          <ul>
            {smallBones.map((s) => (
              <li key={s.smallBoneId}>
                {s.smallBoneZh} / {s.smallBoneEn}
              </li>
            ))}
          </ul>
        </section>
      )}

      <button onClick={handleTestSave}>送一筆測試標註到後端</button>

      {status && (
        <p style={{ marginTop: 16, whiteSpace: "pre-wrap" }}>{status}</p>
      )}
    </main>
  );
}
