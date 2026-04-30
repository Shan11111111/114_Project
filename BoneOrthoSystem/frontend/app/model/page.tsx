// frontend/app/model/page.tsx
'use client';

import { Suspense } from 'react';
import S3Viewer from './S3Viewer';

export default function S3ViewerPage() {
  return (
    <main className="w-full h-[calc(100vh-64px)]">
      <Suspense fallback={<div className="p-4 text-black">載入 3D 模型中...</div>}>
        <S3Viewer />
      </Suspense>
    </main>
  );
}