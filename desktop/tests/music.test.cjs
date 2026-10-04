const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const Module = require('node:module')
const { buildSync } = require('esbuild')

const filename = path.resolve(__dirname, '../src/main/music.ts')
const compiled = new Module(filename, module)
compiled.paths = module.paths
compiled._compile(buildSync({
  entryPoints: [filename], bundle: true, write: false,
  platform: 'node', packages: 'external', format: 'cjs', target: 'node20',
}).outputFiles[0].text, filename)
const { artworkCacheKey, lyricProviderOrder, matchScore, neteaseSongId, parseSyncedLyrics, selectMediaSession, sourceName } = compiled.exports
const { MusicManager } = compiled.exports
const timingFilename = path.resolve(__dirname, '../src/shared/music-timing.ts')
const timingModule = new Module(timingFilename, module)
timingModule.paths = module.paths
timingModule._compile(buildSync({
  entryPoints: [timingFilename], bundle: true, write: false,
  platform: 'node', format: 'cjs', target: 'node20',
}).outputFiles[0].text, timingFilename)
const { currentLyricIndex, projectedMusicPosition } = timingModule.exports

test('advances lyrics from the sample clock between media polls', () => {
  const track = { status: 'playing', positionMs: 1000, sampledAt: 10000, playbackRate: 1, durationMs: 5000 }
  const lines = [{ timeMs: 0 }, { timeMs: 1250 }, { timeMs: 2000 }]
  assert.equal(currentLyricIndex(lines, projectedMusicPosition(track, 10249)), 0)
  assert.equal(currentLyricIndex(lines, projectedMusicPosition(track, 10250)), 1)
  assert.equal(currentLyricIndex(lines, projectedMusicPosition(track, 11000)), 2)
})

test('keeps pause, seek, playback rate, and song end on the same lyric clock', () => {
  const track = { status: 'playing', positionMs: 1000, sampledAt: 10000, playbackRate: 2, durationMs: 5000 }
  assert.equal(projectedMusicPosition(track, 10250), 1500)
  assert.equal(projectedMusicPosition({ ...track, status: 'paused' }, 15000), 1000)
  assert.equal(projectedMusicPosition({ ...track, positionMs: 0, sampledAt: 11000 }, 11050), 100)
  assert.equal(projectedMusicPosition(track, 14000), 5000)
  assert.equal(projectedMusicPosition(track, 9990), 1000)
})

test('selects a zero-time lyric and the last of simultaneous timestamps', () => {
  const lines = [{ timeMs: 0 }, { timeMs: 1000 }, { timeMs: 1000 }, { timeMs: 2000 }]
  assert.equal(currentLyricIndex([], 0), -1)
  assert.equal(currentLyricIndex([{ timeMs: 1000 }], 999), -1)
  assert.equal(currentLyricIndex(lines, 0), 0)
  assert.equal(currentLyricIndex(lines, 1000), 2)
})

test('compensates for artwork and IPC time when publishing Touch lyrics', async (t) => {
  let now = 10000
  t.mock.method(Date, 'now', () => now)
  const manager = new MusicManager(filename)
  manager.sidecar = async (request) => {
    if (request.include_artwork) now += 400
    return { sessions: [{
      sourceAppId: 'cloudmusic.exe', title: '测试歌曲', artist: '歌手',
      status: 'playing', positionMs: 1000, sampledAt: 10000,
      durationMs: 5000, playbackRate: 1, positionSource: 'system',
    }] }
  }
  const track = await manager.currentTrack()
  assert.equal(track.sampledAt, 10000)
  manager.latestSnapshot = { track, lines: [{ timeMs: 0, text: '前句' }, { timeMs: 1250, text: '当前句' }] }
  assert.equal(manager.touchStatus().musicPositionMs, 1400)
  assert.equal(manager.touchStatus().musicLyricCurrent, '当前句')
  now += 350
  assert.equal(manager.touchStatus().musicPositionMs, 1750)
})

test('advances estimated plain lyrics for Touch using the playback position', () => {
  const manager = new MusicManager(filename)
  manager.latestSnapshot = {
    track: { status: 'paused', positionMs: 1500, sampledAt: 10000, playbackRate: 1, durationMs: 3000 },
    lines: [], plainText: '第一句\n第二句\n第三句',
  }
  assert.equal(manager.touchStatus().musicLyricPrevious, '第一句')
  assert.equal(manager.touchStatus().musicLyricCurrent, '第二句')
  assert.equal(manager.touchStatus().musicLyricNext, '第三句')
})

test('lets NetEase cycle once from its own live player mode', async () => {
  const manager = new MusicManager(filename)
  manager.lastTrack = { sourceAppId: 'cloudmusic.exe', source: 'netease', repeatMode: 'unknown' }
  const calls = []
  manager.sidecar = async (request) => {
    calls.push(request)
    return { acknowledged: true }
  }
  manager.snapshot = async () => ({})
  await manager.control({ action: 'cycle-repeat' })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].action, 'cycle-repeat')
})

test('includes shuffle in the NetEase four-mode cycle', async () => {
  const manager = new MusicManager(filename)
  manager.lastTrack = { sourceAppId: 'cloudmusic.exe', source: 'netease', shuffleActive: false, repeatMode: 'track' }
  const calls = []
  manager.sidecar = async (request) => {
    calls.push(request)
    return request.operation === 'current_media'
      ? { sessions: [{ sourceAppId: 'cloudmusic.exe', shuffleActive: false, repeatMode: 'track' }] }
      : { acknowledged: true }
  }
  manager.snapshot = async () => ({})
  await manager.control({ action: 'cycle-play-mode' })
  assert.equal(calls[1].action, 'set-shuffle')
  assert.equal(calls[1].enabled, true)
})

test('maps every known NetEase mode to the next of four modes', async () => {
  const cases = [
    [{ shuffleActive: false, repeatMode: 'none' }, { action: 'set-repeat', repeat_mode: 'list' }],
    [{ shuffleActive: false, repeatMode: 'list' }, { action: 'set-repeat', repeat_mode: 'track' }],
    [{ shuffleActive: false, repeatMode: 'track' }, { action: 'set-shuffle', enabled: true }],
    [{ shuffleActive: true, repeatMode: 'list' }, { action: 'set-repeat', repeat_mode: 'none' }],
  ]
  for (const [mode, expected] of cases) {
    const manager = new MusicManager(filename)
    manager.lastTrack = { sourceAppId: 'cloudmusic.exe', source: 'netease', ...mode }
    const calls = []
    manager.sidecar = async (request) => {
      calls.push(request)
      return request.operation === 'current_media'
        ? { sessions: [{ sourceAppId: 'cloudmusic.exe', ...mode }] }
        : { acknowledged: true }
    }
    manager.snapshot = async () => ({})
    await manager.control({ action: 'cycle-play-mode' })
    assert.deepEqual({ action: calls[1].action, ...(calls[1].repeat_mode ? { repeat_mode: calls[1].repeat_mode } : {}), ...(calls[1].enabled === true ? { enabled: true } : {}) }, expected)
  }
})

test('does not invent a repeat mode when the player stops reporting it', async () => {
  const manager = new MusicManager(filename)
  manager.lastTrack = { sourceAppId: 'other.exe', source: 'other', repeatMode: 'list' }
  manager.sidecar = async () => ({ sessions: [{ sourceAppId: 'cloudmusic.exe', repeatMode: 'unknown' }] })
  await assert.rejects(manager.control({ action: 'cycle-repeat' }), /未提供当前循环模式/)
})

test('keeps the progress sample timestamp and downgrades lost precise progress', async () => {
  const manager = new MusicManager(filename)
  let sample = { sourceAppId: 'QQMusic.exe', title: '测试歌曲', status: 'playing', positionMs: 1000, sampledAt: Date.now() - 1000, positionSource: 'accessibility' }
  manager.sidecar = async () => ({ sessions: [sample] })
  const first = await manager.currentTrack()
  assert.equal(first.sampledAt, sample.sampledAt)
  assert.equal(first.positionSource, 'accessibility')
  sample = { ...sample, positionMs: null, positionSource: 'unavailable' }
  const second = await manager.currentTrack()
  assert.equal(second.positionSource, 'estimated')
  assert.ok(second.positionMs >= 2000)
})

test('parses LRC timestamps and ignores metadata', () => {
  assert.deepEqual(parseSyncedLyrics('[ar:歌手]\n[00:01.25]第一句\n[01:02.003][01:03.00]重复句'), [
    { timeMs: 1250, text: '第一句' },
    { timeMs: 62003, text: '重复句' },
    { timeMs: 63000, text: '重复句' },
  ])
})

test('normalizes non-breaking and Unicode spaces in lyrics for Touch', () => {
  assert.deepEqual(parseSyncedLyrics('[00:01.00]祈祷你靠近我\u00a0抱紧我\n[00:02.00]下一\u3000句'), [
    { timeMs: 1000, text: '祈祷你靠近我 抱紧我' },
    { timeMs: 2000, text: '下一 句' },
  ])
})

test('converts curly quotes in lyrics for the Touch font', () => {
  assert.deepEqual(parseSyncedLyrics('[00:01.00]Smoke a 3.5 that’s a big roll\n[00:02.00]I’m skiing no mask let the wind blow\n[00:03.00]It\u02bcs another \uff07apostrophe variant'), [
    { timeMs: 1000, text: 'Smoke a 3.5 that\'s a big roll' },
    { timeMs: 2000, text: 'I\'m skiing no mask let the wind blow' },
    { timeMs: 3000, text: 'It\'s another \'apostrophe variant' },
  ])
})

test('matches player titles with parenthesized edition text', () => {
  const track = { title: '会呼吸的痛 (我发誓不再说谎了)', artist: '呆呆破' }
  assert.ok(matchScore(track, '会呼吸的痛', '呆呆破') >= 10)
  assert.ok(matchScore(track, '会呼吸的痛（伴奏）', '另一位歌手') < 6)
})

test('recognizes NetEase Cloud Music and QQ Music sessions', () => {
  assert.equal(sourceName('QQMusic.exe'), 'qqmusic')
  assert.equal(sourceName('cloudmusic.exe'), 'netease')
  assert.equal(sourceName('chrome.exe'), 'other')
})

test('does not reuse browser artwork when MPRIS keeps the same track ID', () => {
  const browserTrackId = '/org/chromium/MediaPlayer2/TrackList/TrackA'
  assert.notEqual(
    artworkCacheKey(browserTrackId, 'other\0first song\0first artist'),
    artworkCacheKey(browserTrackId, 'other\0second song\0second artist'),
  )
  assert.equal(
    artworkCacheKey(browserTrackId, 'other\0first song\0first artist'),
    artworkCacheKey(browserTrackId, 'other\0first song\0first artist'),
  )
})

test('tries the currently playing source catalog first', () => {
  assert.deepEqual(lyricProviderOrder('netease'), ['netease', 'qqmusic', 'lrclib'])
  assert.deepEqual(lyricProviderOrder('qqmusic'), ['qqmusic', 'netease', 'lrclib'])
})

test('extracts the NetEase song ID published through SMTC genre metadata', () => {
  assert.equal(neteaseSongId('NCM-1974443814'), '1974443814')
  assert.equal(neteaseSongId('QQ-0039MnYb0qxYhV'), null)
  assert.equal(neteaseSongId(''), null)
})

test('keeps the actual playback source selected after it is paused', () => {
  const sessions = [
    { sourceAppId: 'QQMusic.exe', title: '旧 QQ 歌曲', artist: 'QQ 歌手', status: 'paused' },
    { sourceAppId: 'cloudmusic.exe', title: '当前网易云歌曲', artist: '网易云歌手', status: 'paused' },
  ]
  const previous = { source: 'netease', title: '当前网易云歌曲', artist: '网易云歌手' }
  assert.equal(selectMediaSession(sessions, previous), sessions[1])
  sessions[0].status = 'playing'
  assert.equal(selectMediaSession(sessions, previous), sessions[0])
})

test('publishes the surrounding lyric lines for Touch', () => {
  const manager = new MusicManager(filename)
  manager.latestSnapshot = {
    track: {
      title: '测试歌曲', artist: '测试歌手', source: 'netease', status: 'paused',
      positionMs: 1500, durationMs: 3000, sampledAt: Date.now(), playbackRate: 1,
      shuffleActive: false, repeatMode: 'list',
    },
    lines: [
      { timeMs: 0, text: '上三句' },
      { timeMs: 500, text: '上两句' },
      { timeMs: 800, text: '上一句' },
      { timeMs: 1000, text: '当前歌词' },
      { timeMs: 2000, text: '下一句' },
      { timeMs: 2500, text: '下两句' },
      { timeMs: 2800, text: '下三句' },
    ],
  }
  const status = manager.touchStatus()
  assert.equal(status.musicLyricPrevious, '上一句')
  assert.equal(status.musicLyricCurrent, '当前歌词')
  assert.equal(status.musicLyricNext, '下一句')
  assert.equal(status.musicLyricPrevious3, '上三句')
  assert.equal(status.musicLyricPrevious2, '上两句')
  assert.equal(status.musicLyricNext2, '下两句')
  assert.equal(status.musicLyricNext3, '下三句')
  assert.equal(status.musicCanSeek, false)
  assert.equal(status.musicPositionMs, 1500)
  assert.equal(status.musicDurationMs, 3000)
})
