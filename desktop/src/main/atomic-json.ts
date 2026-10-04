import { randomUUID } from "node:crypto"
import { mkdir, rename, unlink, writeFile } from "node:fs/promises"
import path from "node:path"

export async function writeAtomicJson(filename: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filename), { recursive: true, mode: 0o700 })
  const temporary = `${filename}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, JSON.stringify(value, null, 2), { mode: 0o600 })
    await rename(temporary, filename)
  } finally {
    await unlink(temporary).catch(() => undefined)
  }
}
