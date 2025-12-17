/**
 * Messages type - nested object structure for translation messages
 */
export type Messages = {
  [key: string]: string | Messages;
};

/**
 * Gets a nested value from messages using dot notation.
 * e.g., getMessage({ nav: { home: "Home" } }, "nav.home") returns "Home"
 */
export function getMessage(messages: Messages, keyPath: string): string | null {
  const keys = keyPath.split(".");
  let current: Messages | string = messages;

  for (const key of keys) {
    if (current === null || current === undefined) {
      return null;
    }
    if (typeof current === "string") {
      return null;
    }
    current = current[key];
  }

  return typeof current === "string" ? current : null;
}

/**
 * Interpolates variables into a template string.
 * Supports {{variable}} syntax.
 * 
 * Example:
 * interpolate("Hello {{name}}!", { name: "World" }) => "Hello World!"
 */
export function interpolate(
  template: string,
  vars?: Record<string, string | number | boolean | null | undefined>
): string {
  if (!vars) return template;

  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const value = vars[key];
    if (value === null || value === undefined) return "";
    return String(value);
  });
}

