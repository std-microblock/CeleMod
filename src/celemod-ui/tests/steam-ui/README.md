# Steam theme regression fixture

From `src/celemod-ui`, run `node tests/steam-ui/serve.mjs` and open
`http://127.0.0.1:1427/tests/steam-ui/` in the in-app browser. This server is
local-only; its import aliases and IPC mock never enter the production build.

The fixture renders the real Steam component, `createThemeContext`, theme tokens,
Fluent/Material pointer hooks, global stylesheet and Android stylesheet. Scenario
buttons provide fake login, installed game, conflicts, preparation and a running
download. No Steam credentials/network or phone connection is used.

Using the browser skill's connected tab handle, import `checks.mjs` and call
`checkSteamThemes(tab)`. It performs real pointer clicks across all three themes,
checks fields/entry geometry, switch glyph isolation, conflict choices, ripple
layout and entrance/exit animation events. Test at 390×844, 320×740 and 844×390;
restore the browser viewport afterwards.

Manual additions:
- Choose `progress`: after sampling, the entry shows about 1 MiB/s and a finite
  ETA. Open the sheet, compare metrics, close and reopen without losing progress.
- `Stall download`: after the eight-second window, speed is zero and ETA unknown.
- Enable OS reduced motion: opening/closing is immediate, without stuck modality.
- On a newly built Android APK with Autofill enabled, submit test credentials and
  confirm there is no browser/system save-password sheet. The local fixture cannot
  prove Android Autofill behavior. Never enter real credentials into this fixture.
