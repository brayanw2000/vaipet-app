# Phase 3 Stabilization Plan - Final Certifications

Fix the outstanding Phase 3 stabilization issues identified in the audit of commit `8c6355b`, focusing on robust E2E isolation, deterministic offer handling, server-side truth, and environment-compatible test execution.

## User Improvements (Non-Technical)
- **Deterministic Experience**: Ensures the walk offer you see is exactly the one you accept, with no more "ghost" sessions or mismatches.
- **Reliable Testing**: Robust cleanup of test data ensures the app remains clean and production data is never touched by tests.
- **PT-BR Accuracy**: All technical reporting and status messages follow the project's language requirements.

## Technical Details
### 1. Robust E2E Isolation (Preflight Cleanup)
- **Safe Fail-Fast**: Implement paginated `admin.auth.admin.listUsers()`, validating every call and every deletion.
- **Strict Matching**: Filter strictly by `@e2e.vaipet.invalid` AND `user_metadata.e2e_test: true` AND `created_at < cutoff` (TTL: 1 hour).
- **Post-Verification**: After deletion, perform a follow-up query to confirm target users are gone; fail the suite if verification fails.

### 2. Deterministic Offer Ordering
- **Server-Side Priority**: Add a migration to re-implement `get_available_walk_offers` with a deterministic `ORDER BY`:
    1. `s.matching_expires_at ASC` (Expiring soonest)
    2. `st_distance(...) ASC` (Closest distance)
    3. `o.created_at ASC` (Oldest offer first)
- **Frontend Sync**: Remove sorting logic from `Painel.tsx` and ensure it respects the server's order.
- **UI Validation**: Update E2E to verify that the card shown matches the `session_id` sent in the `accept_walk_request` call.

### 3. Environment-Compatible Test Suite
- **Split Execution**: Divide `tests/walk-real-e2e.spec.ts` logic into modular scripts to avoid environment timeouts:
    - `test:e2e:walk:setup` (Cleanup + provisioning)
    - `test:e2e:walk:matching` (Matching + acceptance)
    - `test:e2e:walk:tracking` (GPS tracking repetitions)
    - `test:e2e:walk:completion` (Conclusion + history)
    - `test:e2e:walk:cleanup` (Teardown)
- **Recovery**: Allow blocks to recover state from the database instead of relying on in-memory variables between processes.

### 4. Repository Integrity
- **Bun Lock**: Permanently remove `bun.lock` and verify absence in the final commit.
- **Lint/Typecheck**: Maintain 0 errors in core Phase 3 files and record exact global counts.
- **Documentation**: Update `docs/PHASE3_STABILIZATION.md` with factual results, commit hashes, and real durations.

## Order of Operations
1. **Migration**: Update `get_available_walk_offers` for deterministic ordering.
2. **E2E Hardening**: Refactor `preflightCleanup` and add card validation logic.
3. **Modular Scripts**: Create the block-based E2E commands in `package.json`.
4. **Validation**: Run the block-based suite and record results.
5. **Final Cleanup**: Remove `bun.lock` and update documentation.
