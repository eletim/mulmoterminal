// Which of the user's saved phrases the phone is offered for a given session (#830).
// Pure (no I/O) so the scoping rule is exhaustively unit-tested.
import type { SessionAgent } from "../../../common/sessionAgent.js";
import type { QuickCommand } from "../../../common/quickCommands.js";
import type { QuickCommandChip } from "../../../common/terminalView.js";

// An entry with no `agents` is offered everywhere, including a session whose kind the host
// cannot tell. A SCOPED entry needs a known kind to match, so it is withheld from an unknown
// one rather than guessed at — offering "git status" to what turns out to be Claude is worse
// than offering nothing.
export function quickCommandsForAgent(commands: readonly QuickCommand[], agent: SessionAgent | null): QuickCommandChip[] {
  return commands.filter((command) => isOfferedTo(command, agent)).map(({ label, text }) => ({ label, text }));
}

const isOfferedTo = (command: QuickCommand, agent: SessionAgent | null): boolean =>
  !command.agents?.length || (agent !== null && command.agents.includes(agent));
