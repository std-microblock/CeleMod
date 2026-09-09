# Android MiaoNet regression fixture

Run from the UI package:

```sh
node --test tests/android-miaonet.test.mjs
node tests/android-miaonet/serve.mjs
```

Open `http://127.0.0.1:1431/tests/android-miaonet/` in the in-app browser.
The real Multiplayer component/styles use synthetic IPC responses only; this
does not access a forum account, device files, or a MiaoNet server.

Verify at 393×852, 320×568 and landscape 852×393:

- Save is visible above bottom navigation, can receive clicks, and no horizontal overflow occurs.
- Toggle automatic connection: Save becomes enabled, saving clears dirty state.
- `?mode=login`: authorize transitions to settings without remaining stuck in progress.
- `?mode=save-error`: change a setting and save; a visible error appears above the
  footer, the change is retained and Save remains enabled for retry.
- `?mode=error`: a transient state-read failure recovers on refresh.
- `?mode=dropped-callback`: begin authorization; the final event is deliberately
  dropped. Polling must recover the backend failure and enable retry.

Backend tests: `cargo test --locked -p cele-mod --lib miaonet_settings_tests`.
Android must exclusively use `<selected game>/Saves`, matching RuntimeHost's
per-game `EVEREST_SAVEPATH`. Do not migrate an app-wide Linux token into an
arbitrary selected game. First login creates the missing Saves directory.

Device acceptance still requires a real forum authorization: exit Celeste,
authorize in the system browser, return to CeleMod, change/save settings, then
start Everest and verify that MiaoNet recognizes the login and settings. Never
log or include OAuth codes or encrypted tokens in test reports.

Android authorization uses a temporary `MiaoNetAuthService` foreground service
while the system browser is open. It stops on completion/failure and has a
six-minute safety timeout. The loopback page reports the actual exchange/save
result, and `celemod-auth://return` only wakes the app (no credentials in the
deep link). Background WebView event loss is recovered via versioned snapshots
returned with `get_miaonet_local_state`.

Callback transport tests: `cargo test --locked -p cele-mod --lib miaonet_oauth_tests`.
They exercise actual IPv4/IPv6 loopback requests, wrong-state rejection,
authorization denial, HTML escaping, and retained status without a page listener.
On a connected debug device, an innocuous request to `/__celemod_background_probe`
on port 21472 must return the app's 404 page while CeleMod is backgrounded. A
denied read of `/proc/net/tcp` is not evidence that binding a socket is denied.
