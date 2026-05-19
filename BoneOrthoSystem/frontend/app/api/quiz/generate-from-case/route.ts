import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  try {
    const searchParams = req.nextUrl.searchParams;

    const imageCaseId = searchParams.get("image_case_id");
    const limit = searchParams.get("limit") || "5";
    const locale = searchParams.get("locale") || "zh-TW";

    if (!imageCaseId) {
      return NextResponse.json(
        { detail: "missing image_case_id" },
        { status: 400 }
      );
    }

    const backendUrl =
      `http://140.136.155.157:8000/quiz/generate-from-case` +
      `?image_case_id=${encodeURIComponent(imageCaseId)}` +
      `&limit=${encodeURIComponent(limit)}` +
      `&locale=${encodeURIComponent(locale)}`;

    console.log("proxy backendUrl =", backendUrl);

    const res = await fetch(backendUrl);

    const text = await res.text();

    return new NextResponse(text, {
      status: res.status,
      headers: {
        "Content-Type":
          res.headers.get("content-type") || "application/json",
      },
    });
  } catch (err: any) {
    console.error(err);

    return NextResponse.json(
      {
        detail: String(err),
      },
      { status: 500 }
    );
  }
}