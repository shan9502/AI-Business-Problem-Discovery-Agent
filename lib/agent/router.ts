import type { BusinessObserverState } from "./state";

/**
 * Routes from classifyIntent to the appropriate subpath.
 * Returns the name of the next node.
 */
export function routeByIntent(
  state: BusinessObserverState
): "extractAndWrite" | "buildQuerySpec" | "handleResume" | "generateResponse" {
  switch (state.intent) {
    case "discover":
    case "update":
      return "extractAndWrite";
    case "query":
      return "buildQuerySpec";
    case "resume":
      return "handleResume";
    case "skip":
    case "general":
    default:
      return "generateResponse";
  }
}

/**
 * After extractAndWrite: always go to prioritizeFields then generateQuestion then generateResponse.
 */
export function routeAfterWrite(
  _state: BusinessObserverState
): "prioritizeFields" {
  return "prioritizeFields";
}

/**
 * After buildQuerySpec: go to SQL generation.
 */
export function routeAfterQuerySpec(
  _state: BusinessObserverState
): "generateAndExecuteSql" {
  return "generateAndExecuteSql";
}

/**
 * After SQL: always go to generateResponse.
 */
export function routeAfterSql(
  _state: BusinessObserverState
): "generateResponse" {
  return "generateResponse";
}
