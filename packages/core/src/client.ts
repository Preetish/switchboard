/**
 * Browser-safe entry point: the pieces the hosted form page needs, without
 * the rules engine's zod/yaml dependencies (which would otherwise ship to
 * every lead's browser through the main barrel).
 */
export { groupSlotsByDay } from "./calendar/group-slots.js";
export type { SlotGroup, SlotInterval } from "./calendar/group-slots.js";
export type { FormField, FormFieldType } from "./forms/types.js";
export { URL_PARAMS, touchFromUrl } from "./attribution.js";
export type { Attribution, Touch } from "./attribution.js";
