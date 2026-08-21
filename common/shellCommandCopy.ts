export interface ShellCommandCopy {
  text: string;
}

const commonPrefixLength = (a: string, b: string): number => {
  const max = Math.min(a.length, b.length);
  let i = 0;
  while (i < max && a.charCodeAt(i) === b.charCodeAt(i)) i += 1;
  return i;
};

function lineStartBefore(text: string, index: number): number {
  const previousNewline = text.lastIndexOf("\n", Math.max(0, index - 1));
  return previousNewline < 0 ? 0 : previousNewline + 1;
}

function trimRepeatedPrompt(block: string, previousPrompt: string): string {
  if (!previousPrompt) return block.trimEnd();
  const trimmed = block.trimEnd();
  const suffix = `\n${previousPrompt}`;
  if (block.endsWith(suffix)) return block.slice(0, -suffix.length).trimEnd();
  const lastBreak = trimmed.lastIndexOf("\n");
  if (lastBreak < 0) return trimmed;
  const trailingLine = trimmed.slice(lastBreak + 1);
  const previousMarker = previousPrompt.trimEnd().at(-1);
  const trailingMarker = trailingLine.trimEnd().at(-1);
  const promptMarkers = new Set(["$", "#", "%", ">", "❯", "❱", "❮"]);
  return previousMarker && previousMarker === trailingMarker && promptMarkers.has(trailingMarker) && trailingLine.length <= 160
    ? trimmed.slice(0, lastBreak).trimEnd()
    : trimmed;
}

export function shellCommandCopyFromScreens(beforeScreen: string, afterScreen: string, command = ""): ShellCommandCopy | null {
  const prefix = commonPrefixLength(beforeScreen, afterScreen);
  if (prefix < beforeScreen.length) return null;
  if (prefix >= afterScreen.length) return null;
  const start = lineStartBefore(beforeScreen, prefix);
  const previousPrompt = beforeScreen.slice(start);
  const firstCommandLine = command.split("\n").find((line) => line.trim() !== "");
  let text = afterScreen.slice(start);
  if (firstCommandLine) {
    const commandIndex = text.lastIndexOf(firstCommandLine);
    if (commandIndex < 0) return null;
    text = text.slice(lineStartBefore(text, commandIndex));
  }
  text = trimRepeatedPrompt(text, previousPrompt);
  return text === "" ? null : { text };
}
