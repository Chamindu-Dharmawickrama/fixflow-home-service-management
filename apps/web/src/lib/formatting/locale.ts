/**
 * The one locale used to format numbers, money and dates. It is a constant, never derived from the
 * visitor's browser: the business's currency and time zone come from its settings (BR-17, BR-18),
 * and server and browser must render identical text to avoid hydration mismatches.
 */
export const FORMAT_LOCALE = "en-US";
