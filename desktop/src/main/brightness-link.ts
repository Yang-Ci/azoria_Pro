import { randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import path from "node:path"
import type { BrightnessBaseline, BrightnessLinkSettings, BrightnessLinkSnapshot, BrightnessScene, ControlRequest, MonitorStatus } from "../shared/contracts"
import type { MonitorController, ControlSource } from "./monitor"
import { writeAtomicJson } from "./atomic-json"

function baselines(input: unknown): BrightnessBaseline[] {
  if (!Array.isArray(input) || input.length > 16) throw new Error("最多支持 16 块联动显示器")
  const seen = new Set<string>()
  return input.map(item => {
    if (!item || typeof item.displayId !== "string" || !item.displayId || item.displayId.length > 128 || seen.has(item.displayId)
      || !Number.isInteger(item.baseline) || item.baseline < 0 || item.baseline > 100) throw new Error("显示器基准亮度无效")
    seen.add(item.displayId)
    return { displayId: item.displayId, baseline: item.baseline }
  })
}

export function offsetRange(displays: BrightnessBaseline[]): { minimumOffset: number; maximumOffset: number } {
  return displays.length ? { minimumOffset: -Math.min(...displays.map(item => item.baseline)), maximumOffset: 100 - Math.max(...displays.map(item => item.baseline)) }
    : { minimumOffset: 0, maximumOffset: 0 }
}

export class BrightnessLinkManager {
  private state: BrightnessLinkSettings & { offset: number; scenes: BrightnessScene[]; activeSceneId: string | null } = { enabled: false, displays: [], offset: 0, scenes: [], activeSceneId: null }
  private results: BrightnessLinkSnapshot["results"] = []
  private queue: Promise<unknown> = Promise.resolve()
  private previewSequence = 0
  private linkGeneration = 0
  private suspended = false
  private readonly filename: string
  constructor(userData: string, private readonly monitor: MonitorController) { this.filename = path.join(userData, "brightness-link.json") }

  async initialize(): Promise<void> {
    try {
      const data = JSON.parse(await readFile(this.filename, "utf8"))
      if (typeof data.enabled !== "boolean" || !Array.isArray(data.scenes) || data.scenes.length > 16) throw new Error("亮度联动配置无效")
      const displays = baselines(data.displays)
      const scenes: BrightnessScene[] = data.scenes.map((scene: BrightnessScene) => {
        if (typeof scene.id !== "string" || !/^[a-z0-9-]{1,64}$/i.test(scene.id) || typeof scene.name !== "string" || !scene.name.trim() || scene.name.length > 40) throw new Error("亮度场景无效")
        const selected = baselines(scene.displays)
        if (!selected.length) throw new Error("场景没有显示器")
        return { id: scene.id, name: scene.name, displays: selected }
      })
      if (new Set(scenes.map(item => item.id)).size !== scenes.length || data.enabled && !displays.length) throw new Error("亮度联动配置无效")
      const range = offsetRange(displays)
      const offset = Number.isInteger(data.offset) ? Math.max(range.minimumOffset, Math.min(range.maximumOffset, data.offset)) : 0
      this.state = { enabled: data.enabled, displays, offset, scenes, activeSceneId: scenes.some(item => item.id === data.activeSceneId) ? data.activeSceneId : null }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") this.results = [{ displayId: "", brightness: null, error: "亮度联动配置读取失败，原文件已保留；请重新保存设置" }]
    }
  }
  private enabled(): boolean { return this.state.enabled && !this.suspended }
  snapshot(): BrightnessLinkSnapshot { return structuredClone({ ...this.state, enabled: this.enabled(), ...offsetRange(this.state.displays), results: this.results }) }
  private serial<T>(work: () => Promise<T>): Promise<T> { const result = this.queue.then(work); this.queue = result.catch(() => undefined); return result }
  private async store(next: typeof this.state): Promise<void> { await writeAtomicJson(this.filename, next); this.state = next }
  setEnabled(enabled: boolean): Promise<BrightnessLinkSnapshot> {
    if (typeof enabled !== "boolean") throw new Error("亮度联动设置无效")
    if (enabled && !this.state.displays.length) throw new Error("请先保存参与联动的显示器和基准值")
    const generation = ++this.linkGeneration
    if (!enabled) this.suspended = true
    return this.serial(async () => {
      await this.store({ ...this.state, enabled })
      if (generation === this.linkGeneration) this.suspended = false
      this.results = []
      return this.snapshot()
    })
  }
  async save(input: BrightnessLinkSettings): Promise<BrightnessLinkSnapshot> {
    if (!input || typeof input.enabled !== "boolean") throw new Error("亮度联动设置无效")
    const displays = baselines(input.displays)
    if (input.enabled && !displays.length) throw new Error("请先选择参与联动的显示器")
    const generation = ++this.linkGeneration
    if (!input.enabled) this.suspended = true
    return this.serial(async () => {
      await this.store({ ...this.state, enabled: input.enabled, displays, offset: 0, activeSceneId: null })
      if (generation === this.linkGeneration) this.suspended = false
      this.results = []
      return this.snapshot()
    })
  }
  capture(displayIds: string[]): Promise<BrightnessBaseline[]> {
    if (!Array.isArray(displayIds) || !displayIds.length || displayIds.length > 16 || new Set(displayIds).size !== displayIds.length || displayIds.some(id => typeof id !== "string" || !id || id.length > 128)) throw new Error("请选择有效的显示器")
    return this.serial(() => this.readBaselines(displayIds))
  }
  private async readBaselines(displayIds: string[]): Promise<BrightnessBaseline[]> {
    const result: BrightnessBaseline[] = []
    for (const displayId of displayIds) {
      const controller = await this.monitor.forDisplay(displayId)
      result.push({ displayId, baseline: Math.round(await controller.brightness()) })
    }
    return result
  }
  private async apply(offset: number, source: ControlSource, final = true, current: () => boolean = () => true): Promise<BrightnessLinkSnapshot> {
    if (!this.state.displays.length) throw new Error("请先保存联动显示器的基准值")
    const range = offsetRange(this.state.displays)
    const clamped = Math.max(range.minimumOffset, Math.min(range.maximumOffset, offset))
    if (!current()) return this.snapshot()
    this.state = { ...this.state, offset: clamped, activeSceneId: null }
    this.results = []
    await this.monitor.coordinateBrightness(async () => {
      const results = await Promise.all(this.state.displays.map(async item => {
        if (!current()) return null
        try {
          const controller = await this.monitor.forDisplay(item.displayId)
          if (!current()) return null
          const value = await controller.control({ control: "brightness", value: item.baseline + clamped, final }, source)
          this.monitor.acceptBrightness(item.displayId, value.brightness)
          return { displayId: item.displayId, brightness: value.brightness, error: null }
        } catch (error) { return { displayId: item.displayId, brightness: null, error: error instanceof Error ? error.message : "亮度设置失败" } }
      }))
      this.results = results.filter((item): item is NonNullable<typeof item> => item !== null)
    })
    // Drag previews only write hardware; persist and verify once on release.
    if (final && current()) await this.store(this.state)
    return this.snapshot()
  }
  setOffset(offset: number): Promise<BrightnessLinkSnapshot> {
    if (!Number.isInteger(offset) || offset < -100 || offset > 100) throw new Error("亮度偏移无效")
    const generation = this.linkGeneration
    return this.serial(() => {
      if (!this.enabled()) throw new Error("请先启用亮度联动")
      return this.apply(offset, "desktop-ui", true, () => generation === this.linkGeneration && this.enabled())
    })
  }
  control(request: ControlRequest, source: ControlSource): Promise<MonitorStatus> {
    if (request.control !== "brightness") return this.monitor.control(request, source)
    const sequence = ++this.previewSequence
    const generation = this.linkGeneration
    const activeId = this.monitor.connectionSnapshot().displayId
    if (!this.enabled() || !this.state.displays.some(item => item.displayId === activeId)) return this.monitor.control(request, source)
    return this.serial(async () => {
      if (generation !== this.linkGeneration || activeId !== this.monitor.connectionSnapshot().displayId) return this.monitor.snapshot()
      const baseline = this.state.displays.find(item => item.displayId === activeId)
      if (!this.enabled() || !baseline) return this.monitor.snapshot()
      if (typeof request.value !== "number" || !Number.isFinite(request.value) || request.value < 0 || request.value > 100) throw new Error("亮度数值无效")
      if (request.final === false && sequence !== this.previewSequence) return this.monitor.snapshot()
      const result = await this.apply(Math.round(request.value) - baseline.baseline, source, request.final !== false,
        () => generation === this.linkGeneration && this.enabled() && activeId === this.monitor.connectionSnapshot().displayId)
      const active = result.results.find(item => item.displayId === activeId)
      if (active?.error) throw new Error(active.error)
      return this.monitor.snapshot()
    })
  }
  adjust(delta: number): Promise<unknown> {
    const generation = this.linkGeneration
    return this.serial(async () => {
      if (generation !== this.linkGeneration) return this.monitor.snapshot()
      if (this.enabled() && this.state.displays.length) return this.apply(this.state.offset + delta, "internal", true, () => generation === this.linkGeneration && this.enabled())
      const value = await this.monitor.brightness()
      return this.monitor.control({ control: "brightness", value: Math.max(0, Math.min(100, value + delta)), final: true }, "internal")
    })
  }
  saveScene(name: string): Promise<BrightnessLinkSnapshot> {
    if (typeof name !== "string" || !name.trim() || name.trim().length > 40) throw new Error("场景名称需为 1–40 个字符")
    return this.serial(async () => {
      if (this.state.scenes.length >= 16) throw new Error("最多保存 16 个亮度场景")
      const ids = this.state.displays.length ? this.state.displays.map(item => item.displayId) : [this.monitor.connectionSnapshot().displayId]
      const displays = await this.readBaselines(ids)
      const scene = { id: randomUUID(), name: name.trim(), displays }
      await this.store({ ...this.state, scenes: [...this.state.scenes, scene] })
      return this.snapshot()
    })
  }
  private async useScene(id: string, generation: number): Promise<BrightnessLinkSnapshot> {
    if (generation !== this.linkGeneration) return this.snapshot()
    const scene = this.state.scenes.find(item => item.id === id)
    if (!scene) throw new Error("场景不存在")
    await this.store({ ...this.state, displays: structuredClone(scene.displays), offset: 0, activeSceneId: null })
    await this.apply(0, "internal", true, () => generation === this.linkGeneration)
    if (generation === this.linkGeneration && this.results.every(item => !item.error)) await this.store({ ...this.state, activeSceneId: id })
    return this.snapshot()
  }
  applyScene(id: string): Promise<BrightnessLinkSnapshot> {
    const generation = this.linkGeneration
    return this.serial(() => this.useScene(id, generation))
  }
  nextScene(): Promise<BrightnessLinkSnapshot> {
    const generation = this.linkGeneration
    return this.serial(async () => {
      if (generation !== this.linkGeneration) return this.snapshot()
      if (!this.state.scenes.length) throw new Error("请先保存一个亮度场景")
      const index = this.state.scenes.findIndex(item => item.id === this.state.activeSceneId)
      return this.useScene(this.state.scenes[(index + 1) % this.state.scenes.length]!.id, generation)
    })
  }
  deleteScene(id: string): Promise<BrightnessLinkSnapshot> {
    return this.serial(async () => {
      await this.store({ ...this.state, scenes: this.state.scenes.filter(item => item.id !== id), activeSceneId: this.state.activeSceneId === id ? null : this.state.activeSceneId })
      return this.snapshot()
    })
  }
}
