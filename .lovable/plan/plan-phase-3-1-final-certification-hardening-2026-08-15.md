# Plan - Phase 3.1 Final Certification & Hardening

Final stabilization of the PetWalker Portal Phase 3.1, focusing on fail-closed cleanup, operational E2E journeys, and strict security validation.

## User Review Required

> [!IMPORTANT]
> This plan modifies the core E2E suite to be strictly fail-closed. Any failure in listing or deleting test users will now immediately stop the test suite to prevent data pollution.

## Proposed Changes

### E2E Suite & Cleanup (`tests/walk-real-e2e.spec.ts`)
- **Fail-Closed Cleanup**:
  - Update `preflightCleanup` to throw an error if `listUsers` fails, instead of just logging a warning.
  - Implement strict metadata filtering (runId, e2e_test flag, domain, TTL).
  - Update `quickCleanup` to verify the `error` field of every database operation and user deletion.
- **Resource Lifecycle**:
  - Refactor all tests to declare `BrowserContext` and `Page` outside `try` blocks.
  - Ensure `context.close()` and `quickCleanup()` are executed in `finally` blocks, even on assertion failures.
- **Operational Helpers**:
  - Implement a shared helper to transition a session through real status changes (`accepted` -> `heading_to_pickup` -> `arrived` -> `in_progress`) using production RPCs.
  - Replace administrative `UPDATE` calls with UI-driven or RPC-driven state transitions.

### Tracking & Completion Validation
- **Operational Tracking Test**:
  - Simulate 3+ GPS updates via `update_walker_location`.
  - Verify map marker existence, historical trail persistence, and server-side throttle (5s).
  - Verify real-time marker movement without page reloads.
- **Completion Validation**:
  - Test explicit conclusion via "Finalizar passeio" button.
  - Validate confirmation dialogs, double-click prevention, and post-completion privacy (RLS).
  - Verify server-calculated duration and price persistence.

### Security & Negative Tests
- **Negative Scenarios**:
  - Add tests for `matching_expires_at` being NULL or expired.
  - Test unauthorized tracking access after walk completion.
  - Validate RLS by checking that `delete().select("id")` returns zero records and records remain in the database.
- **PetWalker State**:
  - Test matching rejection when walker is offline or `is_accepting_requests` is false.

### Documentation & Reporting
- **PHASE3_STABILIZATION.md**: Update with real SHA, exact lint counts, and verified test results.
- **Final Report**: Execute full suite (2x) and tracking (5x) to provide definitive certification logs.

## Technical Details

- **E2E Isolation**: Enforce `e2e_run_id` in every `provisionUser` call.
- **GPS Simulation**: Use Playwright `setGeolocation` combined with production `watchPosition` logic in `WalkInProgress.tsx`.
- **Database Consistency**: Use `FOR UPDATE` in `accept_walk_request` (already implemented in migration, will verify in tests).

## Constraints & Assumptions

- No new features will be added.
- The plan preserves the existing Apple HIG design system.
- `bun.lock` will be explicitly verified as removed from the repository.
