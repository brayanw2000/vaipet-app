# Phase 3.1 Stabilization & E2E Restoration

Restore a complete, operational, and fail-closed E2E suite for Phase 3.1 while maintaining Zero-Trust security and high-fidelity simulation.

## Technical Details

### 1. E2E Suite Restoration (`tests/walk-real-e2e.spec.ts`)
- **Full Journey**: Replace placeholders with a deterministic two-context flow (Owner UI + Walker UI).
- **Matching**: Use `process_walk_matching` and production UI selectors instead of `service_role` inserts.
- **Tracking**: Simulate GPS via `setGeolocation` and verify server-side `append_walk_tracking_point` and `update_walker_location` with 5s throttle.
- **Negative Scenarios**: Implement 12+ scenarios (anonymous, Busy walker, invalid GPS, out-of-order transitions, etc.) with pre/post-state validation.
- **Completion**: Validate conclusion via "Finalizar passeio" button, verifying metrics calculation and location privacy post-completion.

### 2. Cleanup & Isolation
- **Fail-Closed Preflight**: Update `preflightCleanup` to throw on `listUsers` errors, use full pagination, and enforce strict metadata markers (`e2e_run_id`).
- **Teardown**: Ensure all resources are purged in `finally` blocks, respecting foreign key constraints.

### 3. Documentation & Reporting
- **PHASE3_STABILIZATION.md**: Update with real SHAs, exact test counts (7 total), and verified run metrics (5x tracking, 2x full).
- **Evidence**: Provide full HEAD SHA and exact `test()` count via CLI.

### 4. Repository Health
- Ensure `bun.lock` is physically removed and `.gitignore` updated.
- Final validation via `tsc`, `build`, and `lint`.
