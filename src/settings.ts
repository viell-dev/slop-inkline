// Inkline's settings: what they are, what they start as, and how the data
// stored for them is read back. A plain module, so that unit tests can check
// it; settings-tab.ts shows them.

/** Inkline's settings. */
export interface Settings {
  /** What starts typing a symbol's name in a note, as `;;tower`. */
  readonly trigger: string;
  /** The brush a new editor starts with, by its index among the sizes. */
  readonly brushSize: number;
  /** Whether a new editor starts with its guides shown. */
  readonly guides: boolean;
  /** A symbol's height in text, as a percentage of the usual line height. */
  readonly symbolScale: number;
  /** Whether symbols take the text's colour rather than their stored pixels. */
  readonly textColor: boolean;
}

/** The settings Inkline starts with, and what a value it cannot read becomes. */
export const defaultSettings: Settings = {
  trigger: ";;",
  brushSize: 1,
  guides: true,
  symbolScale: 100,
  textColor: true,
};

/** The most characters a trigger may have. */
const maxTrigger = 8;

/**
 * Why `trigger` cannot start typing a symbol's name, or undefined if it
 * can. It needs one to eight characters, none of them a space or the link
 * syntax that ends a name (`[`, `]`, `|`), and one at least that is neither
 * a letter nor a digit, so that ordinary words never start a list.
 */
export function triggerProblem(trigger: string): string | undefined {
  const characters = Array.from(trigger);
  if (characters.length === 0) return "A trigger needs at least one character.";
  if (characters.length > maxTrigger) {
    return `A trigger has at most ${String(maxTrigger)} characters.`;
  }
  if (/\s/u.test(trigger)) return "A trigger cannot hold a space.";
  if (/[[\]|]/u.test(trigger)) return "A trigger cannot hold [, ], or |.";
  if (/^[\p{L}\p{N}\p{M}]+$/u.test(trigger)) {
    return "A trigger needs a character that is not a letter or a digit.";
  }
  return undefined;
}

/** The keys of the settings, as the settings tab stores them. */
export type SettingKey = keyof Settings;

/** Every setting's key. */
export const settingKeys: readonly SettingKey[] = [
  "trigger",
  "brushSize",
  "guides",
  "symbolScale",
  "textColor",
];

/**
 * `settings` with `key` set to `value`, or undefined if `value` is not one
 * that `key` can hold: a trigger as {@link triggerProblem} allows, a brush
 * among `sizes`, or a boolean.
 */
export function withSetting(
  settings: Settings,
  key: SettingKey,
  value: unknown,
  sizes: number,
): Settings | undefined {
  switch (key) {
    case "trigger":
      return typeof value === "string" && triggerProblem(value) === undefined
        ? { ...settings, trigger: value }
        : undefined;
    case "brushSize": {
      const index =
        typeof value === "string" && /^\d+$/.test(value)
          ? Number(value)
          : value;
      return typeof index === "number" &&
        Number.isInteger(index) &&
        index >= 0 &&
        index < sizes
        ? { ...settings, brushSize: index }
        : undefined;
    }
    case "symbolScale":
      return typeof value === "number" &&
        Number.isInteger(value) &&
        value >= 50 &&
        value <= 200 &&
        value % 5 === 0
        ? { ...settings, symbolScale: value }
        : undefined;
    case "guides":
    case "textColor":
      return typeof value === "boolean"
        ? { ...settings, [key]: value }
        : undefined;
  }
}

/**
 * The settings `data` holds, as `loadData` gives what was stored: each one
 * it holds and can hold, and the default for any other, so that data from
 * another version, or edited by hand, never stops Inkline from loading.
 */
export function readSettings(data: unknown, sizes: number): Settings {
  let settings = defaultSettings;
  if (typeof data !== "object" || data === null) return settings;
  for (const key of settingKeys) {
    if (!Object.hasOwn(data, key)) continue;
    const read = withSetting(settings, key, Reflect.get(data, key), sizes);
    if (read !== undefined) settings = read;
  }
  return settings;
}
