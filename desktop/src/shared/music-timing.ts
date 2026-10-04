import type { LyricLine, MusicTrack } from "./contracts"

export function projectedMusicPosition(track: MusicTrack, now: number): number {
  const elapsed = track.status === "playing" && track.sampledAt > 0
    ? Math.max(0, now - track.sampledAt) * track.playbackRate
    : 0
  const position = Math.max(0, track.positionMs + elapsed)
  return track.durationMs > 0 ? Math.min(position, track.durationMs) : position
}

export function currentLyricIndex(lines: readonly LyricLine[], positionMs: number): number {
  let left = 0
  let right = lines.length
  while (left < right) {
    const middle = Math.floor((left + right) / 2)
    if (lines[middle]!.timeMs <= positionMs) left = middle + 1
    else right = middle
  }
  return left - 1
}
