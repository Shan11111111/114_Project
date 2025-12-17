import { NextResponse, type NextRequest } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL || "http://127.0.0.1:8000";

export async function POST(request: NextRequest, ctx: { params: Promise<{ materialId: string }> }) {
  const { materialId } = await ctx.params;

  const r = await fetch(`${BACKEND_URL}/s2/materials/${materialId}/reindex`, { method: "POST" });
  const text = await r.text();

  return NextResponse.json({ ok: true });
}
