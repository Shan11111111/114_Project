"use client";

import Link from "next/link";

export default function Home() {
  return (
    <main
      className="min-h-screen flex flex-col transition-colors duration-300"
      style={{
        backgroundColor: "var(--background)",
        color: "var(--foreground)",
      }}
    >
      {/* Hero Section */}
      <section className="flex-1 flex flex-col lg:flex-row items-center justify-center gap-10 px-8">
        <div className="max-w-xl space-y-5">
          <h1 className="text-3xl lg:text-4xl font-bold leading-tight">
            讓骨科資訊
            <span className="text-cyan-400"> 更直覺、好理解</span>
          </h1>

          <p className="text-slate-300 text-sm lg:text-base">
           GalaBone整合 YOLO 與多模態 AI，
           快速在 X 光中定位骨骼並生成資料庫導向的解說，
           搭配互動標註與 3D 模型展示，讓判讀與教學一站完成。
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
           
          </div>
        </div>

        {/* 右側示意卡片 */}
        <div className="w-full max-w-sm">
          <div
            className="relative rounded-3xl p-4 overflow-hidden transition-colors duration-300"
            style={{
              backgroundColor: "var(--card-bg)",
              border: "1px solid var(--card-border)",
            }}
          >
            {/* 上面淡淡漸層（也吃變數顏色） */}
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                background:
                  "linear-gradient(135deg, rgba(56,189,248,0.10), transparent 40%, var(--card-bg))",
              }}
            />

            <div className="relative">
              <p
                className="text-xs mb-2"
                style={{ color: "var(--text-medium)" }}
              >
                預覽 · BoneVision
              </p>

              <div
                className="aspect-[3/4] rounded-2xl flex items-center justify-center transition-colors duration-300"
                style={{
                  backgroundColor: "var(--card-inner-bg)",
                  border: "1px solid var(--card-border)",
                }}
              >
                <span
                  className="text-[11px]"
                  style={{ color: "var(--text-weak)" }}
                >
                  之後會在這裡顯示 X 光與偵測框
                </span>
              </div>

              <p
                className="mt-3 text-[11px]"
                style={{ color: "var(--text-weak)" }}
              >
                在 /bonevision 頁面中，你將可以上傳 X 光影像，並查看骨骼偵測結果與說明。
              </p>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
