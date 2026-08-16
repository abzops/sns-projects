// ============================================================================
// Supabase Edge Function: admin-manage-workspace-user
// Actions: invite, update
// Security: Server-side only, JWT validated (platform + function-level),
//           DB-backed caller authorization, no user_metadata trust
// ============================================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";

// ---------------------------------------------------------------------------
// CORS — per-origin, hardened for production + local development
// ---------------------------------------------------------------------------
const ALLOWED_ORIGINS = new Set([
  "https://abzops.github.io",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
]);

function buildCorsHeaders(requestOrigin: string | null): Record<string, string> {
  const origin =
    requestOrigin && ALLOWED_ORIGINS.has(requestOrigin)
      ? requestOrigin
      : "https://abzops.github.io"; // safe fallback — not a wildcard
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

// ---------------------------------------------------------------------------
// Role constants
// ---------------------------------------------------------------------------
const VALID_WORKSPACE_ROLES = ["admin", "member", "viewer"] as const;
const VALID_DEPT_ROLES = ["head", "lead", "member"] as const;
const VALID_SYSTEM_ROLES = [
  "ceo",
  "cto",
  "project_admin",
  "system_admin",
] as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Fail-closed DB write helper
// Throws an Error (non-sensitive message) if the write produced an error.
// Never logs secrets.
// ---------------------------------------------------------------------------
function assertNoError(
  error: { message?: string; code?: string } | null | undefined,
  context: string,
): void {
  if (error) {
    throw new Error(`Database write failed [${context}]: ${error.code ?? "unknown"}`);
  }
}

// ---------------------------------------------------------------------------
// Paginated user lookup by email — safe for growing user bases
// ---------------------------------------------------------------------------
async function findAuthUserByEmail(
  supabaseAdmin: ReturnType<typeof createClient>,
  email: string,
): Promise<{ id: string; last_sign_in_at?: string | null } | null> {
  const pageSize = 1000;
  let page = 1;

  while (true) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({
      page,
      perPage: pageSize,
    });

    if (error || !data?.users) break;

    const found = data.users.find(
      (u) => u.email?.toLowerCase() === email,
    );
    if (found) {
      return { id: found.id, last_sign_in_at: found.last_sign_in_at };
    }

    // If this page returned fewer results than the page size, we have exhausted all pages
    if (data.users.length < pageSize) break;

    page++;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------
serve(async (req: Request) => {
  const requestOrigin = req.headers.get("Origin");
  const corsHeaders = buildCorsHeaders(requestOrigin);

  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // -------------------------------------------------------------------------
    // 1. Extract and validate Authorization header
    // -------------------------------------------------------------------------
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing Authorization header" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // -------------------------------------------------------------------------
    // 2. Validate environment variables
    // -------------------------------------------------------------------------
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const supabaseServiceRoleKey =
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    if (!supabaseUrl || !supabaseServiceRoleKey) {
      return new Response(
        JSON.stringify({
          error:
            "Server misconfiguration: missing required Supabase environment variables",
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // -------------------------------------------------------------------------
    // 3. Authenticate caller (function-level JWT check — in addition to platform verify_jwt)
    // -------------------------------------------------------------------------
    const supabaseAuthClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });

    const {
      data: { user: callerUser },
      error: userError,
    } = await supabaseAuthClient.auth.getUser();

    if (userError || !callerUser) {
      return new Response(
        JSON.stringify({
          error: "Unauthorized: Invalid or expired authentication token",
        }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Admin client — service-role key kept strictly server-side
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // -------------------------------------------------------------------------
    // 4. Parse body
    // -------------------------------------------------------------------------
    const body: RequestPayload = await req.json();
    const { action, workspace_id } = body;

    if (!action || !workspace_id) {
      return new Response(
        JSON.stringify({
          error: "Missing required fields: 'action' and 'workspace_id'",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // -------------------------------------------------------------------------
    // 5. DB-backed caller authorization — never trusts user_metadata
    // -------------------------------------------------------------------------
    const { data: callerMember, error: callerMemberErr } = await supabaseAdmin
      .from("workspace_members")
      .select("role, status")
      .eq("workspace_id", workspace_id)
      .eq("user_id", callerUser.id)
      .eq("status", "active")
      .maybeSingle();

    if (callerMemberErr || !callerMember) {
      return new Response(
        JSON.stringify({
          error: "Forbidden: Caller is not an active member of this workspace",
        }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const { data: callerSysRoles } = await supabaseAdmin
      .from("user_system_roles")
      .select("role")
      .eq("workspace_id", workspace_id)
      .eq("user_id", callerUser.id);

    const callerRolesList = (callerSysRoles || []).map(
      (r: { role: string }) => r.role,
    );
    const isCallerOwner = callerMember.role === "owner";
    const isCallerSystemAdmin = callerRolesList.includes("system_admin");
    const isCallerWorkspaceAdmin = callerMember.role === "admin";

    // CEO, CTO, project_admin alone do NOT grant org-admin access
    const hasAdminAccess =
      isCallerOwner || isCallerSystemAdmin || isCallerWorkspaceAdmin;
    if (!hasAdminAccess) {
      return new Response(
        JSON.stringify({
          error:
            "Forbidden: Insufficient privileges for organization administration",
        }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // -------------------------------------------------------------------------
    // 6. Shared department validation helper
    //    (used by both invite and update after action-specific rules)
    // -------------------------------------------------------------------------
    async function validateDepartments(
      depts: DepartmentAssignment[],
    ): Promise<Response | null> {
      if (depts.length === 0) {
        return new Response(
          JSON.stringify({
            error:
              "Validation error: departments must contain at least one entry",
          }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      const primaryCount = depts.filter((d) => d.is_primary).length;
      if (primaryCount !== 1) {
        return new Response(
          JSON.stringify({
            error:
              "Validation error: Exactly one primary department must be designated",
          }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      for (const d of depts) {
        if (!VALID_DEPT_ROLES.includes(d.role)) {
          return new Response(
            JSON.stringify({
              error: `Validation error: Invalid department role '${d.role}'`,
            }),
            {
              status: 400,
              headers: {
                ...corsHeaders,
                "Content-Type": "application/json",
              },
            },
          );
        }
      }

      const deptIds = depts.map((d) => d.department_id);
      const { data: validDepts, error: deptErr } = await supabaseAdmin
        .from("departments")
        .select("id")
        .eq("workspace_id", workspace_id)
        .in("id", deptIds);

      if (deptErr || !validDepts || validDepts.length !== deptIds.length) {
        return new Response(
          JSON.stringify({
            error:
              "Validation error: One or more departments do not belong to this workspace",
          }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      return null; // no error
    }

    // -------------------------------------------------------------------------
    // 7. System roles validation helper
    // -------------------------------------------------------------------------
    function validateSystemRoles(sysRoles: string[]): Response | null {
      if (!isCallerOwner && !isCallerSystemAdmin) {
        return new Response(
          JSON.stringify({
            error:
              "Forbidden: Only workspace owners and system administrators can assign system roles",
          }),
          {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }
      for (const sr of sysRoles) {
        if (!VALID_SYSTEM_ROLES.includes(sr as typeof VALID_SYSTEM_ROLES[number])) {
          return new Response(
            JSON.stringify({
              error: `Validation error: Invalid system role '${sr}'`,
            }),
            {
              status: 400,
              headers: {
                ...corsHeaders,
                "Content-Type": "application/json",
              },
            },
          );
        }
      }
      return null;
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
          JSON.stringify({
            error:
              "Validation error: 'email' and 'full_name' are required for invitation",
          }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      if (!VALID_WORKSPACE_ROLES.includes(workspaceRole as typeof VALID_WORKSPACE_ROLES[number])) {
        return new Response(
          JSON.stringify({
            error: `Validation error: Invalid workspace role '${workspaceRole}'`,
          }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      // Workspace Admin cannot invite an admin
      if (
        workspaceRole === "admin" &&
        !isCallerOwner &&
        !isCallerSystemAdmin
      ) {
        return new Response(
          JSON.stringify({
            error:
              "Forbidden: Workspace administrators cannot create or invite other administrators",
          }),
          {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      // --- PRIMARY DEPARTMENT INVARIANT (invite) ---
      // departments is REQUIRED for invite; must have >= 1 with exactly one primary
      if (!body.departments || !Array.isArray(body.departments)) {
        return new Response(
          JSON.stringify({
            error:
              "Validation error: 'departments' is required for invitation and must be an array",
          }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      const deptValidErr = await validateDepartments(body.departments);
      if (deptValidErr) return deptValidErr;

      // System roles validation (if supplied)
      if (body.system_roles && body.system_roles.length > 0) {
        const srErr = validateSystemRoles(body.system_roles);
        if (srErr) return srErr;
      }

      // -----------------------------------------------------------------------
      // Invite execution with partial-failure cleanup
      // -----------------------------------------------------------------------
      let targetUserId: string;
      let wasNewAuthUser = false;
      const orgRowsCreatedDuringRequest: {
        table: string;
        filter: Record<string, string>;
      }[] = [];

      // Paginated existing-user lookup
      const existingAuthUser = await findAuthUserByEmail(
        supabaseAdmin,
        email,
      );

      if (existingAuthUser) {
        targetUserId = existingAuthUser.id;
        wasNewAuthUser = false;
      } else {
        // Create new Auth invitation
        const { data: inviteData, error: inviteErr } =
          await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
            data: { full_name: fullName },
            redirectTo: "https://abzops.github.io/sns-projects/",
          });

        if (inviteErr || !inviteData?.user) {
          return new Response(
            JSON.stringify({
              error:
                inviteErr?.message || "Failed to send auth invitation email",
            }),
            {
              status: 500,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            },
          );
        }

        targetUserId = inviteData.user.id;
        wasNewAuthUser = true;
      }

      // Cleanup helper for partial failure — only deletes newly created auth user
      async function cleanupOnFailure(reason: string): Promise<void> {
        console.error(`[admin-manage-workspace-user] Invite rollback: ${reason}`);
        try {
          // Delete org rows created during this request
          for (const row of orgRowsCreatedDuringRequest) {
            const query = supabaseAdmin.from(row.table).delete();
            let q = query;
            for (const [col, val] of Object.entries(row.filter)) {
              q = (q as ReturnType<typeof supabaseAdmin.from>).eq(col, val);
            }
            await q;
          }
          // Only delete the auth user if we created it in this request
          if (wasNewAuthUser) {
            await supabaseAdmin.auth.admin.deleteUser(targetUserId);
          }
        } catch (cleanupErr: unknown) {
          const msg = cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr);
          console.error(`[admin-manage-workspace-user] Cleanup partial failure: ${msg}`);
        }
      }

      try {
        // Profile upsert (fail-closed)
        const { error: profileErr } = await supabaseAdmin
          .from("profiles")
          .upsert(
            {
              id: targetUserId,
              full_name: fullName,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "id" },
          );
        assertNoError(profileErr, "profiles upsert");

        // Workspace member upsert (fail-closed)
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
            { onConflict: "workspace_id,user_id" },
          )
          .select()
          .single();
        assertNoError(memberErr, "workspace_members upsert");
        if (wasNewAuthUser) {
          orgRowsCreatedDuringRequest.push({
            table: "workspace_members",
            filter: {
              workspace_id: workspace_id,
              user_id: targetUserId,
            },
          });
        }

        // Department memberships (fail-closed)
        for (const dept of body.departments) {
          const { error: deptErr } = await supabaseAdmin
            .from("department_memberships")
            .upsert(
              {
                workspace_id: workspace_id,
                department_id: dept.department_id,
                user_id: targetUserId,
                role: dept.role,
                is_primary: dept.is_primary,
                is_active: true,
                updated_at: new Date().toISOString(),
              },
              { onConflict: "department_id,user_id" },
            );
          assertNoError(deptErr, "department_memberships upsert");
          if (wasNewAuthUser) {
            orgRowsCreatedDuringRequest.push({
              table: "department_memberships",
              filter: {
                department_id: dept.department_id,
                user_id: targetUserId,
              },
            });
          }
        }

        // System roles (fail-closed)
        if (
          body.system_roles &&
          body.system_roles.length > 0 &&
          (isCallerOwner || isCallerSystemAdmin)
        ) {
          for (const sRole of body.system_roles) {
            const { error: srErr } = await supabaseAdmin
              .from("user_system_roles")
              .upsert(
                {
                  workspace_id: workspace_id,
                  user_id: targetUserId,
                  role: sRole,
                  created_by: callerUser.id,
                },
                { onConflict: "workspace_id,user_id,role" },
              );
            assertNoError(srErr, "user_system_roles upsert");
            if (wasNewAuthUser) {
              orgRowsCreatedDuringRequest.push({
                table: "user_system_roles",
                filter: {
                  workspace_id: workspace_id,
                  user_id: targetUserId,
                  role: sRole,
                },
              });
            }
          }
        }

        return new Response(
          JSON.stringify({
            success: true,
            message: "User invitation created successfully",
            user_id: targetUserId,
            membership: memberRecord,
          }),
          {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      } catch (writeErr: unknown) {
        const msg =
          writeErr instanceof Error ? writeErr.message : "Database write failure";
        await cleanupOnFailure(msg);
        return new Response(
          JSON.stringify({ error: msg }),
          {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }
    }

    // =========================================================================
    // ACTION: UPDATE
    // =========================================================================
    if (action === "update") {
      const targetUserId = body.user_id;
      if (!targetUserId) {
        return new Response(
          JSON.stringify({
            error: "Validation error: 'user_id' is required for update",
          }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      // Fetch target member record
      const { data: targetMember, error: targetMemberErr } =
        await supabaseAdmin
          .from("workspace_members")
          .select("id, role, status")
          .eq("workspace_id", workspace_id)
          .eq("user_id", targetUserId)
          .maybeSingle();

      if (targetMemberErr || !targetMember) {
        return new Response(
          JSON.stringify({
            error: "Target user is not a member of this workspace",
          }),
          {
            status: 404,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      // Owner protection
      if (
        targetMember.role === "owner" &&
        body.workspace_role &&
        body.workspace_role !== "owner"
      ) {
        return new Response(
          JSON.stringify({
            error:
              "Forbidden: Workspace owner cannot be demoted or have their role altered",
          }),
          {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      // Workspace Admin privilege restrictions
      if (!isCallerOwner && !isCallerSystemAdmin) {
        if (
          body.workspace_role === "admin" ||
          body.workspace_role === "owner"
        ) {
          return new Response(
            JSON.stringify({
              error:
                "Forbidden: Workspace administrators cannot promote users to admin or owner",
            }),
            {
              status: 403,
              headers: {
                ...corsHeaders,
                "Content-Type": "application/json",
              },
            },
          );
        }
        if (targetMember.role === "admin") {
          return new Response(
            JSON.stringify({
              error:
                "Forbidden: Workspace administrators cannot modify other administrators",
            }),
            {
              status: 403,
              headers: {
                ...corsHeaders,
                "Content-Type": "application/json",
              },
            },
          );
        }
      }

      // --- PRIMARY DEPARTMENT INVARIANT (update) ---
      // If departments is supplied it must have >= 1 entry with exactly one primary.
      // If departments is omitted entirely, leave existing assignments unchanged.
      if (body.departments !== undefined) {
        if (!Array.isArray(body.departments)) {
          return new Response(
            JSON.stringify({
              error:
                "Validation error: 'departments' must be an array when provided",
            }),
            {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            },
          );
        }
        // departments: [] is explicitly rejected
        const deptValidErr = await validateDepartments(body.departments);
        if (deptValidErr) return deptValidErr;
      }

      // System roles validation
      if (body.system_roles && body.system_roles.length > 0) {
        const srErr = validateSystemRoles(body.system_roles);
        if (srErr) return srErr;
      }

      try {
        // Full name update (fail-closed)
        if (body.full_name && body.full_name.trim()) {
          const { error: profileErr } = await supabaseAdmin
            .from("profiles")
            .upsert(
              {
                id: targetUserId,
                full_name: body.full_name.trim(),
                updated_at: new Date().toISOString(),
              },
              { onConflict: "id" },
            );
          assertNoError(profileErr, "profiles upsert");
        }

        // Workspace role update (fail-closed)
        if (body.workspace_role && targetMember.role !== "owner") {
          if (
            !VALID_WORKSPACE_ROLES.includes(
              body.workspace_role as typeof VALID_WORKSPACE_ROLES[number],
            )
          ) {
            return new Response(
              JSON.stringify({
                error: `Validation error: Invalid workspace role '${body.workspace_role}'`,
              }),
              {
                status: 400,
                headers: {
                  ...corsHeaders,
                  "Content-Type": "application/json",
                },
              },
            );
          }
          const { error: wmErr } = await supabaseAdmin
            .from("workspace_members")
            .update({ role: body.workspace_role })
            .eq("id", targetMember.id);
          assertNoError(wmErr, "workspace_members update");
        }

        // Department sync (only if departments was supplied and passed validation)
        if (body.departments !== undefined) {
          const newDeptIds = body.departments.map((d) => d.department_id);

          // Remove old memberships not in new set (fail-closed)
          const { error: delDeptErr } = await supabaseAdmin
            .from("department_memberships")
            .delete()
            .eq("workspace_id", workspace_id)
            .eq("user_id", targetUserId)
            .not("department_id", "in", `(${newDeptIds.join(",")})`);
          assertNoError(delDeptErr, "department_memberships delete");

          // Upsert new memberships (fail-closed)
          for (const dept of body.departments) {
            const { error: deptErr } = await supabaseAdmin
              .from("department_memberships")
              .upsert(
                {
                  workspace_id: workspace_id,
                  department_id: dept.department_id,
                  user_id: targetUserId,
                  role: dept.role,
                  is_primary: dept.is_primary,
                  is_active: true,
                  updated_at: new Date().toISOString(),
                },
                { onConflict: "department_id,user_id" },
              );
            assertNoError(deptErr, "department_memberships upsert");
          }
        }

        // System roles sync (only if supplied and caller is authorized)
        if (body.system_roles !== undefined && (isCallerOwner || isCallerSystemAdmin)) {
          const newSysRoles = body.system_roles;

          if (newSysRoles.length > 0) {
            const { error: delSrErr } = await supabaseAdmin
              .from("user_system_roles")
              .delete()
              .eq("workspace_id", workspace_id)
              .eq("user_id", targetUserId)
              .not(
                "role",
                "in",
                `(${newSysRoles.map((r) => `'${r}'`).join(",")})`,
              );
            assertNoError(delSrErr, "user_system_roles delete (remove old)");
          } else {
            const { error: delAllSrErr } = await supabaseAdmin
              .from("user_system_roles")
              .delete()
              .eq("workspace_id", workspace_id)
              .eq("user_id", targetUserId);
            assertNoError(delAllSrErr, "user_system_roles delete (clear all)");
          }

          for (const sRole of newSysRoles) {
            const { error: srErr } = await supabaseAdmin
              .from("user_system_roles")
              .upsert(
                {
                  workspace_id: workspace_id,
                  user_id: targetUserId,
                  role: sRole,
                  created_by: callerUser.id,
                },
                { onConflict: "workspace_id,user_id,role" },
              );
            assertNoError(srErr, "user_system_roles upsert");
          }
        }

        return new Response(
          JSON.stringify({
            success: true,
            message: "User updated successfully",
            user_id: targetUserId,
          }),
          {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      } catch (writeErr: unknown) {
        const msg =
          writeErr instanceof Error ? writeErr.message : "Database write failure";
        console.error(`[admin-manage-workspace-user] Update write failure: ${msg}`);
        return new Response(
          JSON.stringify({ error: msg }),
          {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }
    }

    return new Response(
      JSON.stringify({
        error: `Invalid action '${action}'. Expected 'invite' or 'update'`,
      }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Internal server error";
    return new Response(
      JSON.stringify({ error: msg }),
      {
        status: 500,
        headers: {
          "Access-Control-Allow-Origin": "https://abzops.github.io",
          "Content-Type": "application/json",
        },
      },
    );
  }
});
