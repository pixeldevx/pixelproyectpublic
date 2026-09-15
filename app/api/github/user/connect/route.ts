import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  createGithubState,
  ensurePixelUser,
  getAppBaseUrl,
  getGithubPublicConfiguration,
  getServerSupabase,
  safeReturnTo,
} from "@/lib/github/server";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const supabase = getServerSupabase();
    const auth = await ensurePixelUser(request, supabase);
    if (auth.error) return auth.error;
    const configuration = getGithubPublicConfiguration();
    if (!configuration.clientId || !configuration.stateSecret) {
      return NextResponse.json({ error: "La vinculación personal de GitHub no está configurada en Vercel." }, { status: 503 });
    }
    const body = await request.json();
    const returnTo = safeReturnTo(body?.returnTo, "/projects");
    const state = await createGithubState(supabase, {
      purpose: "identity",
      userId: auth.actor.id,
      email: auth.actor.email,
      returnTo,
    });
    const callbackUrl = `${getAppBaseUrl(request)}/api/github/user/callback`;
    const parameters = new URLSearchParams({
      client_id: String(process.env.GITHUB_CLIENT_ID),
      redirect_uri: callbackUrl,
      state,
    });
    return NextResponse.json({ url: `https://github.com/login/oauth/authorize?${parameters.toString()}` });
  } catch (error: any) {
    console.error("GitHub identity start error:", error);
    return NextResponse.json({ error: error?.message || "No se pudo iniciar la vinculación personal." }, { status: 500 });
  }
}
