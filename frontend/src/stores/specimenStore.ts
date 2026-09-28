import { create } from 'zustand'
import type { DetStatus, Specimen } from '@/types'
import { db, deleteRow, loadAll, putRow, putRows } from '@/hooks/usePersistentStore'

export interface SpecimenState {
  rows: Specimen[]
  loaded: boolean
  hydrate: () => Promise<void>
  save: (row: Specimen) => Promise<void>
  saveMany: (rows: Specimen[]) => Promise<void>
  remove: (id: string) => Promise<void>
  /** 批量改状态；返回实际更新与因「待复核」被拦下的标本 id */
  bulkSetStatus: (
    ids: string[],
    status: DetStatus
  ) => Promise<{ updated: string[]; skipped: string[] }>
  codes: () => string[]
}

export const specimenStore = create<SpecimenState>((set, get) => ({
  rows: [],
  loaded: false,
  hydrate: async () => {
    const rows = await loadAll<Specimen>(db.specimens)
    rows.sort((a, b) => a.code.localeCompare(b.code, 'zh-Hans-CN'))
    set({ rows, loaded: true })
  },
  save: async (row) => {
    await putRow<Specimen>(db.specimens, row)
    await get().hydrate()
  },
  saveMany: async (rows) => {
    if (rows.length === 0) return
    await putRows<Specimen>(db.specimens, rows)
    await get().hydrate()
  },
  remove: async (id) => {
    await deleteRow<Specimen>(db.specimens, id)
    await get().hydrate()
  },
  bulkSetStatus: async (ids, status) => {
    const targets = get().rows.filter((row) => ids.includes(row.id))
    // 待复核标本必须走独立复核（复核一致才会进入「已鉴定」），批量改状态一律拦下
    const skipped = targets.filter((row) => row.status === '待复核').map((row) => row.id)
    const skippedSet = new Set(skipped)
    const allowed = targets.filter((row) => !skippedSet.has(row.id))
    if (allowed.length > 0) {
      await putRows<Specimen>(
        db.specimens,
        allowed.map((row) => ({ ...row, status }))
      )
      await get().hydrate()
    }
    return { updated: allowed.map((row) => row.id), skipped }
  },
  codes: () => get().rows.map((row) => row.code)
}))
