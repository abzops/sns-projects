# SNS Projects Documentation Standard & Governance

## 1. Purpose & Core Principles

This document defines the authoritative standard for all documentation within the StacknStock Projects (SNS Projects) engineering organization. Documentation is an integral, mandatory component of the software development lifecycle. An implementation is **NOT DONE** until its corresponding documentation is written, verified, and cross-linked.

### Fundamental Rules
1. **Never Commit Secrets**: Documentation must **NEVER** contain real credentials, database passwords, temporary/permanent employee passwords, `service_role` keys, JWT/access tokens, refresh tokens, or private environment configurations. Always use redacted placeholders or environment variable references.
2. **Accurate & Authoritative**: Document facts as implemented and verified in the codebase, never speculative or unapproved designs.
3. **Traceability**: Every technical specification, decision record, and implementation report must cite relevant commit hashes, migration versions, and verification test scripts.
4. **Portability of Links**: All repository documentation must use relative Markdown links. Local absolute machine paths (e.g. `file:///C:/...`, `C:\Users\...`) are strictly prohibited.
5. **Mandatory Completion Gate**: No engineering task or package may be closed without updating the documentation suite.

---

## 2. Master Documentation Authority Precedence Order

When reviewing technical architecture or implementation requirements across multiple documents, the following strict hierarchy of authority applies:

```mermaid
graph TD
    A[1. DOCUMENTATION_STANDARD.md] --> B[2. DECISION_REGISTER.md]
    B --> C[3. Domain Decision Records: PROCESS & FINANCE ADRs]
    C --> D[4. IMPLEMENTATION_ROADMAP.md]
    D --> E[5. Current Architecture Specs: Blueprint & Finance Spec]
    E --> F[6. Verified Implementation Package Documents: P1-01, P1-01A, P1-01B]
    F --> G[7. Historical Release Notes & Hotfix Reports]
    G --> H[8. Archive Materials]
```

1. **`DOCUMENTATION_STANDARD.md`**: Defines governance rules, templates, and procedures.
2. **`DECISION_REGISTER.md`**: Master index of all approved architectural decisions.
3. **Domain Decision Records** (`PROCESS_ARCHITECTURE_DECISIONS.md`, `FINANCE_ARCHITECTURE_DECISIONS.md`): Authoritative individual decision logic and operational rules.
4. **`IMPLEMENTATION_ROADMAP.md`**: Current approved package sequencing and dependencies.
5. **Current Architecture Specs** (`SNS_Projects_V2_Architecture_Blueprint.md`, `FINANCE_ARCHITECTURE_SPEC.md`): High-level system design.
6. **Verified Implementation Package Documents** (`06_Implementation_Packages/`): Granular engineering reports of completed packages.
7. **Historical Release Notes & Reports** (`10_Release_Notes/`): Point-in-time historical records.
8. **Archive** (`99_Archive/`): Superseded or legacy reference documents.

*Conflict Resolution Rule*: If an older or lower-tier document conflicts with a higher-tier document, the higher authoritative document always prevails.

---

## 3. Directory Taxonomy & Folder Ownership

The `Documentation/` directory is organized into domain-specific, numbered categories:

```
Documentation/
│
├── README.md                                # Master Documentation Index
│
├── 00_Governance/                           # Standards, roadmaps, policies
│   ├── DOCUMENTATION_STANDARD.md
│   └── IMPLEMENTATION_ROADMAP.md
│
├── 01_Product_Architecture/                 # System blueprints, user journeys, high-level design
├── 02_Database_and_Data_Architecture/       # Schema definitions, ERDs, migration standards
├── 03_Security_and_Authentication/          # RLS models, Auth workflows, audit logs
├── 04_Defined_Processes/                    # Defined Process Engine, DAGs, RACI specifications
├── 05_Finance/                              # Financial specifications (Planned Packages 4–7)
│
├── 06_Implementation_Packages/              # Discrete execution packages
│   ├── Package_01_Core_Foundation/
│   ├── Package_02_Process_Runtime/
│   ├── Package_03_Hierarchy_UI/
│   ├── Package_04_Finance_Foundation/
│   ├── Package_05_Expense_Execution/
│   ├── Package_06_Finance_UI/
│   ├── Package_07_Financial_Hierarchy/
│   └── Package_08_Regression_and_Import/
│
├── 07_Testing_and_QA/                       # Test strategies, contract suites, E2E policies
├── 08_Deployment_and_Operations/            # CI/CD, seed datasets, disaster recovery
├── 09_Decision_Records/                     # Authoritative Decision Registers (ADRs)
├── 10_Release_Notes/                        # Production changelogs and hotfix summaries
└── 99_Archive/                              # Historical or superseded reference materials
```

---

## 4. Document Lifecycle Statuses

Every technical and implementation document must declare an authoritative status in its header metadata:

| Status | Definition |
| :--- | :--- |
| **`PLANNED`** | Architecture designed, approved for implementation, not yet coded. |
| **`IN_PROGRESS`** | Actively being implemented or tested. |
| **`IMPLEMENTED`** | Code written and applied locally, pending production verification. |
| **`VERIFIED`** | Deployed to production, regression tested, and fully verified. |
| **`SUPERSEDED`** | Replaced by a newer architectural standard or package. |
| **`ARCHIVED`** | Retained for historical context only; no longer active. |

---

## 5. File Naming Conventions

All Markdown files must follow predictable, descriptive naming patterns:
- **Implementation Packages**: `<PackageID>_<Descriptive_Title>.md` (e.g. `P1-01_Core_Hierarchy_Process_Instance_Foundation.md`, `P1-01A_Process_Instance_Access_Hardening.md`)
- **Architecture Blueprints**: `SNS_Projects_<Topic>_Blueprint.md`
- **Decision Records**: `<DOMAIN>_ARCHITECTURE_DECISIONS.md`
- **Release Notes / Hotfixes**: `<Type>_<Feature_or_Issue>.md`

---

## 6. Implementation & Documentation Workflow (Mandatory Gate)

For every future engineering task, feature, or hotfix, developers must follow this strict 9-step sequence:

```mermaid
graph TD
    A[1. Implement Code & Migrations] --> B[2. Execute Verification Test Suites]
    B --> C[3. Deploy & Verify Live State]
    C --> D[4. Create / Update Implementation Document]
    D --> E[5. Update Master README Index]
    E --> F[6. Update Implementation Roadmap & Status]
    F --> G[7. Update Architecture / Decision Records]
    G --> H[8. Validate Internal Markdown Links]
    H --> I[9. Commit Code + Documentation Together]
```

1. **Implement**: Code changes and forward migrations.
2. **Test**: Run automated test suites and verify contracts.
3. **Deploy & Verify**: Apply migrations and confirm production behavior.
4. **Update Implementation Doc**: Write comprehensive technical spec in `06_Implementation_Packages/`.
5. **Update Master Index**: Register the new document in `Documentation/README.md`.
6. **Update Roadmap**: Advance status in `00_Governance/IMPLEMENTATION_ROADMAP.md`.
7. **Update Decision Records**: Record any architectural decisions made.
8. **Verify Links**: Ensure all relative Markdown links resolve correctly via `node scripts/verify-doc-links.mjs`.
9. **Commit Together**: Commit source code, tests, and documentation in a single unified atomic commit.
