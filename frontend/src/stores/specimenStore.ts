import { create } from 'zustand'
import type { DetStatus, Specimen } from '@/types'
import { db, deleteRow, loadAll, putRow, putRows } from '@/hooks/usePersistentStore'

export interface BulkStatusResult {
  /** 实际改了状态的标本数 */
  updated: number
  /** 因处于「待复核」而被跳过的标本 */
  skipped: Specimen[]
}

export interface SpecimenState {
  rows: Specimen[]
  loaded: boolean
  hydrate: () => Promise<void>
  save: (row: Specimen) => Promise<void>
  saveMany: (rows: Specimen[]) => Promise<void>
  remove: (id: string) => Promise<void>
  bulkSetStatus: (ids: string[], status: DetStatus) => Promise<BulkStatusResult>
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
    // 待复核标本只能由独立复核流程推进，批量改状态（含改成「已鉴定」或退回其它状态）一律拦截
    const skipped = targets.filter((row) => row.status === '待复核')
    const skippedIds = new Set(skipped.map((row) => row.id))
    const allowed = targets.filter((row) => !skippedIds.has(row.id))
    await putRows<Specimen>(
      db.specimens,
      allowed.map((row) => ({ ...row, status }))
    )
    await get().hydrate()
    return { updated: allowed.length, skipped }
  },
  codes: () => get().rows.map((row) => row.code)
}))
