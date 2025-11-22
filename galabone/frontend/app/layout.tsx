import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

// ⭐ 新增：匯入 Navbar
import Navbar from "./components/Navbar";

// ⭐ 字體設定
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "GalaBone",
  description: "Bone AI platform",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // ⭐⭐ 最重要：預設深色，SSR 一開始就帶 dark，避免閃白
    <html lang="en" className="dark">
      <head>
        <link
          rel="stylesheet"
          href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css"
        />
      </head>

      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {/* ⭐ Navbar（全站統一） */}
        <Navbar />

        {/* ⭐ 主內容 */}
        <main>{children}</main>
      </body>
    </html>
  );
}
