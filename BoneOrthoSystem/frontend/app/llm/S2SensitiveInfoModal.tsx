"use client";

import React from "react";
import type { SensitiveHit } from "./piiGuard";

type Props = {
  open: boolean;
  hits: SensitiveHit[];
  onClose: () => void;
  onSendWithoutMask: () => void;
  onMaskAndSend: () => void;
};

export default function S2SensitiveInfoModal({
  open,
  hits,
  onClose,
  onSendWithoutMask,
  onMaskAndSend,
}: Props) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/45" onClick={onClose} />

      <div
        className="relative w-full max-w-2xl rounded-2xl border p-5 shadow-2xl"
        style={{
          backgroundColor: "var(--background)",
          borderColor: "rgba(148,163,184,0.20)",
          color: "var(--foreground)",
        }}
      >
        <div className="text-lg font-semibold mb-2">偵測到可能的敏感資訊</div>

        <p className="text-sm opacity-80 leading-6 mb-4">
          系統偵測到你輸入的內容中，可能包含你設定需要辨識的個人資料或可識別資訊。
          你可以返回修改、直接送出原文，或依系統設定先自動遮罩後再送出。
        </p>

        <div
          className="rounded-xl border p-3 max-h-56 overflow-y-auto text-sm"
          style={{
            borderColor: "rgba(148,163,184,0.20)",
            backgroundColor: "rgba(148,163,184,0.06)",
          }}
        >
          {hits.length === 0 ? (
            <div className="opacity-70">未列出可疑項目</div>
          ) : (
            <ul className="space-y-2">
              {hits.map((hit, idx) => (
                <li key={`${hit.type}-${idx}`} className="break-all">
                  <span className="font-semibold">{hit.label}</span>
                  <span className="opacity-70">：</span>
                  <span>{hit.value}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div
          className="mt-4 rounded-xl border p-3 text-xs leading-6"
          style={{
            borderColor: "rgba(250,204,21,0.28)",
            backgroundColor: "rgba(250,204,21,0.08)",
          }}
        >
          <div className="font-semibold mb-1">法律免責與風險告知</div>
          <div>
            系統已偵測到您輸入的內容中可能包含個人資料或可識別資訊。<br />
            為降低隱私與法律風險，建議先進行遮罩後再送出。
          </div>
          <div className="mt-2">
            本系統僅提供教學、研究與資訊輔助用途，並非醫療診斷、法律審查或正式合規判定工具。<br />
            若您選擇送出未遮罩之內容，應自行確認已取得合法授權，並自行承擔相關法律責任。
          </div>
          <div className="mt-2">
            系統提供之自動遮罩功能屬輔助性措施，無法保證完全去識別化；
            您仍應自行確認資料內容是否適合送出。
          </div>
          <div className="mt-2">
            若您選擇「不遮罩直接送出」，即表示您已了解相關風險，並同意自行承擔送出內容所衍生之責任。
          </div>
        </div>

        <div className="mt-5 flex items-center justify-end gap-3 flex-wrap">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl border text-sm"
            style={{ borderColor: "rgba(148,163,184,0.25)" }}
          >
            返回修改
          </button>

          <button
            type="button"
            onClick={onSendWithoutMask}
            className="px-4 py-2 rounded-xl border text-sm"
            style={{
              borderColor: "rgba(239,68,68,0.30)",
              backgroundColor: "rgba(239,68,68,0.08)",
              color: "var(--foreground)",
            }}
          >
            不遮罩直接送出
          </button>

          <button
            type="button"
            onClick={onMaskAndSend}
            className="px-4 py-2 rounded-xl text-sm text-white"
            style={{
              background: "linear-gradient(135deg,#0ea5e9,#22c55e)",
              boxShadow: "0 10px 25px rgba(56,189,248,0.30)",
            }}
          >
            自動遮罩後送出
          </button>
        </div>
      </div>
    </div>
  );
}