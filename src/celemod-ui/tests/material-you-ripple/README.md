# Material You ripple regression

From the UI package, run `node tests/material-you-ripple/serve.mjs` and open
`http://127.0.0.1:1428/tests/material-you-ripple/`.

Click **Run regression checks**. The page runs 12 groups of DOM/event, animation,
geometry and lifecycle assertions against the real theme stylesheet and runtime.
The final status must read **12 checks passed**. These deterministic checks use
synthetic pointer/keyboard events; they do not replace device testing.

Also manually press/hold, release outside, double-tap and use Space/Enter on the
samples. Trusted browser input is reported separately beneath the controls.
**Preview held ripples** exposes the sustained state for visual inspection;
**Release preview** lets all four ripples fade. Check the rail pill, custom host,
filled button and out-of-bounds badge. Test OS reduced-motion with the samples;
the automated suite separately simulates that preference and its CSS duration.

The existing Steam theme fixture is useful for checking integration with real
React components and native dialog layouts; this fixture requires no native IPC.
