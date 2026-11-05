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
function createManager(...args) {
  const manager = new MusicManager(...args)
  manager.fetchCatalog = async () => null
  return manager
}
const timingFilename = path.resolve(__dirname, '../src/shared/music-timing.ts')
const timingModule = new Module(timingFilename, module)
timingModule.paths = module.paths
timingModule._compile(buildSync({
  entryPoints: [timingFilename], bundle: true, write: false,
  platform: 'node', format: 'cjs', target: 'node20',
}).outputFiles[0].text, timingFilename)
const { currentLyricIndex, projectedMusicPosition, MusicPlaybackTimeline, lyricLookAheadMs } = timingModule.exports

function fakeTime() {
  return { wall: 10000, mono: 1000, wallNow() { return this.wall }, monotonicNow() { return this.mono } }
}

function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

async function promptly(promise) {
  let timer
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('media polling waited for background metadata')), 1000)
    })])
  } finally { clearTimeout(timer) }
}

function sample(overrides = {}) {
  return { sourceAppId: 'cloudmusic.exe', title: '测试歌曲', artist: '歌手',
    status: 'playing', positionMs: 1000, sampledAt: 10000,
    durationMs: 5000, playbackRate: 1, positionSource: 'system', ...overrides }
}

const lyrics = { provider: 'netease', lines: [{ timeMs: 0, text: '歌词' }], plainText: '', matchedTitle: '', matchedArtist: '' }

test('anchors delayed samples once and ignores wall-clock jumps between polls', () => {
  const time = fakeTime()
  const timeline = new MusicPlaybackTimeline(time)
  const track = sample({ sampledAt: 9500, playbackRate: 2 })
  timeline.sample(track)
  assert.equal(timeline.position(track), 2000)
  time.wall += 3600000
  time.mono += 250
  assert.equal(timeline.position(track), 2500)
  time.wall -= 7200000
  time.mono += 250
  assert.equal(timeline.position(track), 3000)
  const paused = { ...track, positionMs: 3000, sampledAt: time.wall, status: 'paused' }
  timeline.sample(paused)
  time.mono += 1000
  assert.equal(timeline.position(paused), 3000)
  const seek = { ...track, positionMs: 100, sampledAt: time.wall }
  timeline.sample(seek)
  time.mono += 250
  assert.equal(timeline.position(seek), 600)
  time.mono += 10000
  assert.equal(timeline.position(seek), 5000)
})

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

test('keeps artwork in the background and separates lyric pre-reading from real progress', async () => {
  const time = fakeTime()
  const cover = deferred()
  let coverCalls = 0
  const manager = createManager(filename, time)
  manager.sidecar = async (request) => {
    if (request.include_artwork) { coverCalls++; return cover.promise }
    return { sessions: [sample()] }
  }
  const track = await promptly(manager.currentTrack())
  assert.equal(track.sampledAt, 10000)
  assert.equal(track.artworkUrl, '')
  await promptly(manager.currentTrack())
  assert.equal(coverCalls, 1)
  manager.latestSnapshot = { track, lines: [{ timeMs: 0, text: '前句' }, { timeMs: 1250, text: '当前句' }] }
  assert.equal(manager.touchStatus().musicPositionMs, 1000)
  assert.equal(manager.touchStatus().musicLyricCurrent, '当前句')
  assert.equal(lyricLookAheadMs, 350)
  time.wall += 400
  time.mono += 400
  assert.equal(manager.touchStatus().musicPositionMs, 1400)
  time.wall -= 3600000
  time.mono += 350
  assert.equal(manager.touchStatus().musicPositionMs, 1750)
  cover.resolve({ sessions: [sample({ artworkUrl: 'data:image/png;base64,cover' })] })
  await Promise.all(manager.artworkRequests.values())
  assert.equal((await manager.currentTrack()).artworkUrl, 'data:image/png;base64,cover')
})

test('catalog metadata fills missing duration and artwork without fabricating live progress or leaking across tracks', async () => {
  const time = fakeTime()
  const manager = createManager(filename, time)
  let current = sample({ positionMs: null, durationMs: null, positionSource: 'unavailable' })
  const first = deferred(), second = deferred()
  manager.sidecar = async () => ({ sessions: [current] })
  manager.fetchCatalog = track => track.title === '测试歌曲' ? first.promise : second.promise
  const initial = await promptly(manager.currentTrack())
  assert.equal(initial.durationMs, 0)
  assert.equal(initial.positionSource, 'estimated')
  current = sample({ title: '第二首', positionMs: null, durationMs: null, positionSource: 'unavailable' })
  await manager.currentTrack()
  first.resolve({ durationMs: 100000, artworkUrl: 'data:image/png;base64,first' })
  await Promise.all([...manager.catalogRequests.values()].filter((_, index) => index === 0))
  const before = await manager.currentTrack()
  assert.equal(before.title, '第二首'); assert.equal(before.durationMs, 0); assert.equal(before.artworkUrl, '')
  second.resolve({ durationMs: 200000, artworkUrl: 'data:image/png;base64,second' })
  await Promise.all(manager.catalogRequests.values())
  const after = await manager.currentTrack()
  assert.equal(after.durationMs, 200000); assert.equal(after.artworkUrl, 'data:image/png;base64,second')
  assert.equal(after.positionSource, 'estimated')
  current = sample({ title: '第二首', durationMs: 180000, positionMs: 10000, positionSource: 'system' })
  const precise = await manager.currentTrack()
  assert.equal(precise.durationMs, 180000); assert.equal(precise.positionSource, 'system')
})

test('catalog artwork and duration require an exact song and artist match', async () => {
  const manager = new MusicManager(filename)
  const originalFetch = global.fetch
  const requested = []
  let artist = '其他歌手'
  global.fetch = async url => {
    const address = String(url); requested.push(address)
    if (address.includes('/api/search/get')) return new Response(JSON.stringify({ result: { songs: [{ id: 123, name: '测试歌曲', artists: [{ name: artist }] }] } }), { status: 200 })
    if (address.includes('/api/song/detail/')) return new Response(JSON.stringify({ songs: [{ id: 123, duration: 123000, album: { picUrl: 'https://p1.music.126.net/test.jpg' } }] }), { status: 200 })
    return { ok: true, url: address, headers: new Headers({ 'content-type': 'image/jpeg' }), body: new ReadableStream({ start(controller) { controller.enqueue(Uint8Array.of(1, 2, 3)); controller.close() } }) }
  }
  try {
    assert.equal(await manager.fetchCatalog(sample({ trackId: '' })), null)
    assert.equal(requested.length, 1)
    artist = '歌手'
    const result = await manager.fetchCatalog(sample({ trackId: '' }))
    assert.deepEqual(result, { durationMs: 123000, artworkUrl: 'data:image/jpeg;base64,AQID' })
  } finally { global.fetch = originalFetch }
})

test('polls pause, seek and track changes while lyrics are stalled, isolating late replies', async () => {
  const time = fakeTime()
  const manager = createManager(filename, time)
  let current = sample()
  const first = deferred()
  const second = deferred()
  const calls = []
  manager.sidecar = async () => ({ sessions: [current] })
  manager.findLyrics = async (track) => { calls.push(track.title); return track.title === '测试歌曲' ? first.promise : second.promise }
  const initial = await promptly(manager.snapshot())
  assert.equal(initial.track.positionMs, 1000)
  current = sample({ status: 'paused', positionMs: 2500 })
  const paused = await promptly(manager.snapshot())
  assert.equal(paused.track.status, 'paused')
  assert.equal(paused.track.positionMs, 2500)
  assert.equal(calls.length, 1)
  current = sample({ title: '第二首', positionMs: 0 })
  await promptly(manager.snapshot())
  first.resolve({ ...lyrics, lines: [{ timeMs: 0, text: '旧歌歌词' }] })
  await manager.lyricRequests.get(manager.lyricKey(initial.track))
  assert.equal(manager.latestSnapshot.track.title, '第二首')
  assert.equal(manager.latestSnapshot.lines.length, 0)
  const pendingSecond = [...manager.lyricRequests.values()]
  second.resolve({ ...lyrics, lines: [{ timeMs: 0, text: '新歌歌词' }] })
  await Promise.all(pendingSecond)
  assert.equal(manager.latestSnapshot.lines[0].text, '新歌歌词')
})

test('bounds failed lyric retries and never marks missing QQ progress as precise', async () => {
  const time = fakeTime()
  const manager = createManager(filename, time)
  const current = sample({ sourceAppId: 'QQMusic.exe', positionMs: null, durationMs: null, positionSource: 'unavailable' })
  manager.sidecar = async () => ({ sessions: [current] })
  let requests = 0
  manager.findLyrics = async () => { requests++; throw new Error('offline') }
  const initial = await manager.snapshot()
  await Promise.all(manager.lyricRequests.values())
  for (let i = 0; i < 3; i++) await manager.snapshot()
  assert.equal(requests, 1)
  assert.equal(initial.track.positionSource, 'estimated')
  time.mono += 30001
  time.wall -= 3600000
  manager.findLyrics = async () => { requests++; return lyrics }
  const next = await manager.snapshot()
  await Promise.all(manager.lyricRequests.values())
  assert.equal(requests, 2)
  assert.equal(next.track.positionMs, 30001)
  assert.equal(manager.latestSnapshot.syncReady, false)
  assert.equal(manager.latestSnapshot.lines.length, 1)
})

test('keeps manual QQ calibration and freezes the elapsed position when pausing', async () => {
  const time = fakeTime()
  const manager = createManager(filename, time)
  let current = sample({ sourceAppId: 'QQMusic.exe', positionMs: null, positionSource: 'unavailable', playbackRate: 2 })
  manager.findLyrics = async () => null
  manager.sidecar = async (request) => {
    if (request.operation === 'control_media') {
      current = { ...current, status: request.action === 'pause' ? 'paused' : 'playing' }
      return { acknowledged: true }
    }
    return { sessions: [current] }
  }
  await manager.snapshot()
  await manager.calibrate(1000)
  time.mono += 500
  time.wall += 500
  const paused = await manager.control({ action: 'pause' })
  assert.equal(paused.track.positionMs, 2000)
  assert.equal(paused.track.positionSource, 'manual')
  time.mono += 1000
  time.wall += 1000
  assert.equal((await manager.snapshot()).track.positionMs, 2000)
})

test('retries failed artwork after the cooldown without blocking playback', async () => {
  const time = fakeTime()
  const manager = createManager(filename, time)
  let calls = 0
  manager.sidecar = async (request) => {
    if (request.include_artwork) { calls++; throw new Error('cover unavailable') }
    return { sessions: [sample()] }
  }
  await promptly(manager.currentTrack())
  await Promise.all(manager.artworkRequests.values())
  await promptly(manager.currentTrack())
  assert.equal(calls, 1)
  time.mono += 30001
  time.wall += 30001
  await promptly(manager.currentTrack())
  await Promise.all(manager.artworkRequests.values())
  assert.equal(calls, 2)
})

test('publishes position and timestamp at the same instant for desktop and Touch', async () => {
  const time = fakeTime()
  const manager = createManager(filename, time)
  manager.sidecar = async () => ({ sessions: [sample({ sampledAt: 9500 })] })
  manager.findLyrics = async () => null
  const snapshot = await manager.snapshot()
  assert.equal(snapshot.track.positionMs, 1500)
  assert.equal(snapshot.track.sampledAt, 10000)
  assert.equal(manager.touchStatus().musicPositionMs, 1500)
  time.mono += 200
  time.wall += 200
  assert.equal(manager.touchStatus().musicPositionMs, 1700)
  assert.equal(projectedMusicPosition(snapshot.track, time.wall), 1700)
})

test('advances estimated plain lyrics for Touch using the playback position', () => {
  const manager = createManager(filename)
  manager.latestSnapshot = {
    track: { status: 'paused', positionMs: 1500, sampledAt: 10000, playbackRate: 1, durationMs: 3000 },
    lines: [], plainText: '第一句\n第二句\n第三句',
  }
  assert.equal(manager.touchStatus().musicLyricPrevious, '第一句')
  assert.equal(manager.touchStatus().musicLyricCurrent, '第二句')
  assert.equal(manager.touchStatus().musicLyricNext, '第三句')
})

test('lets NetEase cycle once from its own live player mode', { skip: process.platform !== 'win32' }, async () => {
  const manager = createManager(filename)
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

test('includes shuffle in the NetEase four-mode cycle', { skip: process.platform !== 'win32' }, async () => {
  const manager = createManager(filename)
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

test('maps every known NetEase mode to the next of four modes', { skip: process.platform !== 'win32' }, async () => {
  const cases = [
    [{ shuffleActive: false, repeatMode: 'none' }, { action: 'set-repeat', repeat_mode: 'list' }],
    [{ shuffleActive: false, repeatMode: 'list' }, { action: 'set-repeat', repeat_mode: 'track' }],
    [{ shuffleActive: false, repeatMode: 'track' }, { action: 'set-shuffle', enabled: true }],
    [{ shuffleActive: true, repeatMode: 'list' }, { action: 'set-repeat', repeat_mode: 'none' }],
  ]
  for (const [mode, expected] of cases) {
    const manager = createManager(filename)
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
  const manager = createManager(filename)
  manager.lastTrack = { sourceAppId: 'other.exe', source: 'other', repeatMode: 'list' }
  manager.sidecar = async () => ({ sessions: [{ sourceAppId: 'cloudmusic.exe', repeatMode: 'unknown' }] })
  await assert.rejects(manager.control({ action: 'cycle-repeat' }), /未提供当前循环模式/)
})

test('keeps the progress sample timestamp and downgrades lost precise progress', async () => {
  const time = fakeTime()
  const manager = createManager(filename, time)
  let current = sample({ sourceAppId: 'QQMusic.exe', sampledAt: time.wall - 1000, positionSource: 'accessibility' })
  manager.sidecar = async () => ({ sessions: [current] })
  const first = await manager.currentTrack()
  assert.equal(first.sampledAt, current.sampledAt)
  assert.equal(first.positionSource, 'accessibility')
  time.mono += 250
  time.wall -= 3600000
  current = { ...current, positionMs: null, positionSource: 'unavailable' }
  const second = await manager.currentTrack()
  assert.equal(second.positionSource, 'estimated')
  assert.equal(second.positionMs, 2250)
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
  const manager = createManager(filename)
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
