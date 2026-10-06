import { resolvePath } from "../rules/evaluate.js";
import type { RouteAction, Strategy } from "../rules/types.js";

export type OutcomeKind =
  "route_user" | "route_team" | "self_serve_link" | "fallback_queue";

/**
 * A routing outcome before org IDs are attached. The caller (the web app)
 * turns `teamKey` / `to` into `teamId` / `userId` against the database and
 * stores the final `DecisionOutcome` in `routing_decisions`.
 */
export type OutcomeDraft =
  | { kind: "route_user"; to: string; toSource: string; reason: string }
  | { kind: "route_team"; teamKey: string; strategy: Strategy; reason: string }
  | { kind: "self_serve_link"; reason: string }
  | { kind: "fallback_queue"; reason: string };

function isPresent(value: unknown): boolean {
  return value !== undefined && value !== null && value !== "";
}

/**
 * Turn a matched route action into a storable outcome. `to` targets may be an
 * inputs path (e.g. `crm.contact.owner`) or a literal rep id/email; when the
 * path resolves, the resolved value is carried in `to` and the raw target in
 * `toSource` so the routing log can show both.
 */
export function draftOutcome(
  action: RouteAction,
  inputs: Record<string, unknown>,
): OutcomeDraft {
  if ("to" in action) {
    const resolved = resolvePath(inputs, action.to);
    if (isPresent(resolved)) {
      return {
        kind: "route_user",
        to: String(resolved),
        toSource: action.to,
        reason: `Matched target ${action.to}.`,
      };
    }
    return {
      kind: "route_user",
      to: action.to,
      toSource: action.to,
      reason: `Target ${action.to} is not available on this submission.`,
    };
  }
  if ("team" in action) {
    return {
      kind: "route_team",
      teamKey: action.team,
      strategy: action.strategy,
      reason: `Matched team ${action.team} (${action.strategy}).`,
    };
  }
  if (action.action === "self_serve_link") {
    return { kind: "self_serve_link", reason: "Self-serve booking link." };
  }
  return { kind: "fallback_queue", reason: "Sent to the fallback queue." };
}
