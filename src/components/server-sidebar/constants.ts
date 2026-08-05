// Indent levels (px), one step per nesting level
export const INDENT_STEP = 16;

const INDENT_BASE = 4;
const level = (depth: number) => INDENT_BASE + depth * INDENT_STEP;

export const I = {
  server: level(0),
  cat: level(1),
  db: level(2),
  schema: level(3),
  schemaObj: level(4),
  table: level(5),
  section: level(6),
  item: level(7),
};
