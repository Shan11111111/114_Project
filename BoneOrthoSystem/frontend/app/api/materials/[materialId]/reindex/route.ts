import { NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL || "http://127.0.0.1:8000";

export async function POST(_: Request, ctx: { params: { materialId: string } }) {
  const { materialId } = ctx.params;

  const r = await fetch(`${BACKEND_URL}/s2/materials/${materialId}/reindex`, { method: "POST" });
  const text = await r.text();

  return new NextResponse(text, {
    status: r.status,
    headers: { "Content-Type": r.headers.get("content-type") || "application/json" },
  });
}
