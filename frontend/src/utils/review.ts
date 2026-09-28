import type { Determination, ReviewVerdict } from '@/types'

/** 结论归一化：去首尾空白、折叠内部空白、转小写，避免「Carabus  sp.」与「carabus sp.」误判不一致 */
export function normalizeConclusion(conclusion: string): string {
  return conclusion.trim().replace(/\s+/g, ' ').toLowerCase()
}

/** 复核结论比对：归一化后相同即视为一致 */
export function compareConclusion(reviewConclusion: string, initialConclusion: string): ReviewVerdict {
  return normalizeConclusion(reviewConclusion) === normalizeConclusion(initialConclusion) ? '一致' : '不一致'
}

/**
 * 取标本的初鉴记录（复核独立性的基准）：
 * 类型为「初鉴」的记录中日期最早的一条；兼容缺 kind 字段的 v2 历史数据。
 */
export function initialDetermination(
  rows: Determination[],
  specimenId: string
): Determination | null {
  const initials = rows
    .filter((item) => item.specimenId === specimenId && (item.kind ?? '初鉴') === '初鉴')
    .sort((a, b) => (a.date + a.id).localeCompare(b.date + b.id))
  return initials[0] ?? null
}

/** 取标本最近一次复核记录（用于展示复核进展） */
export function latestReviewDetermination(
  rows: Determination[],
  specimenId: string
): Determination | null {
  const reviews = rows
    .filter((item) => item.specimenId === specimenId && item.kind === '复核')
    .sort((a, b) => (b.date + b.id).localeCompare(a.date + a.id))
  return reviews[0] ?? null
}
