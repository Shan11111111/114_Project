"use client";

import Link from "next/link";
import "./home.css";
import HomeBoneModel from "./components/HomeBoneModel";
import { useLocale } from "./context/LocaleContext";

const boneBaby = "/bone-baby";

export default function Home() {
  const { locale } = useLocale();
  const isEn = locale === "en-US";

  const text = {
    title1: isEn ? "Learn bone anatomy," : "學習骨骼知識，",
    title2: isEn ? "start with " : "從 ",
    titleHighlight: isEn ? "exploration" : "探索",
    title3: isEn ? "" : " 開始",
    desc: isEn
      ? "Explore bones through 3D models, X-ray recognition, and an AI learning assistant."
      : "透過 3D 骨骼模型、X 光影像辨識與 AI 小助手，讓骨骼知識變得更直覺、更好懂。",
    action3d: isEn ? "Explore 3D Bone Model" : "探索 3D 骨骼模型",
    actionXray: isEn ? "Upload X-ray Image" : "上傳 X 光影像",
    actionAi: isEn ? "Knowledge Can" : "知識小罐頭",
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

          <div className="home-actions">
            <Link href="/3d" className="home-action-btn">
              <div className="action-line-icon">◈</div>

              <div className="action-content">
                <span>01</span>
                <strong>{text.action3d}</strong>
                <small>
                  {isEn
                    ? "Interactive anatomy exploration"
                    : "互動式骨骼學習"}
                </small>
              </div>
            </Link>

            <Link href="/bonevision" className="home-action-btn">
              <div className="action-line-icon">✦</div>

              <div className="action-content">
                <span>02</span>
                <strong>{text.actionXray}</strong>
                <small>
                  {isEn
                    ? "AI X-ray recognition"
                    : "AI X 光辨識"}
                </small>
              </div>
            </Link>

            <Link href="/llm" className="home-action-btn">
              <div className="action-line-icon">◎</div>

              <div className="action-content">
                <span>03</span>
                <strong>{text.actionAi}</strong>
                <small>
                  {isEn
                    ? "Chat with BoneBaby"
                    : "和 Bone寶聊天學習"}
                </small>
              </div>
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
        </div>

        <a href="#home-more" className="home-scroll-more">
          <span>{text.scroll}</span>
          <i>⌄</i>
        </a>
      </section>

      <section id="home-more" className="home-content-screen">
        <section className="home-feature-grid">
          <Link href="/3d" className="home-feature-card green">
            <div>
              <p className="home-feature-title">
                {isEn ? "3D Bone Model" : "3D 骨骼模型"}
              </p>
              <p>
                {isEn
                  ? "Rotate and observe bones in 360° to understand key body structures."
                  : "360° 旋轉觀察，認識身體中的重要骨頭。"}
              </p>
            </div>
            <img src={`${boneBaby}/Bone_baby_2.webp`} alt="3D Bone Model" />
          </Link>

          <Link href="/bonevision" className="home-feature-card blue">
            <div>
              <p className="home-feature-title">
                {isEn ? "X-ray Recognition" : "X 光影像辨識"}
              </p>
              <p>
                {isEn
                  ? "Upload an X-ray image to quickly identify bone positions and names."
                  : "上傳 X 光片，快速了解骨骼位置與名稱。"}
              </p>
            </div>
            <img src={`${boneBaby}/Bone_baby_9.webp`} alt="X-ray Recognition" />
          </Link>

          <Link href="/llm" className="home-feature-card purple">
            <div>
              <p className="home-feature-title">
                {isEn ? "AI Assistant" : "AI 小助手"}
              </p>
              <p>
                {isEn
                  ? "Ask BoneBaby whenever you have questions about bone knowledge."
                  : "遇到不懂的骨骼知識，可以直接問 Bone寶。"}
              </p>
            </div>
            <img src={`${boneBaby}/Bone_baby_4.webp`} alt="AI Assistant" />
          </Link>
        </section>

        <section className="home-journey">
          <h2>{isEn ? "Your Learning Journey" : "你的學習旅程"}</h2>

          <div className="home-steps">
            {[
              ["/Bone_baby_5.webp", isEn ? "Upload Data" : "上傳資料", isEn ? "Images and files supported" : "支援圖片與文件"],
              ["/Bone_baby_9.webp", isEn ? "AI / X-ray Recognition" : "AI / X 光辨識", isEn ? "Locate bones quickly" : "快速定位骨骼位置"],
              ["/Bone_baby_3.webp", isEn ? "AI Explanation" : "AI 解說", isEn ? "Understand concepts easily" : "用簡單方式理解知識"],
              ["/Bone_baby_6.webp", isEn ? "Key Summary" : "整理重點", isEn ? "Absorb summaries faster" : "吸收文件摘要"],
              ["/Bone_baby_8.webp", isEn ? "Export & Share" : "匯出分享", isEn ? "Keep your learning records" : "留下你的學習紀錄"],
            ].map(([img, title, desc]) => (
              <div className="home-step" key={title}>
                <img src={`${boneBaby}${img}`} alt="" />
                <b>{title}</b>
                <span>{desc}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="home-info-grid">
          <div className="home-info-card">
            <img src={`${boneBaby}/Bone_baby_8.webp`} alt="" />
            <div>
              <h3>{isEn ? "Your learning memories are safe!" : "小提醒會保護好你的回憶！"}</h3>
              <p>{isEn ? "Learning records can be saved for later review." : "學習紀錄可以被保存，方便之後回來複習。"}</p>
            </div>
          </div>

          <div className="home-info-card">
            <img src={`${boneBaby}/Bone_baby_7.webp`} alt="" />
            <div>
              <h3>{isEn ? "Long documents are not a problem" : "文件太長也不用怕"}</h3>
              <p>{isEn ? "AI helps summarize content and capture key points quickly." : "AI 可以幫你整理摘要，快速抓到重點。"}</p>
            </div>
          </div>

          <div className="home-info-card">
            <img src={`${boneBaby}/Bone_baby_3.webp`} alt="" />
            <div>
              <h3>{isEn ? "Ask questions directly" : "問題可以直接問"}</h3>
              <p>{isEn ? "Learn bone knowledge through simple conversations." : "用聊天方式學骨骼知識，降低學習門檻。"}</p>
            </div>
          </div>
        </section>

        <section className="home-cta">
          <div>
            <h2>{isEn ? "Ready to start your bone exploration journey?" : "準備好開始你的骨骼探索之旅了嗎？"}</h2>
            <p>{isEn ? "BoneBaby is ready to learn with you!" : "Bone寶已經迫不及待想和你一起學習！"}</p>
          </div>

          <Link href="/3d" className="home-cta-btn">
            {isEn ? "Start Exploring" : "立即開始探索"}
          </Link>
        </section>
      </section>
    </main>
  );
}