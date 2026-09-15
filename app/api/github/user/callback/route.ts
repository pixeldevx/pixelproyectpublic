import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  consumeGithubState,
  getAppBaseUrl,
  getServerSupabase,
  githubFetch,
  readDocument,
  safeReturnTo,
  writeDocument,
} from "@/lib/github/server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const baseUrl = getAppBaseUrl(request);
  try {
    const state = request.nextUrl.searchParams.get("state") || "";
    const code = request.nextUrl.searchParams.get("code") || "";
    if (!code) throw new Error("GitHub no devolvió el código de autorización.");
    const supabase = getServerSupabase();
    const payload = await consumeGithubState(supabase, state, "identity");

    const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        code,
      }),
      cache: "no-store",
    });
    const tokenBody = await tokenResponse.json();
    if (!tokenResponse.ok || !tokenBody.access_token) {
      throw new Error(tokenBody.error_description || "GitHub no autorizó la identidad.");
    }
    const githubUser = await githubFetch<any>("/user", { token: tokenBody.access_token });

    let profileDocId = payload.userId;
    const byId = await readDocument(supabase, "users", payload.userId);
    if (!byId) {
      const { data, error } = await supabase
        .from("app_documents")
        .select("doc_id")
        .eq("collection_path", "users")
        .eq("data->>email", payload.email)
        .limit(1);
      if (error) throw error;
      profileDocId = data?.[0]?.doc_id || payload.userId;
    }
    await writeDocument(supabase, "users", profileDocId, {
      githubIdentity: {
        id: githubUser.id,
        nodeId: githubUser.node_id,
        login: githubUser.login,
        name: githubUser.name || null,
        avatarUrl: githubUser.avatar_url,
        profileUrl: githubUser.html_url,
        verifiedAt: new Date().toISOString(),
      },
    });

    const redirectUrl = new URL(safeReturnTo(payload.returnTo), baseUrl);
    redirectUrl.searchParams.set("github", "identity-connected");
    return NextResponse.redirect(redirectUrl);
  } catch (error: any) {
    console.error("GitHub identity callback error:", error);
    const redirectUrl = new URL("/projects", baseUrl);
    redirectUrl.searchParams.set("github", "error");
    redirectUrl.searchParams.set("message", error?.message || "No se pudo vincular la identidad.");
    return NextResponse.redirect(redirectUrl);
  }
}
