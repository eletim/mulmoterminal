# The allowed origins have to follow the bind decision

Issue: #956

## What was reported, and what it actually is

`MULMOTERMINAL_HOST=<addr>` binds where it is told, the page loads from another machine, and then
every terminal cell sits at "connecting" — because `isAllowedOrigin` accepts only loopback
hostnames, so the browser's own `http://<addr>:PORT` Origin is refused.

**This is documented.** `docs/guide/{en,ja}/config.md` #bind-host says it in as many words: "for
port-forwarding, not for browsing from another machine". So the behaviour is by design, and the
reporter's environment matched the design exactly.

The bug is that the design is wrong here, for two reasons.

### It stops the honest browser and not the attacker

The same report demonstrates it, from a remote machine:

```
Origin: http://<bind-host>:34567 → 403
Origin: http://localhost:34567   → 200
```

`Origin` is only enforced against **browsers**. Anything else sets it to whatever it likes, and
`allowed-origin.ts` already says so — a forged Origin "must already be able to reach the port,
which only happens when the operator widened the bind — an explicit decision to trust whoever can
connect." Once that decision is taken, refusing the browser that the same operator pointed at the
same address protects nobody. It only costs them the feature.

### The one place the operator is guaranteed to look does not mention it

Widening the bind prints a warning, and the warning is about authentication only. It never says the
browser will fail to attach. The person who hits this has already read the one line the product
showed them; the fact that would have saved them is on a guide page they had no reason to open.

## What changes

**Origins the operator named are allowed, and nothing else.** Loopback stays allowed always. Added
on top:

- the bind address, when `MULMOTERMINAL_HOST` names a specific non-loopback one
- anything in a new `MULMOTERMINAL_ALLOWED_ORIGINS` (comma-separated; a bare host or a whole
  origin), which is also the answer for `0.0.0.0` — a wildcard names every interface, so there is
  no single hostname to infer

**Not** "reflect whatever Host the request carried", which is the obvious shortcut and is wrong:
a DNS-rebinding page sends `Origin: http://evil.com` with a matching `Host`, so the two agree and
the check passes. Matching against a list the operator wrote cannot be rebound onto.

**The no-Origin rule does not move.** A request with no Origin from a remote peer stays refused —
that path is about non-browser callers, and the whole point of the peer check (b696a96) was that
"it must be local" had been assumed rather than verified. Naming a browser origin must not
re-open it.

**The warning says what the rule is**, including the case where the operator widened the bind and
named no origin — the exact state that produces the reported symptom.

## Shape

| Where | What |
|---|---|
| `server/infra/allowed-origin.ts` | `browserOriginHostnames(bindHost, env)` derives the set; `createIsAllowedOrigin(set)` builds the predicate; `bindSecurityWarning(...)` writes the message next to the rule it describes, so the two cannot drift |
| `server/index.ts` | derives the set once at boot and passes the bound predicate where `isAllowedOrigin` went before |
| docs (`en`/`ja`), `env.ts` | the #bind-host section stops saying it is impossible and says how |

A factory rather than a third optional parameter. That parameter would default to "no extra
origins" for every caller that forgot it — which is the exact failure `remoteAddress` was made
required to prevent, one release ago.

## Verification

The existing spec covers the default (nothing configured) and must keep passing verbatim; a
one-line local binding in the spec gives it the same predicate it had. New cases cover the
configured set, the wildcard bind, and that a named origin does not loosen the no-Origin rule.

Not verified end-to-end from a second machine — no such machine in this session. The reporter has
one, and the reproduction in #956 is a two-line curl.
