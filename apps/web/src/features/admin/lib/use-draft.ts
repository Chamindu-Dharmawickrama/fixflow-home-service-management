import { useState } from "react";

/** How long a search waits after the last key before it reloads the list. */
export const SEARCH_DEBOUNCE_MS = 350;

/**
 * A control's text while it is being edited. It follows the URL when the URL changes under it (the
 * back button, "Clear filters"), but only if the person is not part-way through typing something
 * else: when the URL moves, the draft is replaced only if it still equals the value the URL had.
 * So an answer that arrives late for an earlier keystroke never overwrites what is typed now.
 */
export function useDraft(committed: string) {
  const [draft, setDraft] = useState(committed);
  const [seen, setSeen] = useState(committed);
  if (seen !== committed) {
    setSeen(committed);
    if (draft.trim() === seen) {
      setDraft(committed);
    }
  }
  return [draft, setDraft] as const;
}
