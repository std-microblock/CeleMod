# Android virtual-button UI fixture

From the UI directory run `node tests/android-keybindings/serve.mjs`, then open
`http://127.0.0.1:1430/tests/android-keybindings/`. All data is in memory; no device,
game saves, credentials, or real Mod settings are touched.

Check at 360px portrait and landscape: create a named button; select Chat + Tools;
save and refresh; edit/cancel; disable/re-enable; delete/cancel/confirm; retain a
missing Mod reference. Legacy/axis/disabled actions must explain why unavailable.
Empty names/selections cannot save. Naming a button `失败测试` simulates a save
failure: draft and original configuration must remain recoverable.

Choose text, chat, lightning, star, or another built-in icon; check the preview,
save, refresh, and reopen the editor to verify the choice persists. Existing
definitions without an icon must keep displaying their text.

Unit checks: `node --import tsx --test src/routes/touchButtons.test.ts`.
