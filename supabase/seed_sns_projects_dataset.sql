-- ============================================================================
-- SNS Projects Dataset Import
-- ============================================================================
-- 1. Run supabase/schema.sql first.
-- 2. Sign up in the app once so your auth user and profile exist.
-- 3. Change target_user_email below to your login email.
-- 4. Run this file in the Supabase SQL Editor.
-- ============================================================================

DO $$
DECLARE
  target_user_email text := 'CHANGE_ME_TO_YOUR_LOGIN_EMAIL';
  target_workspace_name text := 'SNS Projects Dataset';
  target_user_id uuid;
  target_workspace_id uuid;
  current_project_name text;
  current_project_id uuid;
  current_status_name text;
  current_status_id uuid;
  task_position integer;
  dataset jsonb := $dataset$
[
  {"project_name":"ASRS Build","phase_milestone":"Operations And Procurement","task_list":"Operations & Procurement","task_name":"Zoho projects framework","subtask":"","assignee":"Samson Jose","status":"Not Started","priority":"Medium"},
  {"project_name":"ASRS Build","phase_milestone":"Operations And Procurement","task_list":"Operations & Procurement","task_name":"ISO Certification","subtask":"","assignee":"Samson Jose","status":"Not Started","priority":"Medium"},
  {"project_name":"ASRS Build","phase_milestone":"Operations And Procurement","task_list":"Operations & Procurement","task_name":"Plot Compliance","subtask":"","assignee":"Samson Jose","status":"Not Started","priority":"Medium"},
  {"project_name":"ASRS Build","phase_milestone":"Operations And Procurement","task_list":"Operations & Procurement","task_name":"Custom Bin Design and Cost Analysis","subtask":"","assignee":"Samson Jose","status":"Not Started","priority":"Medium"},
  {"project_name":"ASRS Build","phase_milestone":"Operations And Procurement","task_list":"Operations & Procurement","task_name":"Motherhub design assisting","subtask":"","assignee":"Samson Jose","status":"Not Started","priority":"Medium"},
  {"project_name":"ASRS Build","phase_milestone":"ASRS Proto Phase","task_list":"Mechanical Design","task_name":"Design ASRS System","subtask":"Design structure for  main carriage module","assignee":"Saravana","status":"Not Started","priority":"High"},
  {"project_name":"Business Planning","phase_milestone":"Planning","task_list":"Finance Strategy","task_name":"Financial Modelling","subtask":"Budgeting, pricing and business forecasting","assignee":"suryaith k m","status":"Not Started","priority":"Medium"},
  {"project_name":"Darkstore Ops","phase_milestone":"Operations And Procurement","task_list":"Operations & Procurement","task_name":"Procuring menial goods","subtask":"","assignee":"Samson Jose","status":"Not Started","priority":"Medium"},
  {"project_name":"Darkstore Ops","phase_milestone":"Stacknstock Software Systems","task_list":"Operations Digitization","task_name":"Prepare Brand Onboarding system requirements using eligibility scorecard, bin-fit rules, and required brand data","subtask":"1. Study the customer onboarding eligibility document; 2. List all data required from brands before commercials; 3. Define the eligibility scorecard fields and scoring logic; 4. Define SKU bin-fit validation rules based on size, weight, category, and handling type; 5. Define approval stages from discovery call to leadership approval; 6. Prepare onboarding form fields for ERPNext or custom onboarding module; 7. Review the onboarding requirement with commercial, operations, and leadership teams","assignee":"ABHINAND","status":"Not Started","priority":"High"},
  {"project_name":"Darkstore Ops","phase_milestone":"Stacknstock Software Systems","task_list":"Operations Digitization","task_name":"Prepare Node / Container workflow requirements for receiving, bin activation, clone bin logic, pick-pack, dispatch, and returns","subtask":"1. Map complete node receiving process; 2. Define node receipt scan and discrepancy handling workflow; 3. Define active, inactive, and clone bin activation rules; 4. Define order pick-pack workflow inside the node; 5. Define dispatch counter and delivery handoff process; 6. Define failed delivery hold and RTO trigger process; 7. Define empty bin, half-filled bin, and return movement back to Mother Hub; 8. Validate node workflow with operations and container team","assignee":"ABHINAND","status":"Not Started","priority":"High"},
  {"project_name":"Darkstore Ops","phase_milestone":"Development","task_list":"Operations","task_name":"Warehouse Process Improvement","subtask":"Improve workflow efficiency and deployment processes","assignee":"suryaith k m","status":"Not Started","priority":"Medium"},
  {"project_name":"Digital Systems","phase_milestone":"Stacknstock Software Systems","task_list":"Software Systems Research","task_name":"Create and maintain SNS ERP/WMS implementation tracker for all modules, owners, priorities, and status","subtask":"1. Create master tracker structure in Zoho Projects or Google Sheet; 2. Add module categories such as ERPNext, WMS, OMS, Control Tower, API, and Delivery; 3. Add task fields for owner, priority, status, dependency, due date, and approval status; 4. Enter all major SNS implementation tasks into the tracker; 5. Assign business owner and technical owner for each task; 6. Update task progress and blockers weekly; 7. Share tracker status with management and relevant teams","assignee":"ABHINAND","status":"Not Started","priority":"High"},
  {"project_name":"Digital Systems","phase_milestone":"Stacknstock Software Systems","task_list":"Software Systems Research","task_name":"Convert Mother Hub workflow headers into ERPNext, WMS, OMS, and Control Tower implementation tasks","subtask":"1. Review the complete Mother Hub flow header document; 2. Group each flow header under ERPNext, WMS, OMS, Control Tower, or Automation layer; 3. Mark each header as MVP, Phase 2, or future requirement; 4. Convert each process header into a clear implementation task; 5. Identify dependencies between receiving, GRN, QC, storage, replenishment, dispatch, returns, and billing; 6. Validate the task breakdown with operations and technical teams; 7. Add finalized tasks into Zoho Projects","assignee":"ABHINAND","status":"Not Started","priority":"High"},
  {"project_name":"Digital Systems","phase_milestone":"Stacknstock Software Systems","task_list":"Software Systems Research","task_name":"Define ERPNext scope for Brand Master, SKU Master, GRN, Stock Ledger, Stock Transfer, Billing, and Audit Logs","subtask":"1. List all master data required in ERPNext; 2. Define Brand Master fields including GST, contact, contract, SLA, and billing plan; 3. Define SKU Master fields including barcode, HSN, GST, dimensions, weight, batch, expiry, and handling rules; 4. Map inbound receiving and GRN process into ERPNext documents; 5. Define stock transfer process from Mother Hub to Node; 6. Define billing events that should generate invoices or charges; 7. Define audit log and role permission requirements; 8. Confirm ERPNext scope with ERP consultant or technical team","assignee":"ABHINAND","status":"Not Started","priority":"High"},
  {"project_name":"Digital Systems","phase_milestone":"Stacknstock Software Systems","task_list":"Software Systems Research","task_name":"Define Custom SNS WMS requirements for bin, tote, compartment, barcode scan, QC, replenishment, return, and damage workflows","subtask":"1. Define Bin Master, Tote Master, and Compartment Master requirements; 2. Define barcode scan events for receiving, putaway, filling, QC, loading, node receipt, and returns; 3. Define compartment allocation rules for SKU placement; 4. Define replenishment request and replenishment priority logic; 5. Define active, inactive, and clone bin workflow; 6. Define QC workflow for inbound, replenishment, return, and damaged items; 7. Define return grading and damage logging workflow; 8. Prepare WMS requirement document for development team","assignee":"ABHINAND","status":"Not Started","priority":"High"},
  {"project_name":"Digital Systems","phase_milestone":"Stacknstock Software Systems","task_list":"Software Systems Research","task_name":"Coordinate API integration requirements between ERPNext, SNS WMS, OMS, Control Tower, delivery partners, scanners, and ASRS systems","subtask":"1. Identify all systems that need API connection; 2. Create API integration map between ERPNext, WMS, OMS, Control Tower, delivery partner, scanner, and ASRS; 3. List required API events such as SKU creation, GRN approval, stock transfer, order picked, order packed, delivery handoff, return received, and billing event; 4. Define data ownership for each system; 5. Define which system creates, updates, and reads each data point; 6. Collect API documentation from ERPNext, delivery partners, scanner vendors, and ASRS vendors; 7. Coordinate with developers to finalize integration approach; 8. Track API development, testing, and approval status","assignee":"ABHINAND","status":"Not Started","priority":"High"},
  {"project_name":"Digital Systems","phase_milestone":"Stacknstock Software Systems","task_list":"Software Systems Research","task_name":"Create dashboard and reporting requirements for Mother Hub, Control Tower, SLA tracking, inventory accuracy, productivity, and billing events","subtask":"1. List dashboard users such as CEO, Operations Head, Mother Hub Manager, Node Manager, Finance, and Support; 2. Define key metrics for each dashboard user; 3. Include Mother Hub metrics such as GRN pending, QC queue, storage utilization, and replenishment waves; 4. Include Node metrics such as stock availability, active bins, clone bins, pending orders, and dispatch status; 5. Include SLA metrics such as 15-minute delivery eligibility, delayed orders, failed attempts, and RTO rate; 6. Include inventory metrics such as stock accuracy, stockout rate, cycle count variance, and replenishment compliance; 7. Include productivity metrics such as picks per hour, fills per hour, scans, errors, and shift performance; 8. Review dashboard requirements with management before development","assignee":"ABHINAND","status":"Not Started","priority":"High"},
  {"project_name":"Market Expansion","phase_milestone":"Planning","task_list":"Sales & Partnerships","task_name":"Customer & Partner Development","subtask":"Customer acquisition, proposals and partnerships","assignee":"suryaith k m","status":"Not Started","priority":"High"},
  {"project_name":"Production System","phase_milestone":"Development","task_list":"Manufacturing & Supply Chain","task_name":"Coordinate manufacturing of Storage Pod and Workstation Pod with vendors and internal teams.","subtask":"Confirm final drawings, specifications, and manufacturing scope for Storage Pod and Workstation Pod.; Share approved manufacturing documents with selected vendors or internal team.; Track vendor production start date, expected completion date, and current status.; Coordinate clarification calls between engineering, vendor, and manufacturing team.; Review manufacturing progress photos, videos, or inspection updates.; Escalate design mismatch, fabrication issues, or delay risks to Engineering/CTO.; Confirm completion readiness before dispatch or internal assembly handover.","assignee":"S SIVA SANKAR","status":"Not Started","priority":"High"},
  {"project_name":"Production System","phase_milestone":"Development","task_list":"Manufacturing & Supply Chain","task_name":"Track ASRS mechanical part sourcing, purchase orders, delivery status, and pending materials.","subtask":"Prepare ASRS mechanical sourcing list from BOM and engineering requirements.; Identify items already ordered, received, pending, or not yet sourced.; Track PO number, vendor name, ordered quantity, delivery date, and payment status.; Follow up with vendors for open PO delivery updates.; Mark long-lead or critical parts that can delay assembly.; Update pending material tracker after every purchase or delivery.; Report material availability status to Engineering and Manufacturing team.","assignee":"S SIVA SANKAR","status":"Not Started","priority":"High"},
  {"project_name":"Production System","phase_milestone":"Development","task_list":"Manufacturing & Supply Chain","task_name":"Verify received materials through GRN, quantity check, specification check, and issue reporting.","subtask":"Match received material against PO, invoice, and delivery challan.; Check quantity received against ordered quantity.; Verify basic specifications such as size, material, model, rating, finish, and part number.; Coordinate with Engineering or Quality team for technical inspection where required.; Create GRN after quantity and specification verification.; Record shortage, damage, wrong item, or quality issue.; Inform vendor and internal team for replacement, rework, or credit note action.; Store accepted material in the correct inventory/storage location.","assignee":"S SIVA SANKAR","status":"Not Started","priority":"High"},
  {"project_name":"Production System","phase_milestone":"Development","task_list":"Manufacturing & Supply Chain","task_name":"Manage vendor follow-ups for fabrication, machining, powder coating, bought-out parts, and delivery timelines.","subtask":"Maintain vendor-wise tracker for fabrication, machining, powder coating, and bought-out items.; Confirm committed delivery dates from each vendor.; Follow up regularly for production progress and dispatch status.; Collect photos, inspection notes, or completion confirmation before dispatch.; Track vendor delays and reasons for delay.; Escalate critical delays affecting assembly or pilot timeline.; Coordinate revised delivery dates and update the manufacturing tracker.; Close vendor follow-up once material is received and verified.","assignee":"S SIVA SANKAR","status":"Not Started","priority":"High"},
  {"project_name":"Production System","phase_milestone":"Development","task_list":"Manufacturing & Supply Chain","task_name":"Prepare manufacturing readiness tracker for pod assembly, including material availability and work sequence.","subtask":"Break pod assembly into major work stages such as frame, mechanical assembly, electrical integration, testing, and finishing.; Map required materials and components against each assembly stage.; Mark each item as available, pending, under inspection, or blocked.; Identify missing materials before assembly work starts.; Coordinate with Engineering for assembly sequence and priority order.; Track manpower, tools, fixtures, and space readiness.; Update readiness status before daily or weekly manufacturing review.; Highlight blockers that can affect assembly start or completion.","assignee":"S SIVA SANKAR","status":"Not Started","priority":"High"},
  {"project_name":"Production System","phase_milestone":"Development","task_list":"Manufacturing & Supply Chain","task_name":"Coordinate logistics for manufactured pod components from vendor location to assembly/site location.","subtask":"Confirm pickup location, delivery location, material dimensions, and approximate weight.; Decide transport mode based on size, urgency, safety, and cost.; Get freight quotation and approval where required.; Coordinate packing requirements with vendor to avoid damage during transit.; Share dispatch documents, invoice, e-way bill, and contact details where applicable.; Track vehicle pickup, transit status, and expected arrival.; Coordinate unloading manpower, equipment, and receiving team.; Verify received condition and report transit damage if any.","assignee":"S SIVA SANKAR","status":"Not Started","priority":"High"},
  {"project_name":"Production System","phase_milestone":"Development","task_list":"Manufacturing & Supply Chain","task_name":"Track assembly-stage issues, rework requirements, missing parts, and closure status.","subtask":"Record assembly issues raised by Engineering, Quality, or Manufacturing team.; Classify issue as missing part, wrong specification, fitment issue, damage, rework, or design clarification.; Assign responsible person or team for closure.; Define required action such as purchase, vendor replacement, machining, rework, or design approval.; Track target closure date and actual closure date.; Follow up until issue is resolved and verified.; Maintain issue history for future manufacturing improvement.; Report unresolved critical issues in manufacturing review.","assignee":"S SIVA SANKAR","status":"Not Started","priority":"High"},
  {"project_name":"Production System","phase_milestone":"Development","task_list":"Manufacturing & Supply Chain","task_name":"Maintain supply chain dashboard covering open POs, vendor delays, lead times, freight cost, and critical items.","subtask":"Prepare dashboard structure with open POs, received items, pending items, vendor delays, and critical materials.; Update PO status, delivery status, and vendor commitment dates.; Track actual lead time versus expected lead time for key items.; Track freight cost against each PO or shipment wherever available.; Highlight critical items that can delay assembly, testing, or deployment.; Summarize vendor performance based on delay, quality issue, and responsiveness.; Create visual charts for open PO value, pending materials, delayed vendors, and critical items.; Share dashboard summary with Manufacturing, Engineering, Finance, and Management.","assignee":"S SIVA SANKAR","status":"Not Started","priority":"High"}
]
$dataset$::jsonb;
  dataset_row jsonb;
BEGIN
  SELECT id
  INTO target_user_id
  FROM auth.users
  WHERE email = target_user_email
  LIMIT 1;

  IF target_user_id IS NULL THEN
    RAISE EXCEPTION 'No auth user found for %. Sign up in the app first, then update target_user_email.', target_user_email;
  END IF;

  INSERT INTO public.workspaces (name, created_by)
  VALUES (target_workspace_name, target_user_id)
  RETURNING id INTO target_workspace_id;

  INSERT INTO public.workspace_members (workspace_id, user_id, role, status, invited_by)
  VALUES (target_workspace_id, target_user_id, 'owner', 'active', target_user_id);

  CREATE TEMP TABLE tmp_sns_project_map (
    project_name text PRIMARY KEY,
    project_id uuid NOT NULL,
    next_position integer NOT NULL DEFAULT 0
  ) ON COMMIT DROP;

  FOR current_project_name IN
    SELECT DISTINCT value ->> 'project_name'
    FROM jsonb_array_elements(dataset)
    ORDER BY 1
  LOOP
    INSERT INTO public.projects (workspace_id, name, description, color, created_by)
    VALUES (
      target_workspace_id,
      current_project_name,
      'Imported from SNS project Excel dataset.',
      CASE current_project_name
        WHEN 'ASRS Build' THEN '#FDE215'
        WHEN 'Business Planning' THEN '#60d394'
        WHEN 'Darkstore Ops' THEN '#8cc9ff'
        WHEN 'Digital Systems' THEN '#c084fc'
        WHEN 'Market Expansion' THEN '#ff8c42'
        WHEN 'Production System' THEN '#ff6666'
        ELSE '#FDE215'
      END,
      target_user_id
    )
    RETURNING id INTO current_project_id;

    INSERT INTO tmp_sns_project_map (project_name, project_id)
    VALUES (current_project_name, current_project_id);
  END LOOP;

  FOR dataset_row IN
    SELECT value
    FROM jsonb_array_elements(dataset) WITH ORDINALITY AS source(value, sort_order)
    ORDER BY sort_order
  LOOP
    SELECT project_id, next_position
    INTO current_project_id, task_position
    FROM tmp_sns_project_map
    WHERE project_name = dataset_row ->> 'project_name';

    current_status_name := CASE lower(dataset_row ->> 'status')
      WHEN 'not started' THEN 'To Do'
      WHEN 'in progress' THEN 'In Progress'
      WHEN 'in review' THEN 'In Review'
      WHEN 'done' THEN 'Done'
      ELSE 'To Do'
    END;

    SELECT id
    INTO current_status_id
    FROM public.task_statuses
    WHERE project_id = current_project_id
      AND name = current_status_name
    ORDER BY position
    LIMIT 1;

    IF current_status_id IS NULL THEN
      SELECT id
      INTO current_status_id
      FROM public.task_statuses
      WHERE project_id = current_project_id
      ORDER BY position
      LIMIT 1;
    END IF;

    INSERT INTO public.tasks (
      project_id,
      title,
      description,
      status_id,
      priority,
      assignee_id,
      position,
      created_by
    )
    VALUES (
      current_project_id,
      dataset_row ->> 'task_name',
      concat_ws(
        E'\n\n',
        'Phase / Milestone: ' || nullif(dataset_row ->> 'phase_milestone', ''),
        'Task List: ' || nullif(dataset_row ->> 'task_list', ''),
        CASE WHEN nullif(dataset_row ->> 'subtask', '') IS NULL THEN NULL ELSE 'Subtask: ' || (dataset_row ->> 'subtask') END,
        CASE WHEN nullif(dataset_row ->> 'assignee', '') IS NULL THEN NULL ELSE 'Original Assignee: ' || (dataset_row ->> 'assignee') END
      ),
      current_status_id,
      CASE lower(dataset_row ->> 'priority')
        WHEN 'urgent' THEN 'urgent'
        WHEN 'high' THEN 'high'
        WHEN 'medium' THEN 'medium'
        WHEN 'low' THEN 'low'
        ELSE 'none'
      END,
      NULL,
      task_position,
      target_user_id
    );

    UPDATE tmp_sns_project_map
    SET next_position = next_position + 1
    WHERE project_name = dataset_row ->> 'project_name';
  END LOOP;

  RAISE NOTICE 'Imported SNS dataset workspace %, % projects, % tasks.',
    target_workspace_id,
    (SELECT count(*) FROM tmp_sns_project_map),
    jsonb_array_length(dataset);
END $$;
