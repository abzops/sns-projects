// ============================================================================
// Supabase Edge Function: admin-manage-workspace-user
// Actions: provision (primary), complete_first_login, get_onboarding_status,
//          reissue_temp_password, update, invite (deprecated)
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

// PostgreSQL error code for unique constraint violation
const PG_UNIQUE_VIOLATION = "23505";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface DepartmentAssignment {
  department_id: string;
  role: "head" | "lead" | "member";
  is_primary: boolean;
}

interface RequestPayload {
  action:
    | "provision"
    | "complete_first_login"
    | "get_onboarding_status"
    | "reissue_temp_password"
    | "invite"
    | "update";
  workspace_id: string;
  user_id?: string;
  new_password?: string;
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
// Password complexity validator (server-side enforcement)
// Minimum 12 characters, >=1 uppercase, >=1 lowercase, >=1 digit, >=1 special
// ---------------------------------------------------------------------------
function validatePasswordComplexity(password: string): string | null {
  if (!password || password.length < 12) {
    return "Password must be at least 12 characters long";
  }
  if (!/[A-Z]/.test(password)) {
    return "Password must contain at least one uppercase letter";
  }
  if (!/[a-z]/.test(password)) {
    return "Password must contain at least one lowercase letter";
  }
  if (!/[0-9]/.test(password)) {
    return "Password must contain at least one number";
  }
  if (!/[!@#$%^&*()_+~|}{[\]:;?><,.\-=]/.test(password)) {
    return "Password must contain at least one special character";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Cryptographically secure temporary password generator (server-side only)
// Generates 18 characters containing uppercase, lowercase, digit, and symbol.
// Never stored in DB, never logged, never persisted.
// ---------------------------------------------------------------------------
function generateTemporaryPassword(): string {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // omit ambiguous I, O
  const lower = "abcdefghijkmnopqrstuvwxyz"; // omit ambiguous l
  const digits = "23456789"; // omit ambiguous 0, 1
  const symbols = "!@#$%^&*()_+~|}{[]:;?><,.-=";
  const all = upper + lower + digits + symbols;

  const buf = new Uint8Array(18);
  crypto.getRandomValues(buf);

  // Guarantee at least one of each class in first 4 positions
  const chars: string[] = [
    upper[buf[0] % upper.length],
    lower[buf[1] % lower.length],
    digits[buf[2] % digits.length],
    symbols[buf[3] % symbols.length],
  ];

  for (let i = 4; i < 18; i++) {
    chars.push(all[buf[i] % all.length]);
  }

  // Shuffle using Fisher-Yates with crypto randomness
  const shuffleBuf = new Uint8Array(chars.length);
  crypto.getRandomValues(shuffleBuf);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = shuffleBuf[i] % (i + 1);
    const temp = chars[i];
    chars[i] = chars[j];
    chars[j] = temp;
  }

  return chars.join("");
}

// ---------------------------------------------------------------------------
// Paginated user lookup by email — safe for growing user bases
// ---------------------------------------------------------------------------
async function findAuthUserByEmail(
  supabaseAdmin: ReturnType<typeof createClient>,
  email: string,
): Promise<{ id: string; last_sign_in_at?: string | null; app_metadata?: Record<string, unknown> } | null> {
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
      return {
        id: found.id,
        last_sign_in_at: found.last_sign_in_at,
        app_metadata: found.app_metadata,
      };
    }

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

    // =========================================================================
    // ACTION: GET_ONBOARDING_STATUS (CALLER-ONLY)
    // Returns fresh authoritative membership and password setup status for caller.
    // Executes BEFORE administrative checks so any authenticated user can check their state.
    // =========================================================================
    if (action === "get_onboarding_status") {
      const { data: callerMembership, error: memErr } = await supabaseAdmin
        .from("workspace_members")
        .select("id, role, status")
        .eq("workspace_id", workspace_id)
        .eq("user_id", callerUser.id)
        .maybeSingle();

      if (memErr) {
        return new Response(
          JSON.stringify({ error: "Failed to verify membership status" }),
          {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      const { data: freshUser, error: freshErr } =
        await supabaseAdmin.auth.admin.getUserById(callerUser.id);

      if (freshErr || !freshUser?.user) {
        return new Response(
          JSON.stringify({ error: "Failed to retrieve user account state" }),
          {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      const mustChange =
        freshUser.user.app_metadata?.must_change_password === true;

      return new Response(
        JSON.stringify({
          success: true,
          membership_status: callerMembership ? callerMembership.status : "none",
          workspace_role: callerMembership ? callerMembership.role : null,
          must_change_password: mustChange,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // =========================================================================
    // ACTION: COMPLETE_FIRST_LOGIN (CALLER-ONLY, SERVER-ENFORCED PASSWORD CHANGE)
    // Operates ONLY on the authenticated caller (callerUser.id).
    // NEVER accepts user_id from body.
    // Requires new_password and validates complexity server-side.
    // Updates password server-side BEFORE activating workspace membership.
    // =========================================================================
    if (action === "complete_first_login") {
      const newPassword = body.new_password;

      if (!newPassword) {
        return new Response(
          JSON.stringify({
            error: "Validation error: 'new_password' is required to complete first-login setup",
          }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      // Server-side password complexity validation
      const complexityError = validatePasswordComplexity(newPassword);
      if (complexityError) {
        return new Response(
          JSON.stringify({
            error: `Validation error: ${complexityError}`,
          }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      // Find caller's workspace membership
      const { data: callerMembership, error: memErr } = await supabaseAdmin
        .from("workspace_members")
        .select("id, role, status")
        .eq("workspace_id", workspace_id)
        .eq("user_id", callerUser.id)
        .maybeSingle();

      if (memErr) {
        return new Response(
          JSON.stringify({ error: "Failed to verify membership status" }),
          {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      if (!callerMembership) {
        return new Response(
          JSON.stringify({ error: "You are not a member of this workspace" }),
          {
            status: 404,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      // Read fresh user record from Auth
      const { data: freshUser, error: freshErr } =
        await supabaseAdmin.auth.admin.getUserById(callerUser.id);

      if (freshErr || !freshUser?.user) {
        return new Response(
          JSON.stringify({ error: "Failed to retrieve user account state" }),
          {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      // Idempotency: If already active and must_change_password is false, return success
      const currentMustChange =
        freshUser.user.app_metadata?.must_change_password;
      if (callerMembership.status === "active" && currentMustChange === false) {
        return new Response(
          JSON.stringify({
            success: true,
            message: "Account already active",
            status: "active",
          }),
          {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      try {
        // Step 1: Server-side password update + app_metadata change (MUST SUCCEED FIRST)
        const { error: updateAuthErr } =
          await supabaseAdmin.auth.admin.updateUserById(callerUser.id, {
            password: newPassword,
            app_metadata: {
              ...(freshUser.user.app_metadata || {}),
              must_change_password: false,
            },
          });

        if (updateAuthErr) {
          throw new Error(
            `Failed to update password: ${updateAuthErr.message}`,
          );
        }

        // Step 2: ONLY after password update succeeds -> activate workspace membership
        const { error: updateMemberErr } = await supabaseAdmin
          .from("workspace_members")
          .update({ status: "active" })
          .eq("id", callerMembership.id);

        if (updateMemberErr) {
          console.error(
            `[admin-manage-workspace-user] Password updated but membership activation failed for user ${callerUser.id}: ${updateMemberErr.message}`,
          );
          return new Response(
            JSON.stringify({
              error:
                "Password updated, but account activation could not be completed. Please retry.",
            }),
            {
              status: 500,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            },
          );
        }

        return new Response(
          JSON.stringify({
            success: true,
            message:
              "First login completed successfully. Welcome to SNS Projects!",
            status: "active",
          }),
          {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      } catch (activationErr: unknown) {
        const msg =
          activationErr instanceof Error
            ? activationErr.message
            : "Activation failed";
        console.error(
          `[admin-manage-workspace-user] complete_first_login failed: ${msg}`,
        );
        return new Response(
          JSON.stringify({ error: msg }),
          {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }
    }

    // -------------------------------------------------------------------------
    // 5. DB-backed caller authorization for administrative actions
    //    (provision, reissue_temp_password, invite, update)
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

      return null;
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
    // ACTION: PROVISION (STANDARD EMPLOYEE ONBOARDING FLOW)
    // Directly creates Supabase Auth account with temporary password & email_confirm: true.
    // Membership status starts as 'pending'. User must complete first-login password reset.
    // If Auth user already exists: returns 409 (does NOT silently reset existing users).
    // =========================================================================
    if (action === "provision") {
      const email = body.email?.trim().toLowerCase();
      const fullName = body.full_name?.trim();
      const workspaceRole = body.workspace_role || "member";

      if (!email || !fullName) {
        return new Response(
          JSON.stringify({
            error:
              "Validation error: 'email' and 'full_name' are required for user provisioning",
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

      // Workspace Admin cannot provision an admin
      if (
        workspaceRole === "admin" &&
        !isCallerOwner &&
        !isCallerSystemAdmin
      ) {
        return new Response(
          JSON.stringify({
            error:
              "Forbidden: Workspace administrators cannot provision other administrators",
          }),
          {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      // --- PRIMARY DEPARTMENT INVARIANT ---
      if (!body.departments || !Array.isArray(body.departments)) {
        return new Response(
          JSON.stringify({
            error:
              "Validation error: 'departments' is required for provisioning and must be an array",
          }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      const deptValidErr = await validateDepartments(body.departments);
      if (deptValidErr) return deptValidErr;

      // System roles validation
      if (body.system_roles && body.system_roles.length > 0) {
        const srErr = validateSystemRoles(body.system_roles);
        if (srErr) return srErr;
      }

      // Check if user already exists in Auth — DO NOT silently reset or overwrite
      const existingAuthUser = await findAuthUserByEmail(
        supabaseAdmin,
        email,
      );

      if (existingAuthUser) {
        return new Response(
          JSON.stringify({
            error: "An authentication account already exists for this email.",
          }),
          {
            status: 409,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      // Generate secure temporary password (server-side only, 18 chars)
      const temporaryPassword = generateTemporaryPassword();

      let targetUserId: string;
      const orgRowsCreatedDuringRequest: {
        table: string;
        filter: Record<string, string>;
      }[] = [];

      // Create brand-new Auth user with temporary password and email_confirm: true
      const { data: createData, error: createErr } =
        await supabaseAdmin.auth.admin.createUser({
          email,
          password: temporaryPassword,
          email_confirm: true,
          user_metadata: { full_name: fullName },
          app_metadata: { must_change_password: true },
        });

      if (createErr || !createData?.user) {
        return new Response(
          JSON.stringify({
            error:
              createErr?.message || "Failed to create authentication user",
          }),
          {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      targetUserId = createData.user.id;

      // Cleanup helper for partial failure
      async function cleanupOnFailure(reason: string): Promise<void> {
        console.error(`[admin-manage-workspace-user] Provision rollback: ${reason}`);
        try {
          for (const row of [...orgRowsCreatedDuringRequest].reverse()) {
            const deleteQuery = supabaseAdmin.from(row.table).delete();
            let q = deleteQuery;
            for (const [col, val] of Object.entries(row.filter)) {
              q = (q as ReturnType<typeof supabaseAdmin.from>).eq(col, val);
            }
            await q;
          }
          await supabaseAdmin.auth.admin.deleteUser(targetUserId);
        } catch (cleanupErr: unknown) {
          const msg = cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr);
          console.error(`[admin-manage-workspace-user] Cleanup partial failure: ${msg}`);
        }
      }

      try {
        // 1. Profile upsert (fail-closed)
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

        // 2. Workspace membership: status MUST be 'pending' until first login completed
        const { data: insertedWm, error: wmInsErr } = await supabaseAdmin
          .from("workspace_members")
          .insert({
            workspace_id: workspace_id,
            user_id: targetUserId,
            invited_email: email,
            role: workspaceRole,
            status: "pending", // CRITICAL: starts pending
            invited_by: callerUser.id,
          })
          .select()
          .single();

        if (wmInsErr) {
          if (wmInsErr.code === PG_UNIQUE_VIOLATION) {
            return new Response(
              JSON.stringify({
                error:
                  "User is already a member or has a pending membership in this workspace.",
              }),
              {
                status: 409,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
              },
            );
          }
          throw new Error(`Database write failed [workspace_members insert]: ${wmInsErr.code ?? "unknown"}`);
        }

        const memberRecord = insertedWm;
        orgRowsCreatedDuringRequest.push({
          table: "workspace_members",
          filter: { workspace_id: workspace_id, user_id: targetUserId },
        });

        // 3. Department memberships (fail-closed)
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
          orgRowsCreatedDuringRequest.push({
            table: "department_memberships",
            filter: { department_id: dept.department_id, user_id: targetUserId },
          });
        }

        // 4. System roles (fail-closed)
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
            orgRowsCreatedDuringRequest.push({
              table: "user_system_roles",
              filter: { workspace_id: workspace_id, user_id: targetUserId, role: sRole },
            });
          }
        }

        // Return temporary password ONCE in response payload only. Never stored or logged.
        return new Response(
          JSON.stringify({
            success: true,
            message: "User provisioned successfully with temporary password",
            user_id: targetUserId,
            temporary_password: temporaryPassword,
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
    // ACTION: REISSUE_TEMP_PASSWORD (ADMINISTRATIVE ACTION FOR PENDING USERS)
    // Generates a new temporary password for a pending employee and sets
    // app_metadata.must_change_password = true.
    // Does NOT alter workspace role, departments, or system roles.
    // V1 restriction: Allowed ONLY for workspace_members.status = 'pending'.
    // =========================================================================
    if (action === "reissue_temp_password") {
      const targetUserId = body.user_id;

      if (!targetUserId) {
        return new Response(
          JSON.stringify({
            error: "Validation error: 'user_id' is required to reissue temporary password",
          }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      // Check target workspace membership
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

      // V1 Restriction: Reissue is ONLY permitted for pending members
      if (targetMember.status !== "pending") {
        return new Response(
          JSON.stringify({
            error:
              "Reissue temporary password is only permitted for pending members. Active members must use normal password reset.",
          }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      // Owner and Admin protection: Workspace Admin cannot reset Owner or other Admins
      if (!isCallerOwner && !isCallerSystemAdmin) {
        if (targetMember.role === "owner" || targetMember.role === "admin") {
          return new Response(
            JSON.stringify({
              error:
                "Forbidden: Workspace administrators cannot reissue passwords for owners or other administrators",
            }),
            {
              status: 403,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            },
          );
        }
      }

      // Read fresh target user
      const { data: freshTargetUser, error: freshTargetErr } =
        await supabaseAdmin.auth.admin.getUserById(targetUserId);

      if (freshTargetErr || !freshTargetUser?.user) {
        return new Response(
          JSON.stringify({
            error: "Target authentication user not found",
          }),
          {
            status: 404,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      // Generate new secure temporary password
      const newTemporaryPassword = generateTemporaryPassword();

      // Update Auth credentials
      const { error: updateAuthErr } =
        await supabaseAdmin.auth.admin.updateUserById(targetUserId, {
          password: newTemporaryPassword,
          email_confirm: true,
          app_metadata: {
            ...(freshTargetUser.user.app_metadata || {}),
            must_change_password: true,
          },
        });

      if (updateAuthErr) {
        return new Response(
          JSON.stringify({
            error: `Failed to update user credentials: ${updateAuthErr.message}`,
          }),
          {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      return new Response(
        JSON.stringify({
          success: true,
          message: "Temporary password reissued successfully",
          user_id: targetUserId,
          temporary_password: newTemporaryPassword,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // =========================================================================
    // ACTION: INVITE (DEPRECATED — SNS onboarding uses provision/temp-password flow)
    // Retained for backward compatibility. Do not use for new SNS employee onboarding.
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

      if (body.system_roles && body.system_roles.length > 0) {
        const srErr = validateSystemRoles(body.system_roles);
        if (srErr) return srErr;
      }

      let targetUserId: string;
      let wasNewAuthUser = false;
      const orgRowsCreatedDuringRequest: {
        table: string;
        filter: Record<string, string>;
      }[] = [];

      const existingAuthUser = await findAuthUserByEmail(
        supabaseAdmin,
        email,
      );

      if (existingAuthUser) {
        targetUserId = existingAuthUser.id;
        wasNewAuthUser = false;
      } else {
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

      const { data: existingMembership, error: memberLookupErr } =
        await supabaseAdmin
          .from("workspace_members")
          .select("id, role, status")
          .eq("workspace_id", workspace_id)
          .eq("user_id", targetUserId)
          .maybeSingle();

      if (memberLookupErr) {
        return new Response(
          JSON.stringify({
            error: "Failed to verify workspace membership. Please retry.",
          }),
          {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      if (existingMembership) {
        return new Response(
          JSON.stringify({
            error:
              "User is already a member of this workspace. Use Edit Member instead.",
          }),
          {
            status: 409,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      async function cleanupOnFailure(reason: string): Promise<void> {
        console.error(`[admin-manage-workspace-user] Invite rollback: ${reason}`);
        try {
          for (const row of [...orgRowsCreatedDuringRequest].reverse()) {
            const deleteQuery = supabaseAdmin.from(row.table).delete();
            let q = deleteQuery;
            for (const [col, val] of Object.entries(row.filter)) {
              q = (q as ReturnType<typeof supabaseAdmin.from>).eq(col, val);
            }
            await q;
          }
          if (wasNewAuthUser) {
            await supabaseAdmin.auth.admin.deleteUser(targetUserId);
          }
        } catch (cleanupErr: unknown) {
          const msg = cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr);
          console.error(`[admin-manage-workspace-user] Cleanup partial failure: ${msg}`);
        }
      }

      try {
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

        const { data: memberRecord, error: memberErr } = await supabaseAdmin
          .from("workspace_members")
          .insert({
            workspace_id: workspace_id,
            user_id: targetUserId,
            invited_email: email,
            role: workspaceRole,
            status: existingAuthUser?.last_sign_in_at ? "active" : "pending",
            invited_by: callerUser.id,
          })
          .select()
          .single();

        if (memberErr) {
          if (memberErr.code === PG_UNIQUE_VIOLATION) {
            return new Response(
              JSON.stringify({
                error:
                  "User is already a member or has a pending membership in this workspace.",
              }),
              {
                status: 409,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
              },
            );
          }
          throw new Error(`Database write failed [workspace_members insert]: ${memberErr.code ?? "unknown"}`);
        }

        if (wasNewAuthUser) {
          orgRowsCreatedDuringRequest.push({
            table: "workspace_members",
            filter: { workspace_id: workspace_id, user_id: targetUserId },
          });
        }

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
              filter: { department_id: dept.department_id, user_id: targetUserId },
            });
          }
        }

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
                filter: { workspace_id: workspace_id, user_id: targetUserId, role: sRole },
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

        // Department sync
        if (body.departments !== undefined) {
          const newDeptIds = body.departments.map((d) => d.department_id);

          const { error: delDeptErr } = await supabaseAdmin
            .from("department_memberships")
            .delete()
            .eq("workspace_id", workspace_id)
            .eq("user_id", targetUserId)
            .not("department_id", "in", `(${newDeptIds.join(",")})`);
          assertNoError(delDeptErr, "department_memberships delete");

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

        // System roles sync
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
        error: `Invalid action '${action}'. Expected 'provision', 'complete_first_login', 'get_onboarding_status', 'reissue_temp_password', or 'update'`,
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
