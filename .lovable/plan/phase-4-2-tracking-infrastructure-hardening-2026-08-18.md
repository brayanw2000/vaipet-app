# Phase 4.2 — Tracking Infrastructure Hardening

Petwalker as the sole authority for GPS production. Centralized GPS management and hardened backend validation.

## Changes

### 1. Database Migration
- Add `last_location_captured_at` to `petwalker_profiles` and `captured_at` to `walker_tracking`.
- Hardened `update_walker_location` RPC:
  - Add monotonicity check using `_captured_at` (Epoch MS).
  - Enforce walk status validation (only updates if session is active).
  - Automatically call `append_walk_tracking_point` when status is `in_progress` or `returning`.
  - Secure RLS: revoke public/anon access.
- Migration: `20260817150000_phase42_tracking_infra.sql`.

### 2. Frontend Infrastructure
- Create `src/hooks/usePetwalkerGps.tsx`:
  - Centralized `watchPosition` logic.
  - Handles synchronization with Supabase RPC.
  - Manages GPS status state (`synced`, `unstable`, etc.).
  - Mounted once in `App.tsx` (wrapped by `PetwalkerProtectedRoute`).
- Refactor `src/pages/petwalker/Painel.tsx`:
  - Consume data from `usePetwalkerGps`.
  - Remove redundant `watchPosition` and tracking logic.
- Remove Owner-side tracking:
  - Remove `append_walk_tracking_point` calls from `src/components/WalkInProgress.tsx`.

### 3. Verification Plan
- Verify that `update_walker_location` is only accessible to authenticated Petwalkers.
- Confirm that GPS tracking persists during navigation between Petwalker views.
- Validate that the Owner no longer attempts to write tracking points.
- Verify monotonicity of coordinates in `route_coordinates`.

## Technical Details

### Hardened RPC Signature
```sql
CREATE OR REPLACE FUNCTION public.update_walker_location(
  _lat double precision,
  _lng double precision,
  _accuracy double precision DEFAULT 0,
  _captured_at bigint DEFAULT (extract(epoch from now()) * 1000)::bigint
)
```
- Revoke `PUBLIC` access.
- Grant `authenticated` access.
