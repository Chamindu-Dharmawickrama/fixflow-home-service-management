import { RequestAction } from "@fixflow/shared";

/** What each action is called on its button and in the menu. */
export const REQUEST_ACTION_LABELS: Readonly<Record<RequestAction, string>> = {
  [RequestAction.START_REVIEW]: "Start review",
  [RequestAction.CREATE_QUOTATION]: "Create quotation",
  [RequestAction.REOPEN]: "Reopen request",
  [RequestAction.CANCEL]: "Cancel request",
};

/** The actions that end the request or need care, which go in the menu and never on the main button. */
const MENU_ONLY: readonly RequestAction[] = [RequestAction.CANCEL];

/**
 * Splits what the server allows into the one button on the page and the menu behind "More actions".
 * The server lists the most likely next step first (D-43), so the first action that is not
 * destructive is the primary one; the rest keep the server's order. The screen offers exactly what
 * the server allows and decides nothing of its own.
 */
export function splitActions(actions: readonly RequestAction[]): {
  primary: RequestAction | undefined;
  menu: RequestAction[];
} {
  const primary = actions.find((action) => !MENU_ONLY.includes(action));
  return { primary, menu: actions.filter((action) => action !== primary) };
}
