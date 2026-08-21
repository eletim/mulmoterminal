---
title: Mobile notifications (Web Push)
layout: default
parent: English
nav_order: 7
description: Web Push to your phone when a turn finishes or an agent stops to ask — how to leave your desk while parallel agents keep working.
---

# Mobile notifications (Web Push)
{: .no_toc }

- TOC
{:toc}

**When a task finishes — or stops on a permission prompt or question — your phone gets a push
notification.** Kick off a long task, walk away, and get pulled back when you're needed. Setup is
in two places: the **terminal side** and the **phone side**.

![Push notifications on a phone's lock screen — finished tasks ✅ and "Claude is waiting for your input"](../images/push-lock-screen.jpg)

- There are **two kinds** of push: a turn **finishing**, and a turn **blocking on input**
  (permission prompt / question).
- Pushes fire **even for the pane you're viewing** (unlike the attention [sound](features.html),
  which stays quiet for the active pane — a push assumes your phone is elsewhere). Only internal
  background workers are excluded.
- The send happens on the MulmoTerminal server. Devices are registered from the local mobile page
  (`/mobile/terminals`) and stored locally.

---

## 1. Terminal side (mulmoterminal)

1. Start MulmoTerminal so your phone can reach it, for example with the local mobile/Tailscale
   helper or your own trusted LAN binding.
2. Open **Settings → Web Push notifications** and choose which moments should push.

## 2. Phone side

Open your MulmoTerminal mobile URL, ending in `/mobile/terminals`. The steps differ between
iPhone and Android.

### iPhone / iPad (iOS 16.4+)

On iOS, **Web Push only works from a PWA installed on the Home Screen** — you can't enable it
from a regular Safari tab, so **install first**.

1. Open the MulmoTerminal mobile URL in Safari.
2. Tap **Share → "Add to Home Screen"** to install the PWA.
3. **Launch it from the Home Screen icon**.
4. In the mobile page's Web Push panel, tap the enable/register action and allow the permission
   prompt. This registers the device as a push target.

### Android

Android (Chrome) can enable push straight from the browser tab.

1. Open the MulmoTerminal mobile URL in Chrome.
2. In the mobile page's Web Push panel, tap the enable/register action and allow the permission
   prompt.
4. (Recommended) Use the menu's **"Add to Home Screen"** to install the PWA — launching and
   delivery are more reliable that way.

## Not just notifications: watch and reply from the phone

The mobile page is a **remote control**, not just an inbox. Get pinged, glance at the live
screen, send one word, and the agent keeps going — all without a laptop. You can also start a
new terminal in the session's directory, and give yourself one-tap chips for the sentences you
send most.

→ **[From your phone](phone.html)** covers all of it.

![The terminal viewed from a phone — live screen plus yes / no / ok / continue / stop quick replies](../images/remote-phone-terminal.jpg)

---

## When a push is sent

All four have to hold:

- ✅ Web Push is configured on the server
- ✅ at least one **device has notifications enabled** on the phone side
- ✅ the moment is **a kind you asked for** — see below

The pane you're currently looking at counts too (your phone is elsewhere). Internal workers —
hidden background sessions, the translation worker — never push.

## Which moments push, and how to choose {#kinds}

Two moments raise a push, and **Settings → Web Push notifications** has a checkbox for
each. Untick one and that moment stops notifying, while the other keeps working.

| Setting | Fires when | Looks like | How often |
|---|---|---|---|
| **Turn finished** | the agent finished replying and the output is unread | ✅ `<dir>` — the reply | once per turn |
| **Waiting for you** | the agent **stopped to ask** — a permission prompt or a question | ❓ `<dir>` — what it's asking | **once per prompt** |

{: .warning }
> **"Waiting for you" is the one that can feel frequent.** It fires every time the agent stops
> to ask, so a long task that asks permission repeatedly sends a push each time. Each one is
> accurate — the session really is blocked — but if you only want to hear about finished work,
> untick it and keep **Turn finished**.

A kind added in a future version stays **off** until you tick it, so an upgrade can't start
notifying you about something you never asked for.

### In `config.json`

The checkboxes write [`pushKinds`](config.html):

```json
{ "pushKinds": ["finished"] }
```

`pushKinds: []` means no kind qualifies. Leaving `pushKinds` out entirely keeps both kinds, which
is what a config written before this setting existed does.

## If nothing arrives

- Is Web Push disabled in the server environment? → set the VAPID env vars and restart.
- Notifications not enabled / no device registered on the phone. → enable them in the PWA.
- **Can't enable on iPhone?** → launch from the **Home Screen icon**, not a Safari tab
  (an iOS restriction).
- **Blocked the permission prompt?** → flip it back to "Allow" in the browser's site settings
  (the icon left of the address bar → Notifications).
- Getting the **same push twice**? Your phone may have a **stale registration** — re-registering
  from the mobile page clears it.

---

← [Configuration](config.html) / [English guide index](index.html)
