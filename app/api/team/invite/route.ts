import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { getSupabase } from "@/lib/supabase";
import { getUserSession, hasPermission } from "@/lib/rbac";
import { getTeamLimit, isAtCap } from "@/lib/team-limits";

export async function POST(req: NextRequest) {
  // Auth: get current user
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

  const { email } = await req.json();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Valid email required" }, { status: 400 });
  }

  const adminSupabase = getSupabase();

  // ── Per-plan invite cap ─────────────────────────────────────────────
  // Count current team size (every user stamped with this client_id —
  // owner, members, and any super_admin who's linked here). Reject the
  // invite BEFORE calling createUser so we don't leave orphaned auth rows
  // on cap-hit. Free-tier-style "too many seats on your plan" UX.
  const { data: clientRowForCap } = await adminSupabase
    .from("clients")
    .select("subscription_plan, name")
    .eq("id", session.clientId)
    .maybeSingle();
  const subscriptionPlan = (clientRowForCap as { subscription_plan?: string } | null)?.subscription_plan ?? "trial";
  const limit = getTeamLimit(subscriptionPlan);

  const { data: { users: allUsers } } = await adminSupabase.auth.admin.listUsers({ perPage: 200 });
  const teamCount = (allUsers ?? []).filter(u => u.app_metadata?.client_id === session.clientId).length;
  if (isAtCap(teamCount, limit.cap)) {
    return NextResponse.json(
      {
        error: `Your ${limit.plan} plan allows ${limit.label}. You already have ${teamCount}. Upgrade to invite more.`,
        plan: limit.plan,
        cap: limit.cap,
        current: teamCount,
      },
      { status: 409 },
    );
  }

  // Create auth user with member role
  const { data: authData, error: authErr } = await adminSupabase.auth.admin.createUser({
    email,
    email_confirm: false,
    app_metadata: {
      client_id: session.clientId,
      role: "member",
    },
  });

  if (authErr) {
    if (authErr.message?.includes("already been registered")) {
      return NextResponse.json({ error: "This email is already registered" }, { status: 409 });
    }
    return NextResponse.json({ error: authErr.message }, { status: 500 });
  }

  // Generate magic link for the invited user
  const { data: linkData, error: linkErr } = await adminSupabase.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: {
      redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/auth/callback`,
    },
  });

  if (linkErr || !linkData.properties?.action_link) {
    return NextResponse.json({ error: "User created but failed to generate invite link" }, { status: 500 });
  }

  // Fetch the client's business name so the invite email can say
  // "join Joseph Solutions" instead of a generic "the dashboard".
  const { data: clientRow } = await adminSupabase
    .from("clients")
    .select("name")
    .eq("id", session.clientId)
    .maybeSingle();
  const clientName = (clientRow as { name?: string } | null)?.name ?? "your team";
  const inviterName = user.email ?? "A teammate";

  // Send the branded invite. On SMTP failure we still return success +
  // include the action_link so the owner can copy it directly to the
  // invitee via another channel (WhatsApp, text, etc.).
  let emailSent = true;
  try {
    const { sendSystemEmail } = await import("@/lib/email");
    const { buildTeamInviteEmail } = await import("@/lib/email-templates/team-invite");
    const { subject, html, text } = buildTeamInviteEmail({
      clientName,
      inviterName,
      actionLink: linkData.properties.action_link,
    });
    await sendSystemEmail({ to: email, subject, html, text });
  } catch {
    emailSent = false;
  }

  return NextResponse.json({
    success: true,
    userId: authData.user?.id,
    email,
    role: "member",
    emailSent,
    // Fallback for the UI to offer copy-to-clipboard when SMTP silently fails
    inviteUrl: linkData.properties.action_link,
  });
}
