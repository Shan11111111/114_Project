import { Suspense } from "react";
import AuthPageClient from "./AuthPageClient";

export default function AuthPage() {
  return (
    <Suspense
      fallback={
        <div
          style={{
            minHeight: "100vh",
            display: "grid",
            placeItems: "center",
            background: "#0b1220",
            color: "rgba(255,255,255,.92)",
            fontSize: 16,
          }}
        >
          Loading...
        </div>
      }
    >
      <AuthPageClient />
    </Suspense>
  );
}