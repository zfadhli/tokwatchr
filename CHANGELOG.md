# Changelog

## [0.7.1] - 2026-06-05

### Fixed

- CLI no longer calls `process.exit(0)` after `stop()` — the remux ffmpeg
  subprocess was killed before it could finish, leaving `.ts` files un-remuxed
- Watch mode now properly breaks the polling loop on Ctrl+C instead of
  continuing to record new segments

### Changed

- CLI output now shows just filenames during progress, with the output
  directory displayed once at the end

## [0.7.0] - 2026-06-05

### Added

- CLI commands `download` and `watch` are now built into the `tokwatchr`
  package — install once and use as a library or run `npx tokwatchr`
  from the command line
- `dev` script for running the CLI directly from TypeScript source

## [0.6.5] - 2026-06-05

### Fixed

- `stop()` no longer has a 5-second hard timeout that killed the remux
  ffmpeg process before it could finish — `stop()` now waits indefinitely
  for the remux to complete (protected by ffmpeg's own 10-minute timeout)

## [0.6.4] - 2026-06-05

### Fixed

- `start()` can now be called multiple times — the `abortController` was created
  once in the constructor and never reset, so after `stop()` the signal stayed
  permanently aborted and the next `start()` immediately threw at `throwIfAborted()`

## [0.6.3] - 2026-06-05

### Fixed

- `DownloadResult` and `remux` event now report the real `.mp4` output file size
  instead of the `.ts` input size — the AAC re-encode produces a different file
  size, and `...tsResult` was passing through the stale input size
- `remux` events now fire before `process.exit(0)` in example scripts — added
  `setImmediate` flush to give pending microtasks time to dispatch

## [0.6.2] - 2026-06-05

### Fixed

- `timeout` option for HTTP client (impit) now correctly converted from seconds
  to milliseconds — the v0.6.0 time-unit change broke all HTTP requests by
  passing 30 (seconds) as 30ms to impit, causing immediate timeouts

## [0.6.1] - 2026-06-05

### Fixed

- `UserOfflineError` and `RoomResolveError` messages now mention that the
  username may not exist (not just that it's offline), since TikTok often
  returns 200 with "user not found" body instead of HTTP 404

## [0.6.0] - 2026-06-05

### Added

- `remux` event — emitted when remux starts, completes, or fails, giving
  visibility into the remux phase and allowing detection of silent `.ts`
  fallbacks
- `RemuxInfo` interface — exposes `filePath`, `inputSizeMB`, `status`
  (`"started"` | `"completed"` | `"failed"`), and `outputPath`

### Changed

- `checkInterval` and `timeout` options now accept **seconds** instead of
  milliseconds, matching `maxDuration` and `maxSegmentDuration` for
  API consistency (`checkInterval: 180` = 3 min, `timeout: 30` = 30 s)

## [0.5.0] - 2026-06-05

### Added

- `waiting` event — emitted during room lookup and stream activation polling
  with elapsed time, giving real-time feedback during the waiting phase
- `WaitingInfo` interface — exposes `username`, `phase` ("room" or "stream"),
  and `elapsed` seconds
- `examples/watch-persistent.ts` — single-user persistent watcher that uses
  `start()` with the waiting timer

## [0.4.4] - 2026-06-05

### Fixed

- `start()` now polls for stream activation after finding a room — TikTok
  returns status 4 when a room exists but the stream is not yet broadcasting,
  causing `StreamFetchError` to be thrown instead of waiting for the stream
- Reduced default `checkInterval` from 30s to 3 minutes to avoid rate limits

## [0.4.3] - 2026-06-05

### Fixed

- Eliminated a race condition in abort handling where an `aborted` flag
  set by `addEventListener` could lose the race against Node.js's internal
  process kill, causing a spurious error on Ctrl+C — now uses synchronous
  `signal?.aborted` instead

## [0.4.2] - 2026-06-05

### Fixed

- Added missing `repository` field to `package.json` — required for npm
  provenance verification during publish

## [0.4.1] - 2026-06-05

### Fixed

- `stop()` no longer surfaces an `FFmpeg error: The operation was aborted.`
  error on Ctrl+C — `AbortError` from spawn's signal option is now caught
  and handled gracefully, resolving with partial data

## [0.4.0] - 2026-06-05

### Changed

- Migrated build system from `tsc` to `tsdown` — faster rolldown-based bundling
  with automatic `.d.ts` generation
- Package exports now use `.mjs` and `.d.mts` extensions for unambiguous ESM
- Peer dependency updated to TypeScript `^6`

### Added

- CI workflow runs lint, typecheck, and build on every push and PR
- Release workflow publishes to npm when a `v*` tag is pushed

## [0.3.0] - 2026-06-05

### Fixed

- `stop()` now reliably kills the ffmpeg subprocess even when the abort
  signal was already fired before a new download starts — previously the
  event listener would be silently skipped on already-aborted signals

## [0.2.0] - 2026-06-05

### Added

- `UserNotFoundError` — thrown when a TikTok username doesn't exist, so callers can
  distinguish "account not found" from "account is offline"
- Download examples now handle `UserNotFoundError` cleanly (single-user exits,
  multi-user watcher skips retry)

### Fixed

- Ctrl+C in the multi-user watcher now calls `stop()` on active downloads before
  exiting, so pending segments are remuxed to `.mp4` instead of left as `.ts`
- ffmpeg no longer hangs indefinitely on bad or stalled stream URLs — a 30-second
  startup timeout kills stalled ffmpeg processes and reports the error

[0.7.1]: https://github.com/zfadhli/tokwatchr/compare/v0.7.0...v0.7.1
[0.7.0]: https://github.com/zfadhli/tokwatchr/compare/v0.6.5...v0.7.0
[0.6.5]: https://github.com/zfadhli/tokwatchr/compare/v0.6.4...v0.6.5
[0.6.4]: https://github.com/zfadhli/tokwatchr/compare/v0.6.3...v0.6.4
[0.6.3]: https://github.com/zfadhli/tokwatchr/compare/v0.6.2...v0.6.3
[0.6.2]: https://github.com/zfadhli/tokwatchr/compare/v0.6.1...v0.6.2
[0.6.1]: https://github.com/zfadhli/tokwatchr/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/zfadhli/tokwatchr/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/zfadhli/tokwatchr/compare/v0.4.4...v0.5.0
[0.4.4]: https://github.com/zfadhli/tokwatchr/compare/v0.4.3...v0.4.4
[0.4.3]: https://github.com/zfadhli/tokwatchr/compare/v0.4.2...v0.4.3
[0.4.2]: https://github.com/zfadhli/tokwatchr/compare/v0.4.1...v0.4.2
[0.4.1]: https://github.com/zfadhli/tokwatchr/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/zfadhli/tokwatchr/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/zfadhli/tokwatchr/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/zfadhli/tokwatchr/compare/v0.1.1...v0.2.0
