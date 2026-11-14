import "server-only";

export function assertLocalPost(request: Request): void {
  const host = request.headers.get("host");
  const origin = request.headers.get("origin");
  let expected: URL;
  try {
    expected = new URL(`http://${host}`);
  } catch {
    throw new Error("只接受来自本机应用页面的请求");
  }
  if (
    !["localhost", "127.0.0.1", "[::1]"].includes(expected.hostname) ||
    !host || expected.host !== host ||
    origin !== expected.origin
  ) {
    throw new Error("只接受来自本机应用页面的请求");
  }
}

export async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  assertLocalPost(request);
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    throw new Error("请求必须使用 application/json");
  }
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
