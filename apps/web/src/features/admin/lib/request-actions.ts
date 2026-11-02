import { RequestAction } from "@fixflow/shared";

/** What each action is called on its button and in the menu. */
export const REQUEST_ACTION_LABELS: Readonly<Record<RequestAction, string>> = {
  [RequestAction.START_REVIEW]: "Start review",
  [RequestAction.CREATE_QUOTATION]: "Create quotation",
  [RequestAction.CREATE_WORK_ORDER]: "Create work order",
  [RequestAction.REOPEN]: "Reopen request",
  [RequestAction.CANCEL]: "Cancel request",
};

/** The actions that end the request or need care, which go in the menu and never on the main button. */
const MENU_ONLY: readonly RequestAction[] = [RequestAction.CANCEL];

/**
 * Actions the server lists that no screen performs yet. They are left out of the page until the task
 * that builds them removes them from here, so there is never a button that does nothing (CLAUDE.md
 * §10). T17 builds the work order.
 */
const NOT_BUILT_YET = [RequestAction.CREATE_WORK_ORDER] as const;

/** An action the page can perform: every one the server lists, less the ones not built yet. */
export type OfferedAction = Exclude<RequestAction, (typeof NOT_BUILT_YET)[number]>;

function isOffered(action: RequestAction): action is OfferedAction {
  return !(NOT_BUILT_YET as readonly RequestAction[]).includes(action);
}

/**
 * Splits what the server allows into the one button on the page and the menu behind "More actions".
 * The server lists the most likely next step first (D-43), so the first action that is not
 * destructive is the primary one; the rest keep the server's order. The screen offers what the
 * server allows, less what no screen performs yet, and decides nothing of its own.
 */
export function splitActions(actions: readonly RequestAction[]): {
  primary: OfferedAction | undefined;
  menu: OfferedAction[];
} {
  const offered = actions.filter(isOffered);
  const primary = offered.find((action) => !MENU_ONLY.includes(action));
  return { primary, menu: offered.filter((action) => action !== primary) };
}
