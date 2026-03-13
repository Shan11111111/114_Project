"use client";

import React from "react";

type Props = {
  checked: boolean;
  onChange: (checked: boolean) => void;
};

export default function S2PrivacyConsent({ checked, onChange }: Props) {
  return (
    <div
      className="rounded-2xl border px-4 py-3 text-[13px] leading-6"
      style={{
        borderColor: "rgba(148,163,184,0.20)",
        backgroundColor: "rgba(148,163,184,0.06)",
        color: "var(--foreground)",
      }}
    >
      <label className="flex items-start gap-3 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="mt-1"
        />
        <span>
          我同意不做個人資料與隱私上傳、不輸入姓名/病歷號/生日/電話/地址/可識別資訊。
        </span>
      </label>
    </div>
  );
}