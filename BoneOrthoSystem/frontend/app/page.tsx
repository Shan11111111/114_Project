"use client";

import Link from "next/link";
import "./home.css";
import HomeBoneModel from "./components/HomeBoneModel";
import { useLocale } from "./context/LocaleContext";

const boneBaby = "/bonebao/pab";

const featureSections = [
  {
    href: "/model",
    img: "/Bone_baby_2.webp",
    tagZh: "STEP 01",
    tagEn: "STEP 01",
    titleZh: "從 3D 模型建立骨骼空間感",
    titleEn: "Build spatial understanding with 3D models",
    descZh: "透過旋轉、縮放與互動觀察，先用最直覺的方式認識人體骨骼結構。",
    descEn: "Rotate, zoom, and explore bones interactively before moving into advanced learning.",
  },
  {
    href: "/llm",
    img: "/Bone_baby_4.webp",
    tagZh: "STEP 02",
    tagEn: "STEP 02",
    titleZh: "遇到問題，直接問知識小罐頭",
    titleEn: "Ask BoneBaby whenever questions appear",
    descZh: "用聊天方式理解骨骼知識，讓學習不只是看資料，而是有人陪你一步一步弄懂。",
    descEn: "Learn through conversation with an AI assistant that explains bone knowledge clearly.",
  },
  {
    href: "/bonevision",
    img: "/Bone_baby_9.webp",
    tagZh: "STEP 03",
    tagEn: "STEP 03",
    titleZh: "進階挑戰 X 光骨骼辨識",
    titleEn: "Challenge yourself with X-ray recognition",
    descZh: "上傳 X 光影像，辨識骨骼位置，將前面學到的知識應用到影像判讀中。",
    descEn: "Upload X-ray images and apply what you learned to visual recognition tasks.",
  },
];

export default function Home() {
  const { locale } = useLocale();
  const isEn = locale === "en-US";

  const text = {
    desc: isEn
      ? "Explore bones through 3D models, X-ray recognition, and an AI learning assistant."
      : "透過 3D 骨骼模型、X 光影像辨識與 AI 小助手，讓骨骼知識變得更直覺、更好懂。",
    scroll: isEn ? "Scroll to explore more" : "往下探索更多",
  };

  return (
    <main className="home-page">
      <section className="home-hero">
        <div className="home-hero-text">
          <h1>
            {isEn ? (
              <>
                Learn bone anatomy
                <br />
                through <span>exploration</span>
              </>
            ) : (
              <>
                學習骨骼知識，
                <br />
                從 <span>探索</span> 開始
              </>
            )}
          </h1>

          <p className="home-desc">{text.desc}</p>

          <div className="home-hero-buttons">
            <Link href="/model" className="home-primary-btn">
              {isEn ? "Explore 3D Bones" : "開始探索 3D 骨骼"}
            </Link>

            <Link href="/llm" className="home-secondary-btn">
              {isEn ? "Ask BoneBaby" : "問問知識小罐頭"}
            </Link>
          </div>
        </div>

        <div className="home-hero-visual">
          <div className="home-skeleton-circle">
            <HomeBoneModel />
          </div>

          <img
            className="home-bone-baby hero-baby"
            src="/status/bone_baby.PNG"
            alt="BoneBaby"
          />

          <div className="hero-speech">
            <b>{isEn ? "Hi, I’m BoneBaby!" : "Hi，我是 Bone寶！"}</b>
            <span>
              {isEn
                ? "I’ll help you learn bones step by step with 3D, AI, and X-rays."
                : "我會陪你用 3D、AI 和 X 光一步步學骨骼。"}
            </span>
          </div>
        </div>

        <a href="#home-more" className="home-scroll-more">
          <span>{text.scroll}</span>
          <i>⌄</i>
        </a>
      </section>

      <section id="home-more" className="home-content-screen">
        <section className="home-intro-panel">
          <div className="home-intro-text">
            <span className="home-section-kicker">
              {isEn ? "BoneBaby Guide" : "Bone寶引導"}
            </span>

            <h2>
              {isEn
                ? "A playful path for learning bones"
                : "用更有趣的方式，走進骨骼學習"}
            </h2>

            <p>
              {isEn
                ? "GalaBone combines 3D interaction, AI explanations, X-ray recognition, and quizzes into one learning journey."
                : "GalaBone 將 3D 互動模型、AI 知識問答、X 光辨識與小測驗串成一條完整學習路徑。"}
            </p>
          </div>

          <img
            className="home-intro-img"
            src={`${boneBaby}/Bone_baby_1.webp`}
            alt="BoneBaby intro"
          />
        </section>

        <section className="home-feature-showcase">
          {featureSections.map((item, index) => (
            <Link
              href={item.href}
              className={`home-showcase-card ${index % 2 === 1 ? "reverse" : ""}`}
              key={item.titleZh}
            >
              <div className="home-showcase-copy">
                <span>{isEn ? item.tagEn : item.tagZh}</span>
                <h3>{isEn ? item.titleEn : item.titleZh}</h3>
                <p>{isEn ? item.descEn : item.descZh}</p>
              </div>

              <div className="home-showcase-image">
                <img src={`${boneBaby}${item.img}`} alt="" />
              </div>
            </Link>
          ))}
        </section>

        <section className="home-quick-grid">
          <div className="home-quick-card">
            <img src={`${boneBaby}/Bone_baby_5.webp`} alt="" />
            <h3>{isEn ? "Reliable answers" : "回答有依據"}</h3>
            <p>
              {isEn
                ? "AI responses are supported by learning materials."
                : "知識小罐頭會根據資料輔助回答，不是亂說話。"}
            </p>
          </div>

          <div className="home-quick-card">
            <img src={`${boneBaby}/Bone_baby_6.webp`} alt="" />
            <h3>{isEn ? "Document summaries" : "文件摘要整理"}</h3>
            <p>
              {isEn
                ? "Upload documents and quickly capture the key points."
                : "上傳文件後，AI 可以幫你整理摘要與重點。"}
            </p>
          </div>

          <div className="home-quick-card">
            <img src={`${boneBaby}/Bone_baby_10.webp`} alt="" />
            <h3>{isEn ? "Quiz practice" : "小測驗練習"}</h3>
            <p>
              {isEn
                ? "Review what you learned through simple quizzes."
                : "透過小測驗加深記憶，讓學習更有成就感。"}
            </p>
          </div>
        </section>

        <section className="home-cta">
          <div>
            <h2>
              {isEn
                ? "Ready to start your bone exploration journey?"
                : "準備好開始你的骨骼探索之旅了嗎？"}
            </h2>
            <p>
              {isEn
                ? "BoneBaby is ready to learn with you!"
                : "Bone寶已經準備好陪你一起學習！"}
            </p>
          </div>

          <Link href="/model" className="home-cta-btn">
            {isEn ? "Start Exploring" : "立即開始探索"}
          </Link>
        </section>
      </section>
    </main>
  );
}