import { NextResponse } from "next/server";
import path from "path";
import crypto from "crypto";
import { promises as fs } from "fs";

export async function POST(req: Request) {
  const formData = await req.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ detail: "file is required" }, { status: 400 });
  }

  const orig = file.name || "upload.bin";
  const extRaw = path.extname(orig).toLowerCase().replace(".", "");
  const ext = extRaw || "bin";

  const bytes = Buffer.from(await file.arrayBuffer());
  const fname = `${crypto.randomUUID()}.${ext}`;

  const dir = path.join(process.cwd(), "public", "user_upload_file");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, fname), bytes);

  return NextResponse.json({
    url: `/public/user_upload_file/${fname}`,
    filetype: ext,
    filename: orig,
  });
}
