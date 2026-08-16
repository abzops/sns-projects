// ============================================================================
// Supabase Edge Function: manage-defined-process-draft
// Action: save_draft
// Security: Server-side only, JWT validated (platform + function-level),
//           DB-backed caller authorization, atomic service_role RPC invocation
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

interface StepRaciInput {
  raci_role: "R" | "A" | "C" | "I";
  actor_type?: "user" | "process_starter";
  user_id?: string | null;
  response_required?: boolean;
}

interface StepInput {
  id?: string;
  step_code: string;
  title: string;
  description?: string;
  sequence_order?: number;
  expected_duration_days?: number;
  approval_required?: boolean;
  consultation_required?: boolean;
  evidence_required?: boolean;
  raci?: StepRaciInput[];
}

interface RequestPayload {
  action: "save_draft";
  workspace_id: string;
  process_id?: string | null;
  version_id?: string | null;
  base_updated_at?: string | null;
  process: {
    name: string;
    code: string;
    description?: string | null;
    department_id: string;
    process_owner_id: string;
  };
  steps: StepInput[];
}

serve(async (req: Request) => {
  const corsHeaders = buildCorsHeaders(req.headers.get("Origin"));

  // Handle preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    if (!supabaseUrl || !supabaseServiceKey) {
      return new Response(
        JSON.stringify({ error: "Server configuration error" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // 1. Function-level JWT authentication
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing Authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const token = authHeader.replace(/^Bearer\s+/i, "");
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: { user: callerUser }, error: userAuthError } = await userClient.auth.getUser();
    if (userAuthError || !callerUser) {
      return new Response(
        JSON.stringify({ error: "Unauthorized: Invalid or expired session token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // 2. Parse request payload
    let body: RequestPayload;
    try {
      body = (await req.json()) as RequestPayload;
    } catch {
      return new Response(
        JSON.stringify({ error: "Invalid JSON body" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!body || body.action !== "save_draft") {
      return new Response(
        JSON.stringify({ error: "Unsupported or missing action" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!body.workspace_id) {
      return new Response(
        JSON.stringify({ error: "workspace_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!body.process || !body.process.name || !body.process.code) {
      return new Response(
        JSON.stringify({ error: "Process name and code are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // 3. Service role admin client for database RPC
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // 4. Call service-role-only database write procedure
    // Note: p_actor_id is strictly derived from validated callerUser.id
    const { data: rpcResult, error: rpcError } = await supabaseAdmin.rpc(
      "save_defined_process_draft",
      {
        p_workspace_id: body.workspace_id,
        p_actor_id: callerUser.id,
        p_payload: body,
      },
    );

    if (rpcError) {
      const errMsg = rpcError.message || "Failed to save defined process draft";

      if (errMsg.includes("DRAFT_CONCURRENCY_CONFLICT")) {
        return new Response(
          JSON.stringify({
            error: "This draft changed since you opened it. Reload before saving.",
            code: "CONCURRENCY_CONFLICT",
          }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      if (errMsg.includes("ERR_CONFLICT_CODE")) {
        return new Response(
          JSON.stringify({
            error: "Process code already exists in this workspace.",
            code: "CODE_CONFLICT",
          }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      if (errMsg.includes("ERR_CONFLICT_NAME")) {
        return new Response(
          JSON.stringify({
            error: "Process name already exists in this workspace.",
            code: "NAME_CONFLICT",
          }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      if (errMsg.includes("ERR_FORBIDDEN")) {
        return new Response(
          JSON.stringify({
            error: errMsg.replace(/^.*ERR_FORBIDDEN:\s*/, ""),
            code: "FORBIDDEN",
          }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      if (errMsg.includes("ERR_CUSTOM_DAG_STRUCTURAL_LOCK")) {
        return new Response(
          JSON.stringify({
            error:
              "This process uses a custom dependency flow. Structural step addition, deletion, or reordering cannot be performed in V1-03A.",
            code: "CUSTOM_DAG_LOCKED",
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      if (errMsg.includes("ERR_VALIDATION")) {
        return new Response(
          JSON.stringify({
            error: errMsg.replace(/^.*ERR_VALIDATION:\s*/, ""),
            code: "VALIDATION_ERROR",
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      return new Response(
        JSON.stringify({ error: errMsg }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        process_id: rpcResult?.process_id,
        version_id: rpcResult?.version_id,
        updated_at: rpcResult?.updated_at,
        message: "Draft saved successfully",
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : "Internal Server Error";
    return new Response(
      JSON.stringify({ error: errorMsg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
