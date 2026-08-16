// ============================================================================
// Supabase Edge Function: admin-manage-workspace-user
// Actions: invite, update
// Security: Server-side only, JWT validated, DB-backed caller authorization
// ============================================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const VALID_WORKSPACE_ROLES = ["admin", "member", "viewer"] as const;
const VALID_DEPT_ROLES = ["head", "lead", "member"] as const;
const VALID_SYSTEM_ROLES = ["ceo", "cto", "project_admin", "system_admin"] as const;

interface DepartmentAssignment {
  department_id: string;
  role: "head" | "lead" | "member";
  is_primary: boolean;
}

interface RequestPayload {
  action: "invite" | "update";
  workspace_id: string;
  user_id?: string;
  email?: string;
  full_name?: string;
  workspace_role?: "admin" | "member" | "viewer" | "owner";
  departments?: DepartmentAssignment[];
  system_roles?: string[];
}

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing Authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    if (!supabaseUrl || !supabaseServiceRoleKey) {
      return new Response(
        JSON.stringify({ error: "Server misconfiguration: missing Supabase environment variables" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 1. Authenticate caller via JWT
    const supabaseAuthClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });

    const { data: { user: callerUser }, error: userError } = await supabaseAuthClient.auth.getUser();
    if (userError || !callerUser) {
      return new Response(
        JSON.stringify({ error: "Unauthorized: Invalid or expired authentication token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Service role client for privileged database & auth admin operations
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const body: RequestPayload = await req.json();
    const { action, workspace_id } = body;

    if (!action || !workspace_id) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: 'action' and 'workspace_id'" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 2. Resolve caller authority in workspace from database
    const { data: callerMember, error: callerMemberErr } = await supabaseAdmin
      .from("workspace_members")
      .select("role, status")
      .eq("workspace_id", workspace_id)
      .eq("user_id", callerUser.id)
      .eq("status", "active")
      .maybeSingle();

    if (callerMemberErr || !callerMember) {
      return new Response(
        JSON.stringify({ error: "Forbidden: Caller is not an active member of this workspace" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: callerSysRoles } = await supabaseAdmin
      .from("user_system_roles")
      .select("role")
      .eq("workspace_id", workspace_id)
      .eq("user_id", callerUser.id);

    const callerRoles = (callerSysRoles || []).map((r: { role: string }) => r.role);
    const isCallerOwner = callerMember.role === "owner";
    const isCallerSystemAdmin = callerRoles.includes("system_admin");
    const isCallerWorkspaceAdmin = callerMember.role === "admin";

    const hasAdminAccess = isCallerOwner || isCallerSystemAdmin || isCallerWorkspaceAdmin;
    if (!hasAdminAccess) {
      return new Response(
        JSON.stringify({ error: "Forbidden: Insufficient privileges for organization administration" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate departments if provided
    if (body.departments && body.departments.length > 0) {
      const primaryCount = body.departments.filter((d) => d.is_primary).length;
      if (primaryCount !== 1) {
        return new Response(
          JSON.stringify({ error: "Validation error: Exactly one primary department must be designated" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Check all departments belong to workspace
      const deptIds = body.departments.map((d) => d.department_id);
      const { data: validDepts, error: deptErr } = await supabaseAdmin
        .from("departments")
        .select("id")
        .eq("workspace_id", workspace_id)
        .in("id", deptIds);

      if (deptErr || !validDepts || validDepts.length !== deptIds.length) {
        return new Response(
          JSON.stringify({ error: "Validation error: One or more departments do not belong to this workspace" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Validate department roles
      for (const d of body.departments) {
        if (!VALID_DEPT_ROLES.includes(d.role)) {
          return new Response(
            JSON.stringify({ error: `Validation error: Invalid department role '${d.role}'` }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }
    }

    // Validate system roles if provided
    if (body.system_roles && body.system_roles.length > 0) {
      // Workspace Admin cannot assign/modify system roles
      if (!isCallerOwner && !isCallerSystemAdmin) {
        return new Response(
          JSON.stringify({ error: "Forbidden: Only workspace owners and system administrators can assign system roles" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      for (const sr of body.system_roles) {
        if (!VALID_SYSTEM_ROLES.includes(sr as any)) {
          return new Response(
            JSON.stringify({ error: `Validation error: Invalid system role '${sr}'` }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }
    }

    // =========================================================================
    // ACTION: INVITE
    // =========================================================================
    if (action === "invite") {
      const email = body.email?.trim().toLowerCase();
      const fullName = body.full_name?.trim();
      const workspaceRole = body.workspace_role || "member";

      if (!email || !fullName) {
        return new Response(
          JSON.stringify({ error: "Validation error: 'email' and 'full_name' are required for invitation" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (!VALID_WORKSPACE_ROLES.includes(workspaceRole as any)) {
        return new Response(
          JSON.stringify({ error: `Validation error: Invalid workspace role '${workspaceRole}'` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Workspace Admin cannot invite an admin
      if (workspaceRole === "admin" && !isCallerOwner && !isCallerSystemAdmin) {
        return new Response(
          JSON.stringify({ error: "Forbidden: Workspace administrators cannot create or invite other administrators" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Check if user already exists in auth.users
      let targetUserId: string;
      const { data: userList } = await supabaseAdmin.auth.admin.listUsers();
      const existingAuthUser = userList?.users?.find((u) => u.email?.toLowerCase() === email);

      if (existingAuthUser) {
        targetUserId = existingAuthUser.id;
      } else {
        // Send official Supabase Auth invitation
        const { data: inviteData, error: inviteErr } = await supabaseAdmin.auth.admin.inviteUserByEmail(
          email,
          {
            data: { full_name: fullName },
            redirectTo: "https://abzops.github.io/sns-projects/",
          }
        );

        if (inviteErr || !inviteData.user) {
          return new Response(
            JSON.stringify({ error: inviteErr?.message || "Failed to send auth invitation email" }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        targetUserId = inviteData.user.id;
      }

      // Ensure profile exists and has full_name
      await supabaseAdmin.from("profiles").upsert(
        {
          id: targetUserId,
          full_name: fullName,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "id" }
      );

      // Upsert workspace_members
      const { data: memberRecord, error: memberErr } = await supabaseAdmin
        .from("workspace_members")
        .upsert(
          {
            workspace_id: workspace_id,
            user_id: targetUserId,
            invited_email: email,
            role: workspaceRole,
            status: existingAuthUser?.last_sign_in_at ? "active" : "pending",
            invited_by: callerUser.id,
          },
          { onConflict: "workspace_id,user_id" }
        )
        .select()
        .single();

      if (memberErr) {
        return new Response(
          JSON.stringify({ error: memberErr.message || "Failed to create workspace membership" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Assign department memberships if provided
      if (body.departments && body.departments.length > 0) {
        for (const dept of body.departments) {
          await supabaseAdmin.from("department_memberships").upsert(
            {
              workspace_id: workspace_id,
              department_id: dept.department_id,
              user_id: targetUserId,
              role: dept.role,
              is_primary: dept.is_primary,
              is_active: true,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "department_id,user_id" }
          );
        }
      }

      // Assign system roles if provided and authorized
      if (body.system_roles && body.system_roles.length > 0 && (isCallerOwner || isCallerSystemAdmin)) {
        for (const sRole of body.system_roles) {
          await supabaseAdmin.from("user_system_roles").upsert(
            {
              workspace_id: workspace_id,
              user_id: targetUserId,
              role: sRole,
              created_by: callerUser.id,
            },
            { onConflict: "workspace_id,user_id,role" }
          );
        }
      }

      return new Response(
        JSON.stringify({
          success: true,
          message: "User invitation created successfully",
          user_id: targetUserId,
          membership: memberRecord,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // =========================================================================
    // ACTION: UPDATE
    // =========================================================================
    if (action === "update") {
      const targetUserId = body.user_id;
      if (!targetUserId) {
        return new Response(
          JSON.stringify({ error: "Validation error: 'user_id' is required for update" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Fetch target user's current workspace member record
      const { data: targetMember, error: targetMemberErr } = await supabaseAdmin
        .from("workspace_members")
        .select("id, role, status")
        .eq("workspace_id", workspace_id)
        .eq("user_id", targetUserId)
        .maybeSingle();

      if (targetMemberErr || !targetMember) {
        return new Response(
          JSON.stringify({ error: "Target user is not a member of this workspace" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Owner Protection: Current workspace owner cannot be demoted or removed
      if (targetMember.role === "owner" && body.workspace_role && body.workspace_role !== "owner") {
        return new Response(
          JSON.stringify({ error: "Forbidden: Workspace owner cannot be demoted or have their role altered" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Workspace Admin privilege restrictions
      if (!isCallerOwner && !isCallerSystemAdmin) {
        if (body.workspace_role === "admin" || body.workspace_role === "owner") {
          return new Response(
            JSON.stringify({ error: "Forbidden: Workspace administrators cannot promote users to admin or owner" }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        if (targetMember.role === "admin") {
          return new Response(
            JSON.stringify({ error: "Forbidden: Workspace administrators cannot modify other administrators" }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }

      // Update full_name if provided
      if (body.full_name && body.full_name.trim()) {
        await supabaseAdmin.from("profiles").upsert(
          {
            id: targetUserId,
            full_name: body.full_name.trim(),
            updated_at: new Date().toISOString(),
          },
          { onConflict: "id" }
        );
      }

      // Update workspace_role if provided and not owner
      if (body.workspace_role && targetMember.role !== "owner") {
        if (!VALID_WORKSPACE_ROLES.includes(body.workspace_role as any)) {
          return new Response(
            JSON.stringify({ error: `Validation error: Invalid workspace role '${body.workspace_role}'` }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        await supabaseAdmin
          .from("workspace_members")
          .update({ role: body.workspace_role })
          .eq("id", targetMember.id);
      }

      // Sync department memberships if provided
      if (body.departments) {
        const newDeptIds = body.departments.map((d) => d.department_id);

        // Remove old memberships not in newDeptIds
        if (newDeptIds.length > 0) {
          await supabaseAdmin
            .from("department_memberships")
            .delete()
            .eq("workspace_id", workspace_id)
            .eq("user_id", targetUserId)
            .not("department_id", "in", `(${newDeptIds.join(",")})`);
        } else {
          await supabaseAdmin
            .from("department_memberships")
            .delete()
            .eq("workspace_id", workspace_id)
            .eq("user_id", targetUserId);
        }

        // Upsert new memberships
        for (const dept of body.departments) {
          await supabaseAdmin.from("department_memberships").upsert(
            {
              workspace_id: workspace_id,
              department_id: dept.department_id,
              user_id: targetUserId,
              role: dept.role,
              is_primary: dept.is_primary,
              is_active: true,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "department_id,user_id" }
          );
        }
      }

      // Sync system roles if provided and caller is Owner/System Admin
      if (body.system_roles && (isCallerOwner || isCallerSystemAdmin)) {
        const newSysRoles = body.system_roles;

        // Delete removed system roles
        if (newSysRoles.length > 0) {
          await supabaseAdmin
            .from("user_system_roles")
            .delete()
            .eq("workspace_id", workspace_id)
            .eq("user_id", targetUserId)
            .not("role", "in", `(${newSysRoles.map((r) => `'${r}'`).join(",")})`);
        } else {
          await supabaseAdmin
            .from("user_system_roles")
            .delete()
            .eq("workspace_id", workspace_id)
            .eq("user_id", targetUserId);
        }

        // Upsert new system roles
        for (const sRole of newSysRoles) {
          await supabaseAdmin.from("user_system_roles").upsert(
            {
              workspace_id: workspace_id,
              user_id: targetUserId,
              role: sRole,
              created_by: callerUser.id,
            },
            { onConflict: "workspace_id,user_id,role" }
          );
        }
      }

      return new Response(
        JSON.stringify({
          success: true,
          message: "User updated successfully",
          user_id: targetUserId,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ error: `Invalid action '${action}'. Expected 'invite' or 'update'` }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
