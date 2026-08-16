# Shell Long-Running Task Verification

Parent issue: #70

## Automated Coverage

- Detached Shell sessions with a foreground child process are retained past the normal 30s idle reap.
- Detached Shell sessions return to normal idle reap after the foreground child exits.
- Shell foreground child process transitions set and clear the shared activity `working` state.
- Long inactive Shell tasks emit the existing `Stop` finished transition once.
- Short Shell commands and actively viewed Shell tasks do not emit finished notifications.
- Mobile/remote terminal input adopts a tmux-only survivor before writing to it.
- Explicit Stop and graceful shutdown still use lifecycle `reap` and kill the managed tmux session.

## Manual Matrix

Use a short threshold-friendly command while running the dev server:

```bash
sleep 12; echo shell-finished
```

Check these flows:

- Desktop starts Shell task, tab closes for more than 30s, desktop reconnects to the same session and output.
- Desktop starts Shell task, tab closes for more than 30s, mobile local lists the same session, shows working status, and can send input after completion.
- Mobile starts or operates a Shell session, desktop reconnects to the same session id.
- PWA/browser close and reconnect preserve the running Shell task while the server remains up.
- Task completion clears working status on desktop and mobile.
- Long inactive task completion produces one finished notification through the existing notification settings.
- Short commands do not produce finished notification noise.
- Stop from desktop and mobile terminates the same Shell/tmux session and its child process.
- Graceful server shutdown cleans managed Shell sessions without leaving child processes behind.
