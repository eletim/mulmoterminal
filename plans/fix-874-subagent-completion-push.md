# A finished subagent is not a session waiting on you

Issue: #874 (and the half of #850 that "it's by design" did not actually cover)

## What was measured

An interactive session was run with every hook pointed at a capture server, and the payloads were
recorded verbatim. One subagent produced:

```
05:10:02.536  Stop                                       -> ✅ finished push
05:10:03.650  Notification  type=agent_completed         -> ❓ waiting push, 1.1s later
                            msg='execute-date-command finished'
                            agent_id=None
```

Two pushes for one turn, from one subagent. Eight parallel sessions with several subagents each is
the reported storm, and it is not a matter of taste: the second push says *the agent is blocked on
you* when nothing is blocked.

The payload's fields settle the design:

- **`notification_type` is present** — `agent_completed`.
- **`agent_id` is NOT** present on Notification (it is on `SubagentStart` / `SubagentStop` / the
  subagent's own `PreToolUse`, but those are not registered hooks). So an earlier guess that this
  could be filtered by `agent_id` was wrong; the type is the only usable signal.

## Three symptoms, one misclassification

`Notification` was mapped to "the user is needed" in two places, and the beep follows the second:

| | before | after |
|---|---|---|
| Web Push (`pushKindFor`) | always `waiting` | `waiting` unless informational |
| Grid attention + beep (`activityHookEffects`) | always `waiting: true` | same rule |

Fixing only the push would have left the cell flashing and beeping for a finished subagent, which
is most of what "notification storm" means in practice.

## Denylist, not allowlist

Suppressed: `agent_completed`, `auth_success`, `elicitation_complete`, `elicitation_response` —
each reports something that already happened.

Everything else notifies, including a type this code has never seen and the absent-type case (an
older Claude Code sends none). The asymmetry is the whole argument: a spurious ping is an
annoyance, a swallowed "your agent is blocked" is precisely what the feature exists to prevent, and
a user cannot discover a stuck session any other way. That is also why #850's answer — turn
`waiting` off — was not a fix: it removes the valuable notification along with the noise.

## Not in scope

`SubagentStart` / `SubagentStop` remain unregistered. They would allow a "suppress everything while
a subagent runs" rule (option C on the issue), but that is a bigger behavioural change and this one
is precise: `agent_completed` is a completion, so calling it "waiting" was simply wrong.

## Verification

The specs were confirmed to fail against the unfixed code. Re-checking the real behaviour needs an
interactive session — `Notification` does not fire under `claude -p` — using the same capture-server
method recorded on the issue.
