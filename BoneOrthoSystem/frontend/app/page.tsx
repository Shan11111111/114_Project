"use client";

import Link from "next/link";
import "./home.css";
import HomeBoneModel from "./components/HomeBoneModel";
const boneBaby = "/bone-baby";

export default function Home() {
  return (
    <main className="home-page">
      <section className="home-hero">
        <div className="home-hero-text">

          <h1>
            學習骨骼知識，
            <br />
            從 <span>探索</span> 開始
          </h1>

          <p className="home-desc">
            透過 3D 骨骼模型、X 光影像辨識與 AI 小助手，
            讓骨骼知識變得更直覺、更好懂。
          </p>

          <div className="home-actions">
            <Link href="/3d" className="home-action-btn action-3d">
              <span>01</span>
              探索 3D 骨骼模型
            </Link>

            <Link href="/bonevision" className="home-action-btn action-xray">
              <span>02</span>
              上傳 X 光影像
            </Link>

            <Link href="/llm" className="home-action-btn action-ai">
              <span>03</span>
              知識小罐頭
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
            alt="Bone寶"
          />
        </div>
        <a href="#home-more" className="home-scroll-more">
          <span>往下探索更多</span>
          <i>⌄</i>
        </a>
      </section>

      <section id="home-more" className="home-content-screen">
        <section className="home-feature-grid">
          <Link href="/3d" className="home-feature-card green">
            <div>
              <p className="home-feature-title">3D 骨骼模型</p>
              <p>360° 旋轉觀察，認識身體中的重要骨頭。</p>
            </div>
            <img src={`${boneBaby}/Bone_baby_2.webp`} alt="3D 骨骼模型" />
          </Link>

          <Link href="/bonevision" className="home-feature-card blue">
            <div>
              <p className="home-feature-title">X 光影像辨識</p>
              <p>上傳 X 光片，快速了解骨骼位置與名稱。</p>
            </div>
            <img src={`${boneBaby}/Bone_baby_9.webp`} alt="X 光辨識" />
          </Link>

          <Link href="/llm" className="home-feature-card purple">
            <div>
              <p className="home-feature-title">AI 小助手</p>
              <p>遇到不懂的骨骼知識，可以直接問 Bone寶。</p>
            </div>
            <img src={`${boneBaby}/Bone_baby_4.webp`} alt="AI 小助手" />
          </Link>
        </section>

        <section className="home-journey">
          <h2>你的學習旅程</h2>

          <div className="home-steps">
            <div className="home-step">
              <img src={`${boneBaby}/Bone_baby_5.webp`} alt="" />
              <b>上傳資料</b>
              <span>支援圖片與文件</span>
            </div>

            <div className="home-step">
              <img src={`${boneBaby}/Bone_baby_9.webp`} alt="" />
              <b>AI / X 光辨識</b>
              <span>快速定位骨骼位置</span>
            </div>

            <div className="home-step">
              <img src={`${boneBaby}/Bone_baby_3.webp`} alt="" />
              <b>AI 解說</b>
              <span>用簡單方式理解知識</span>
            </div>

            <div className="home-step">
              <img src={`${boneBaby}/Bone_baby_6.webp`} alt="" />
              <b>整理重點</b>
              <span>吸收文件摘要</span>
            </div>

            <div className="home-step">
              <img src={`${boneBaby}/Bone_baby_8.webp`} alt="" />
              <b>匯出分享</b>
              <span>留下你的學習紀錄</span>
            </div>
          </div>
        </section>

        <section className="home-info-grid">
          <div className="home-info-card">
            <img src={`${boneBaby}/Bone_baby_8.webp`} alt="" />
            <div>
              <h3>小提醒會保護好你的回憶！</h3>
              <p>學習紀錄可以被保存，方便之後回來複習。</p>
            </div>
          </div>

          <div className="home-info-card">
            <img src={`${boneBaby}/Bone_baby_7.webp`} alt="" />
            <div>
              <h3>文件太長也不用怕</h3>
              <p>AI 可以幫你整理摘要，快速抓到重點。</p>
            </div>
          </div>

          <div className="home-info-card">
            <img src={`${boneBaby}/Bone_baby_3.webp`} alt="" />
            <div>
              <h3>問題可以直接問</h3>
              <p>用聊天方式學骨骼知識，降低學習門檻。</p>
            </div>
          </div>
        </section>

        <section className="home-cta">
          <div>
            <h2>準備好開始你的骨骼探索之旅了嗎？</h2>
            <p>Bone寶已經迫不及待想和你一起學習！</p>
          </div>

          <Link href="/3d" className="home-cta-btn">
            立即開始探索
          </Link>
        </section>
      </section>
    </main>
  );
}