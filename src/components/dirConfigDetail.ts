import { isRecord } from "../../common/isRecord";
import { EMPTY_DIR_CONFIG_SOURCE, type DirConfigSource } from "../../common/dirConfigSource";

// The settings modal's read-only view of one directory's `.mulmoterminal.json`, built off
// /api/dir-config-detail. Kept out of the component so the wire parsing and the wording of
// every row can be tested without mounting anything.

export interface DirConfigRow {
  key: string;
  label: string;
  // What the app resolved, as text. A colour row shows its hex here too — the swatch is a
  // second reading of the same value, not a replacement for it.
  value: string;
  // Set only for a row whose value IS a colour, so the component knows to draw a swatch.
  color: string | null;
}

export interface DirConfigDetailView {
  file: string | null;
  rows: DirConfigRow[];
  source: DirConfigSource;
}

// Ordered as the settings read, not as the type declares: what the directory is called, then
// the colours in the order the eye meets them, then the terminal's own settings.
const COLOR_FIELDS: [key: string, label: string][] = [
  ["headerColor", "Header background"],
  ["headerTextColor", "Header text"],
  ["badgeColor", "Name badge"],
  ["cellColor", "Cell background"],
  ["cellBorderColor", "Cell border"],
  ["dotColor", "Status dot"],
  ["buttonColor", "Header buttons"],
];

const asString = (value: unknown): string | null => (typeof value === "string" && value ? value : null);
const asNumber = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);

function colorRows(config: Record<string, unknown>): DirConfigRow[] {
  return COLOR_FIELDS.flatMap(([key, label]) => {
    const color = asString(config[key]);
    return color ? [{ key, label, value: color, color }] : [];
  });
}

function terminalRows(config: Record<string, unknown>): DirConfigRow[] {
  const rows: DirConfigRow[] = [];
  const theme = asString(config.theme);
  if (theme) rows.push({ key: "theme", label: "Terminal theme", value: theme, color: null });
  // The palette is a map of xterm colour keys; the count is the useful summary, since the
  // individual entries are the terminal's own business rather than the chrome's.
  const palette = isRecord(config.colors) ? Object.keys(config.colors).length : 0;
  if (palette) rows.push({ key: "colors", label: "Palette overrides", value: `${palette} colour${palette === 1 ? "" : "s"}`, color: null });
  const fontSize = asNumber(config.fontSize);
  if (fontSize) rows.push({ key: "fontSize", label: "Font size", value: `${fontSize}px`, color: null });
  const fontFamily = asString(config.fontFamily);
  if (fontFamily) rows.push({ key: "fontFamily", label: "Font family", value: fontFamily, color: null });
  const priority = asNumber(config.orderPriority);
  if (priority !== null) rows.push({ key: "orderPriority", label: "Grid priority", value: String(priority), color: null });
  if (config.hasSound === true) rows.push({ key: "sound", label: "Attention sound", value: "configured", color: null });
  return rows;
}

export function dirConfigRows(config: unknown): DirConfigRow[] {
  if (!isRecord(config)) return [];
  const name = asString(config.name);
  return [...(name ? [{ key: "name", label: "Name", value: name, color: null }] : []), ...colorRows(config), ...terminalRows(config)];
}

const stringList = (value: unknown): string[] => (Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : []);

export function parseDirConfigDetail(data: unknown): DirConfigDetailView {
  if (!isRecord(data)) return { file: null, rows: [], source: EMPTY_DIR_CONFIG_SOURCE };
  const source = isRecord(data.source) ? data.source : {};
  return {
    file: asString(data.file),
    rows: dirConfigRows(data.config),
    source: { applied: stringList(source.applied), ignored: stringList(source.ignored), unknown: stringList(source.unknown) },
  };
}
