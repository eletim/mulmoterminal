// What counts as a colour anywhere a directory's .mulmoterminal.json supplies one. Only
// 6-digit hex: the server's schema accepts nothing else, and the UI drops what it can't
// parse rather than handing an unknown string to a style binding.
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

export const isHexColor = (color: string | null | undefined): color is string => typeof color === "string" && HEX_COLOR_RE.test(color);
