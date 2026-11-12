import "server-only";

export async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    throw new Error("请求不是有效 JSON");
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("请求必须是 JSON 对象");
  }
  return payload as Record<string, unknown>;
}
