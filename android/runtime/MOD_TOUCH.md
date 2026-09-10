# CollabUtils2 / MiaoNet Android touch adapters

Reference packages inspected: **CollabUtils2 1.13.4** and **MiaoNet 0.5.2-alpha**,
from the supplied ZIPs. Neither archive is modified or copied into the repository.
Adapters use optional reflection on already-loaded assemblies; discovery does not
load a Mod or create MiaoNet's lazy connection context. Other versions remain
best-effort, with the existing **按键 / 触屏** fallback.

## CollabUtils2

- Lobby chapter/checkpoint panels and journals use the actual initialized,
  attached `InGameOverworldHelper.overworldWrapper.WrappedScene`. They no longer
  look like gameplay simply because `Engine.Scene` is still a Level. Nested UI
  changes invalidate semantic presses; transitions expose no touch targets.
- A lobby containing `LobbyMapController` gets a **大厅地图** gameplay shortcut,
  using the current `DisplayLobbyMap` keyboard binding. An explicitly unbound
  action stays unbound; custom semantic Mod buttons remain an alternative.
- Lobby maps keep menu directions (left/right: lobby; up/down: destination),
  **缩放**, **关闭**, and, only for teleport-capable maps, **传送**. In direct-touch
  mode a one-finger drag pans the map. The full overview and zoom/focus animations
  reject panning. Pan selection uses only the Mod's existing `activeWarps`; it
  never calls teleport. Changing lobbies invalidates an ongoing drag.
- The assist-skip confirmation exposes its actual two options, not an underlying
  TextMenu. Selection still goes through `MenuConfirm` and the Mod's own update.

## MiaoNet

- Connected gameplay gets **聊天** and **玩家** shortcuts from live `ChatButton` /
  `PlayerListButton` keyboard bindings. They retain normal hold/toggle behavior.
  Bindings remain stable while the player list owns focus, so it cannot cancel
  its own hold. Disconnecting removes them; no settings are rewritten.
- Active chat takes precedence over Level pause and the Mod's dummy overlay.
  Movement and custom Mod buttons are suppressed; **发送** uses literal Enter,
  **关闭聊天** uses literal Escape, and **删除** uses Backspace. These are not
  vanilla menu-confirm/cancel bindings, even if those are rebound.
- Tap the chat input, or the keyboard toolbar icon, to edit with the native phone
  keyboard. **填入** only replaces the draft, with the Mod's length limit and
  control-character filtering. Cancel leaves the draft unchanged. Press **发送**
  separately: the original Mod owns command handling, history, live-mode checks,
  channel selection and network sending. No direct packet/send shortcut is used.
- Swipe the existing channel strip horizontally to cycle tabs and synchronize the
  outgoing channel through the Mod's methods.
- Emote shortcuts, fireworks, command-chat and player-list scroll bindings can
  still be configured on the launcher's custom **按键** page. This change does not
  implement a touch version of the gamepad emote wheel or player-list row actions.

Default gameplay shortcuts require virtual keys enabled and a usable keyboard
binding. Direct chat/map menus also work with the virtual-key switch enabled.
Custom semantic buttons can target unbound Mod actions.

## Verification

- `ModTouchTests.cs`: 43 synthetic managed cases, covering nested scene lifetime,
  pause/transition priority, stale commands, bounded map panning, view-only maps,
  assist confirmation, Unicode drafts, no implicit sending, channel synchronization,
  binding clearing, disconnect and avoiding lazy-context construction.
- `ModTouchTest.kt`: native control profiles, raw key mapping, read-only map controls,
  rebindings, incremental drag deltas, stale-lobby cancellation, keyboard and tabs.
- Full managed suite and Android arm64 debug JUnit suite/build are run locally.
- **Not yet device-validated in these Mod scenes.** Remaining manual checks: open
  a lobby chapter panel/journal, pan/zoom/switch/teleport and close the lobby map;
  connect MiaoNet, test hold/toggle player list, Chinese IME draft/cancel/send,
  slash commands and channel switching, then background/disconnect while editing.
