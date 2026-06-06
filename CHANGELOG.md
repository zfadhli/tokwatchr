# Changelog

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

[0.6.0]: https://github.com/zfadhli/tokwatchr/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/zfadhli/tokwatchr/compare/v0.4.4...v0.5.0
[0.4.4]: https://github.com/zfadhli/tokwatchr/compare/v0.4.3...v0.4.4
[0.4.3]: https://github.com/zfadhli/tokwatchr/compare/v0.4.2...v0.4.3
[0.4.2]: https://github.com/zfadhli/tokwatchr/compare/v0.4.1...v0.4.2
[0.4.1]: https://github.com/zfadhli/tokwatchr/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/zfadhli/tokwatchr/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/zfadhli/tokwatchr/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/zfadhli/tokwatchr/compare/v0.1.1...v0.2.0
