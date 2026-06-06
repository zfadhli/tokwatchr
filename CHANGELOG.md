# Changelog

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

[0.2.0]: https://github.com/zfadhli/tokwatchr/compare/v0.1.1...v0.2.0
