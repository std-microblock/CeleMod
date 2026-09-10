# Android map-time performance

This work targets play **after entering a map**, not Everest startup or map
loading. Resolution, drawable/backbuffer sizing, texture quality, particles,
game speed, GC/JIT compatibility settings and Mod activation are unchanged.
It does not enable lazy loading or forcibly collect/dispose assets.

## Bridge overhead reductions

- Cache inheritance checks by type, not by entity instance. Filter UI types
  before reading reflected `Visible`/`Active` properties, avoiding boxed booleans
  for thousands of ordinary lobby entities.
- Reuse the synchronous scene classification for the direct-touch snapshot.
  Command dispatch still refreshes context before/after callbacks.
- Filter menus before constructing lists; do not copy the entire entity list.
- Do not install custom-button detours/pollers for empty or all-disabled configs.
- Check virtual input membership before reflective context validation, and do
  not deserialize unchanged custom-button command files every polling tick.

The synthetic benchmark is **bridge-only**, not game FPS or resident memory.
Before the concurrently developed CU2/Miao UI adaptation, 4,096 decorations ×
1,000 scans on this development machine measured 1,080.61 ms / 196,680,480 bytes
allocated before these changes, versus 270.63 ms / 64,000 bytes afterward.
Those are cumulative temporary allocations, **not memory saved in the game**.
Repeat against the final integrated build; do not infer a 4× game FPS gain.

```powershell
.local/dotnet-sdk/dotnet.exe run --project android/runtime/tests/managed -c Release
.local/dotnet-sdk/dotnet.exe run --project android/runtime/tests/managed -c Release -- --lobby-benchmark
.local/dotnet-sdk/dotnet.exe run --project android/runtime-tests -c Release
scripts/build-android-hooks.ps1
```

## Opt-in map profiling

Use an APK containing the new managed hook. In the selected game directory,
create an empty `celemod-performance.flag` file **before launch**. Remove it and
relaunch to disable. The hook is off without this file. No Saves, Mods or Everest
settings need to be edited. The normal game log will contain `[CeleMod perf]`.

Every 10 seconds in an unpaused `Celeste.Level`, it reports:

- area ID / room / entity count;
- rendered FPS, average/max inter-draw interval, count over 33.33 ms;
- average/max update and CPU-side draw wall time;
- measured touch bridge time per update (already included in update time);
- approximate allocation rate, managed heap size, gen 0/1/2 collection deltas;
- Linux VmRSS when available.

Scene changes reset the counters and exclude the transition update. No history
grows per frame. File IO and logging run on a bounded background writer; it
receives text, never scene/entity references. Original update/draw exceptions
are not swallowed. The profiler does not force garbage collection.

CPU draw is **not GPU execution time**, and VmRSS is **not Android PSS or total
GPU memory**. Pair it with `adb shell dumpsys meminfo cc.microblock.celemod:game`
and device CPU/thermal observations. Compare the same room, position, Mods,
resolution, and thermal conditions before/after; also test room changes and
returning from the background. High update cost, GPU/present stalls and large
resident assets require different fixes—do not apply speculative global entity
culling or disable effects without identifying the bottleneck.

## Verification limits

Managed regression tests cover context/input semantics, non-UI property reads,
allocation-free timing counters and exception forwarding. The hook builds with
the existing .NET 8 SDK. Actual Strawberry Jam map FPS, resident memory savings,
and Android low-memory/background survival still require an on-device run in the
reported slow room. Startup timing is not evidence for those outcomes.

## Live baseline — September 10, 2026

Device: 23049RAD8C, game PID 26740, existing installed APK. DebugRC confirmed
`StrawberryJam2021/0-Lobbies/4-Expert`, room `lobby1`; the read-only `count`
command reported 3,426 entities. No game restart, settings/save changes or forced
collection were performed. A short Enter-key pause comparison was restored to
`gameplay` afterward.

SurfaceFlinger presentation timestamps (126–127 frames per snapshot):

| State | Mean interval | Observed FPS | p95 interval |
| --- | ---: | ---: | ---: |
| Playing, sample 1 | 26.00 ms | 38.47 | 33.42 ms |
| Playing, sample 2 | 25.73 ms | 38.87 | 33.44 ms |
| Paused | 16.64 ms | 60.09 | 25.06 ms |

The game main thread sampled at about 97% of one core during play and 85.5%
while paused (with more frames rendered). This supports investigating per-update
CPU work, but the pause comparison is not a function-level profile and can also
change animation/effect work. It does not justify disabling arbitrary entities.

One `smaps_rollup` snapshot showed PSS 1,311,881 KiB and SwapPss 918,087 KiB;
system MemAvailable was 1,012,604 KiB. An earlier `dumpsys meminfo` reported
842,552 KiB in Graphics. These come from different sampling moments and accounting
sources: **do not add them into one claimed RAM total**, or label all anonymous
memory as the managed GC heap. Significant swapped-out memory is observed, not a
proven specific leak. The hardware thermal service reported status 0 in this run.

Artifacts are under `.local/mod-performance/live-20260910/`: raw frame timestamps,
thread samples, entity counts, smaps/meminfo, session and screenshot. This is a
baseline, not an after-optimization FPS result. The installed run did not have
the opt-in managed profiler enabled; a diagnostic build/relaunch is still needed
to separate game update, bridge, CPU draw and GC/allocation cost precisely.
