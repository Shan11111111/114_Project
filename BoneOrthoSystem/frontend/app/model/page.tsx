// frontend/app/model/page.tsx
import { Suspense } from "react";
import S3Viewer from "./S3Viewer";

export default function S3ViewerPage() {
  return (
    <main className="w-full h-[calc(100vh-56px)]">
      <Suspense
        fallback={
          <div
            className="w-full h-full flex items-center justify-center"
            style={{
              background: "var(--viewer-bg)",
              color: "var(--panel-text)",
              fontWeight: 900,
            }}
          >
            載入 3D 模型中...
          </div>
        }
      >
        <S3Viewer />
      </Suspense>
    </main>
  );
}