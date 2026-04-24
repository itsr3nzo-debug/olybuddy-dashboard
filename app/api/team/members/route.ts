import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { getSupabase } from "@/lib/supabase";
import { getUserSession, hasPermission } from "@/lib/rbac";
import { getTeamLimit } from "@/lib/team-limits";

/**
 * GET /api/team/members
 *
 * Returns the team roster for the caller's client_id, plus the
 * per-plan seat limit so the UI can render "2 of 3 seats used"
 * without a second round-trip.
 *
 * Shape:
 *   {
 *     members: TeamMember[],  // everyone on this client (incl. caller)
 *     count:   number,        // members.length — server-authoritative
 *     limit:   { plan, cap, label }  // from lib/team-limits
 *   }
 *
 * Back-compat note: earlier versions of TeamSection expected a raw
 * array. We still check for `Array.isArray` on the client so an old
 * bundle against a new API doesn't blow up, but every new deploy
 * serves the object shape.
 */
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

  // Pull roster + plan in parallel — both are fast, no reason to serialise.
  const [usersRes, clientRes] = await Promise.all([
    adminSupabase.auth.admin.listUsers({ perPage: 200 }),
    adminSupabase
      .from("clients")
      .select("subscription_plan")
      .eq("id", session.clientId)
      .maybeSingle(),
  ]);

  if (usersRes.error) {
    return NextResponse.json({ error: usersRes.error.message }, { status: 500 });
  }

  const subscriptionPlan = (clientRes.data as { subscription_plan?: string } | null)?.subscription_plan ?? "trial";
  const limit = getTeamLimit(subscriptionPlan);

  const teamMembers = (usersRes.data.users ?? [])
    .filter(u => u.app_metadata?.client_id === session.clientId)
    .map(u => ({
      id: u.id,
      email: u.email,
      role: (u.app_metadata?.role as string | undefined) ?? "member",
      created_at: u.created_at,
      last_sign_in_at: u.last_sign_in_at,
    }));

  return NextResponse.json({
    members: teamMembers,
    count: teamMembers.length,
    limit,
  });
}
