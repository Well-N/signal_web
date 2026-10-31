import { NextResponse } from "next/server";
import { loadBrief } from "../../../lib/data";

export const dynamic = "force-dynamic";

export async function GET() {
  const result = await loadBrief();
  if (!result.brief) {
    return NextResponse.json({ error: result.error, sourcePath: result.sourcePath }, { status: 404 });
  }
  return NextResponse.json(result.brief);
}
