export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(request: Request) {
  const expected = process.env.SIGNALWEB_INSTANCE_TOKEN;
  if (!expected || request.headers.get("x-signalweb-instance-token") !== expected) {
    return new Response(null, { status: 403 });
  }
  return new Response(null, { status: 204 });
}
