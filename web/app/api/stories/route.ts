import { NextResponse } from "next/server";
import { loadBrief } from "../../../lib/data";

export const dynamic = "force-dynamic";

export async function GET() {
  const result = await loadBrief();
  if (!result.brief) {
    return NextResponse.json({ error: result.error }, { status: 404 });
  }
  return NextResponse.json({ stories: result.brief.stories, edges: result.brief.edges });
}
