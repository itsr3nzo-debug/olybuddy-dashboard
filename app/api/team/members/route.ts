import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { getSupabase } from "@/lib/supabase";
import { getUserSession, hasPermission } from "@/lib/rbac";

export async function GET(req: NextRequest) {
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return req.cookies.getAll(); },
        setAll() {},
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const session = getUserSession(user);
  if (!hasPermission(session.role, "invite_members")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!session.clientId) {
    return NextResponse.json({ error: "No client_id" }, { status: 400 });
  }

  const adminSupabase = getSupabase();

  // List all users for this client
  const { data: { users }, error } = await adminSupabase.auth.admin.listUsers({
    perPage: 100,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Filter to this client's users only
  const teamMembers = (users ?? [])
    .filter(u => u.app_metadata?.client_id === session.clientId)
    .map(u => ({
      id: u.id,
      email: u.email,
      role: u.app_metadata?.role ?? "member",
      created_at: u.created_at,
      last_sign_in_at: u.last_sign_in_at,
    }));

  return NextResponse.json(teamMembers);
}
