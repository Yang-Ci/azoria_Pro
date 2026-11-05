import type { LyricLine, MusicTrack } from "./contracts"

export interface PlaybackTimeSource {
  wallNow(): number
  monotonicNow(): number
}

export const playbackTime: PlaybackTimeSource = {
  wallNow: () => Date.now(),
  monotonicNow: () => performance.now(),
}

// Display pre-reading is independent of the actual playback/seek position.
export const lyricLookAheadMs = 350

export class MusicPlaybackTimeline {
  private readonly anchors = new WeakMap<MusicTrack, { positionMs: number; at: number }>()

  constructor(private readonly time: PlaybackTimeSource = playbackTime) {}

  sample(track: MusicTrack): void {
    this.anchors.set(track, {
      positionMs: projectedMusicPosition(track, this.time.wallNow()),
      at: this.time.monotonicNow(),
    })
  }

  position(track: MusicTrack, now = this.time.monotonicNow()): number {
    if (!this.anchors.has(track)) this.sample(track)
    const anchor = this.anchors.get(track)!
    const elapsed = track.status === "playing" ? Math.max(0, now - anchor.at) * track.playbackRate : 0
    const position = Math.max(0, anchor.positionMs + elapsed)
    return track.durationMs > 0 ? Math.min(position, track.durationMs) : position
  }
}

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
