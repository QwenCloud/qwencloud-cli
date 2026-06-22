/**
 * Re-export shim for the `subscription tokenplan seats` command action.
 *
 * The canonical implementation lives in ./tokenplan/seats.ts, organized into
 * the tokenplan/ subdirectory alongside ./tokenplan/status.ts. This file
 * exposes the action at the flat path so consumers (CLI registration, tests)
 * can import either path interchangeably.
 */
export { subscriptionTokenPlanSeatsAction } from './tokenplan/seats.js';
