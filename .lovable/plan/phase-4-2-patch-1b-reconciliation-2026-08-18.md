---
name: Phase 4.2 Patch 1B Reconciliation
description: Hardens GPS tracking authority, singleton watcher architecture, and security RPCs.
type: feature
---

# Phase 4.2 Patch 1B Reconciliation

## Database Changes
- Drop insecure `append_walk_tracking_point(uuid, double precision[])` overload.
- Harden `update_walker_location`:
  - Validate `lat/lng` range (-90..90, -180..180).
  - Require `approval_status = 'approved'`.
  - Validate `accuracy >= 0` and reasonable limit.
  - Use `FOR UPDATE` lock on `petwalker_profiles`.
  - Monotonicity check on `captured_at`.
  - Call `append_walk_tracking_point(uuid, jsonb)` version.
  - Verify `walk_sessions.current_status` (not `status`).
- Revoke `INSERT` on `walker_tracking` from `authenticated` (must use RPC).
- Fix `walker_tracking` RLS.

## Frontend Changes
- **Singleton Watcher**: Implement `PetwalkerGpsProvider` to manage the single `navigator.geolocation.watchPosition` instance.
- **Context API**: `usePetwalkerGpsContext` for shared GPS state.
- **Persistent Tracking**: Active when `available` OR `current_walk_id` is present.
- **GPS Capture Time**: Use `pos.timestamp` for `_captured_at`.

## Testing Changes
- Harden `tests/gps-tracking-4.2.spec.ts` to verify authority isolation (Walker vs Owner).
