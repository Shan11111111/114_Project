"use client";

import React, { useMemo, useState } from "react";

export type BoneListItem = {
  key: string;
  category: "頭顱骨" | "上肢" | "下肢" | "其他";
  zh: string;
  en: string;
  left: null | { smallBoneId: number; meshName: string };
  right: null | { smallBoneId: number; meshName: string };
  single: null | { smallBoneId: number; meshName: string };
};

type Props = {
  items: BoneListItem[];
  onSelectMesh: (meshName: string, smallBoneId: number) => void;
};

const CAT_ORDER: Array<BoneListItem["category"]> = ["頭顱骨", "上肢", "下肢", "其他"];

export default function BoneListPanel({ items, onSelectMesh }: Props) {
  const [query, setQuery] = useState("");
  const [openCats, setOpenCats] = useState<Record<string, boolean>>({
    頭顱骨: true,
    上肢: true,
    下肢: true,
    其他: true,
  });

  const anyExpanded = useMemo(() => Object.values(openCats).some(Boolean), [openCats]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((x) => {
      const hay = `${x.zh} ${x.en} ${x.left?.meshName ?? ""} ${x.right?.meshName ?? ""} ${x.single?.meshName ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [items, query]);

  const grouped = useMemo(() => {
    const g: Record<string, BoneListItem[]> = { 頭顱骨: [], 上肢: [], 下肢: [], 其他: [] };
    for (const it of filtered) g[it.category].push(it);
    return g;
  }, [filtered]);

  const toggleAll = () => {
    // ✅ 一顆按鈕：有任何展開 → 全收起；全部收起 → 全展開
    const next = !anyExpanded;
    setOpenCats({ 頭顱骨: next, 上肢: next, 下肢: next, 其他: next });
  };

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <div style={{ fontSize: 20, fontWeight: 700 }}>骨頭清單</div>
        <button
          onClick={toggleAll}
          style={{
            padding: "10px 14px",
            borderRadius: 16,
            border: "1px solid rgba(255,255,255,0.25)",
            background: "transparent",
            color: "white",
            cursor: "pointer",
            fontWeight: 700,
          }}
        >
          {anyExpanded ? "一鍵收起" : "一鍵展開"}
        </button>
      </div>

      <div style={{ marginTop: 12 }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜尋：C1 / Rib10 / Metatarsal / Middle..."
          style={{
            width: "100%",
            padding: "12px 14px",
            borderRadius: 16,
            border: "1px solid rgba(255,255,255,0.15)",
            background: "rgba(255,255,255,0.04)",
            color: "white",
            outline: "none",
          }}
        />
      </div>

      <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 12 }}>
        {CAT_ORDER.map((cat) => {
          const list = grouped[cat] || [];
          const open = !!openCats[cat];

          return (
            <div key={cat} style={{ borderRadius: 18, overflow: "hidden", border: "1px solid rgba(255,255,255,0.12)" }}>
              <button
                onClick={() => setOpenCats((p) => ({ ...p, [cat]: !p[cat] }))}
                style={{
                  width: "100%",
                  padding: "14px 14px",
                  background: "rgba(255,255,255,0.04)",
                  border: "none",
                  color: "white",
                  cursor: "pointer",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  fontSize: 18,
                  fontWeight: 800,
                }}
              >
                <span>{cat}</span>
                <span style={{ opacity: 0.8, fontSize: 14 }}>{list.length}</span>
              </button>

              {open && (
                <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 12 }}>
                  {list.map((it) => (
                    <div
                      key={it.key}
                      style={{
                        borderRadius: 18,
                        padding: 14,
                        background: "rgba(255,255,255,0.03)",
                        border: "1px solid rgba(255,255,255,0.10)",
                      }}
                    >
                      <div style={{ fontSize: 18, fontWeight: 900 }}>{it.zh || "(未命名)"}</div>
                      <div style={{ opacity: 0.85, marginTop: 4 }}>{it.en || ""}</div>

                      <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                        {/* ✅ 有左右就顯示 L/R；沒有就只顯示 選取 */}
                        {it.left && (
                          <button
                            onClick={() => onSelectMesh(it.left!.meshName, it.left!.smallBoneId)}
                            style={sideBtnStyle}
                          >
                            L
                          </button>
                        )}
                        {it.right && (
                          <button
                            onClick={() => onSelectMesh(it.right!.meshName, it.right!.smallBoneId)}
                            style={sideBtnStyle}
                          >
                            R
                          </button>
                        )}

                        {(!it.left && !it.right) && it.single && (
                          <button
                            onClick={() => onSelectMesh(it.single!.meshName, it.single!.smallBoneId)}
                            style={pickBtnStyle}
                          >
                            選取
                          </button>
                        )}
                      </div>

                      <div style={{ marginTop: 10, opacity: 0.75, fontSize: 13, lineHeight: 1.4 }}>
                        {it.left && <div>L: {it.left.meshName}</div>}
                        {it.right && <div>R: {it.right.meshName}</div>}
                        {it.single && <div>C: {it.single.meshName}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const sideBtnStyle: React.CSSProperties = {
  width: 44,
  height: 44,
  borderRadius: 14,
  border: "1px solid rgba(255,255,255,0.25)",
  background: "transparent",
  color: "white",
  cursor: "pointer",
  fontWeight: 900,
  fontSize: 16,
};

const pickBtnStyle: React.CSSProperties = {
  height: 44,
  padding: "0 14px",
  borderRadius: 14,
  border: "1px solid rgba(255,255,255,0.25)",
  background: "transparent",
  color: "white",
  cursor: "pointer",
  fontWeight: 900,
  fontSize: 16,
};
