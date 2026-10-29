/**
 * The fields of `after` whose value differs from `before`, compared by value (so a new array with the
 * same items is no change). A form that edits an existing record sends only these, so two people
 * editing different fields of one record cannot overwrite each other's work with stale values.
 */
export function changedBodyFields<T extends object>(before: T, after: T): Partial<T> {
  const changed: Partial<T> = {};
  for (const key of Object.keys(after) as (keyof T)[]) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      changed[key] = after[key];
    }
  }
  return changed;
}
