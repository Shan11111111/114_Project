"use client";

import React from "react";
import type { SensitiveHit } from "./piiGuard";

type Props = {
  open: boolean;
  hits: SensitiveHit[];
  onClose: () => void;
  onMaskAndSend: () => void;
};

export default function S2SensitiveInfoModal({
  open,
  hits,
  onClose,
  onMaskAndSend,
}: Props) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/45"
        onClick={onClose}
      />
      <div
        className="relative w-full max-w-xl rounded-2xl border p-5 shadow-2xl"
        style={{
          backgroundColor: "var(--background)",
          borderColor: "rgba(148,163,184,0.20)",
          color: "var(--foreground)",
        }}
      >
        <div className="text-lg font-semibold mb-2">偵測到可能的敏感資訊</div>
        <p className="text-sm opacity-80 leading-6 mb-4">
          為避免個資送入系統，已先暫停送出。你可以返回修改，或讓系統自動遮罩後再送出。
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

        <div className="mt-5 flex items-center justify-end gap-3">
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