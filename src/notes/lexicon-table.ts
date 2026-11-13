// PROTOTYPE for #167, sections 3 and 5, not for release: the tables of a
// lexicon note, read and changed as text. Plain, so that unit tests can
// check them; words.ts reads lexicon notes with them.

/** The cells of a table row: their text and where each starts and ends. */
export function cells(row: string): { text: string; from: number; to: number }[] {
  const bars: number[] = [];
  let inLink = 0;
  for (let at = 0; at < row.length; at++) {
    if (row.startsWith("[[", at)) inLink++;
    if (row.startsWith("]]", at) && inLink > 0) inLink--;
    if (row[at] === "|" && row[at - 1] !== "\\" && inLink === 0) {
      bars.push(at);
    }
  }
  const found: { text: string; from: number; to: number }[] = [];
  const starts = row.trimStart().startsWith("|") ? bars : [-1, ...bars];
  for (let index = 0; index < starts.length; index++) {
    const from = (starts[index] ?? 0) + 1;
    const to = starts[index + 1] ?? row.length;
    if (index === starts.length - 1 && row.slice(from).trim() === "") break;
    found.push({ text: row.slice(from, to), from, to });
  }
  return found;
}

/** PROTOTYPE (#167, section 5): which cell of a lexicon's table holds what. */
export interface Columns {
  readonly word: number;
  readonly reading?: number;
  readonly meaning?: number;
  readonly parts?: number;
}

/**
 * PROTOTYPE: the columns of a table, by the names in its header, in any
 * order, so that a person can add columns of their own, such as notes.
 * A table whose header names no word column is read by position, as the
 * section 3 prototype did: word, reading, meaning.
 */
export function columnsOf(header: readonly { text: string }[]): Columns {
  const names = header.map((cell) => cell.text.trim().toLowerCase());
  const find = (...wanted: string[]) => {
    const index = names.findIndex((name) => wanted.includes(name));
    return index === -1 ? undefined : index;
  };
  const word = find("word", "words", "ink", "inks", "symbols");
  if (word === undefined) return { word: 0, reading: 1, meaning: 2 };
  const reading = find("reading", "readings");
  const meaning = find("meaning", "meanings", "translation");
  const parts = find("parts", "made of", "components", "radicals");
  return {
    word,
    ...(reading === undefined ? {} : { reading }),
    ...(meaning === undefined ? {} : { meaning }),
    ...(parts === undefined ? {} : { parts }),
  };
}

/**
 * PROTOTYPE: `line`, a row of a lexicon's table, with the reading and
 * meaning cells holding `reading` and `meaning`, and every other cell as it
 * was. A `|` in a value is escaped, as a table needs.
 */
export function changedRow(
  line: string,
  columns: Columns,
  reading: string,
  meaning: string,
): string {
  const row = cells(line);
  const escape = (value: string) => value.replace(/\|/g, "\\|");
  const replace = new Map<number, string>();
  if (columns.reading !== undefined) replace.set(columns.reading, reading);
  if (columns.meaning !== undefined) replace.set(columns.meaning, meaning);
  let result = "";
  let at = 0;
  for (const [index, cell] of row.entries()) {
    const value = replace.get(index);
    if (value === undefined) continue;
    result += `${line.slice(at, cell.from)} ${escape(value)} `;
    at = cell.to;
  }
  return result + line.slice(at);
}

/**
 * PROTOTYPE: a new row for a table with `columns`, of `count` cells: the
 * word's embeds, its reading, and its meaning, and other cells empty.
 */
export function newRow(
  columns: Columns,
  count: number,
  embeds: string,
  reading: string,
  meaning: string,
): string {
  const escape = (value: string) => value.replace(/\|/g, "\\|");
  const values = Array.from({ length: Math.max(count, 1) }, () => "");
  values[columns.word] = embeds;
  if (columns.reading !== undefined) values[columns.reading] = escape(reading);
  if (columns.meaning !== undefined) values[columns.meaning] = escape(meaning);
  return `| ${values.join(" | ")} |`;
}

/** PROTOTYPE: the cells of a row, for the command that edits one. */
export function rowCells(line: string): { text: string }[] {
  return cells(line);
}

