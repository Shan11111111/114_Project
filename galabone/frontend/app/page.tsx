"use client";

import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-50 flex flex-col">
      {/* Top Nav */}
     

      {/* Hero Section */}
      <section className="flex-1 flex flex-col lg:flex-row items-center justify-center gap-10 px-8">
        <div className="max-w-xl space-y-5">
          <h1 className="text-3xl lg:text-4xl font-bold leading-tight">
            讓骨科影像
            <span className="text-cyan-400"> 更直覺、好理解</span>
          </h1>
          <p className="text-slate-300 text-sm lg:text-base">
            GalaBone 結合 YOLOv8-OBB 與多模態 AI，
            幫助你在 X 光中快速找出骨骼、理解位置與臨床意義，
            未來也會支援互動式教學與自動化教材生成。
          </p>

          <div className="flex flex-wrap gap-3">
            <Link
              href="/bonevision"
              className="px-5 py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-sm font-semibold shadow-[0_0_25px_rgba(34,211,238,0.8)] transition"
            >
              進入骨骼辨識頁面
            </Link>
            <button className="px-4 py-2.5 rounded-xl border border-slate-700 hover:border-cyan-400/70 text-slate-200 text-sm transition">
              了解 GalaBone 概念
            </button>
          </div>

          <div className="text-xs text-slate-500">
            前端：Next.js + Tailwind CSS．後端：FastAPI + YOLOv8-OBB（稍後串接）
          </div>
        </div>

        {/* 右側示意卡片 */}
        <div className="w-full max-w-sm">
          <div className="relative rounded-3xl border border-slate-800 bg-slate-900/70 p-4 overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/10 via-slate-900 to-slate-950 pointer-events-none" />
            <div className="relative">
              <p className="text-xs text-slate-400 mb-2">預覽 · BoneVision</p>
              <div className="aspect-[3/4] rounded-2xl border border-slate-800 bg-slate-950 flex items-center justify-center">
                <span className="text-[11px] text-slate-500">
                  之後會在這裡顯示 X 光與偵測框
                </span>
              </div>
              <p className="mt-3 text-[11px] text-slate-400">
                在 /bonevision 頁面中，你將可以上傳 X 光影像，並查看骨骼偵測結果與說明。
              </p>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
