# Phase 4.1 Correction and Certification Plan

## Technical Summary
Correcting the Phase 4.1 implementation to meet the strict security and operational requirements of the audit. This includes hardening the PIN generation (cryptographic 6-digit numeric), securing all operational RPCs with Zero-Trust principles (revoking Public/Anon, role validation, fail-closed logic), and fixing interface flow regressions (PIN form placement, navigation errors).

## Database Hardening
- **Migration 20260817002500**:
    - PIN generation: `lpad(floor(random() * 1000000)::text, 6, '0')` for ^[0-9]{6}$.
    - Block `attempts >= 5` permanently in `customer_get_pickup_code`.
    - Revoke `EXECUTE` from `PUBLIC` and `anon` on all operational RPCs.
    - RPC `petwalker_arrive_pickup`: Reject null GPS inputs, validate role and `heading_to_pickup` status.
    - RPC `petwalker_confirm_pickup`: Atomic lock, PIN deletion after one-time use, and row count validation.
    - Explicitly revoke `petwalker_complete_walk` from `authenticated`.

## Interface and UX
- **WalkDetails.tsx**: Implement the real PIN input form when status is `arrived`.
- **Navigation**: Fix "Voltar ao Painel" link to `/petwalker`.
- **UI State**: Enforce DIGIT-only input, show error states, and hide completion buttons during the `in_progress` lock phase.
- **Data Attributes**: Add `data-testid="pickup-pin-input"` and `data-testid="pickup-pin-submit"`.

## Testing and Certification
- **Security Suite**: `tests/walk-operation-4.1-security.spec.ts` (Isolated RPC tests for Anon, OtherUser, GPS validation, PIN regex, Replay, and 5-attempt lockout).
- **Integrated E2E**: `tests/walk-operation-4.1.spec.ts` (Multi-user flow using real UI logins, proximity arrival, and PIN confirmation).
- **Automation**: Fix E2E setup errors (pet weight column) and use `expect.poll` for status transitions.
- **Cleanup**: Hardened `tests/helpers/cleanup.ts` with `e2e_test` metadata validation and Auth 404 confirmation.

## Technical Details
- PostGIS proximity validation (150m) in `petwalker_arrive_pickup`.
- `IS DISTINCT FROM` for fail-closed ID comparisons.
- `GET DIAGNOSTICS` for atomic update verification.
