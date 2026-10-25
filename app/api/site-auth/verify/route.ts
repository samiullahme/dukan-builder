import { NextResponse } from "next/server";
import { verifySiteToken } from "@/app/api/site-auth/route";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token") || "";
  const result = verifySiteToken(token);
  if (!result) return NextResponse.json({ valid: false }, { status: 401 });
  return NextResponse.json({ valid: true, site_id: result.site_id, username: result.username });
}
