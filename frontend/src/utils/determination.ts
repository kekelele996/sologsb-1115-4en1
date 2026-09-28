import type { Determination, Specimen } from '@/types'

/** 学名归一化：去首尾空白、折叠连续空白，用于复核一致性比对 */
export function normalizeConclusion(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toLowerCase()
}

/** 比对复核结论与原结论是否一致 */
export function conclusionAgrees(original: string, review: string): boolean {
  const left = normalizeConclusion(original)
  const right = normalizeConclusion(review)
  return left.length > 0 && left === right
}

/** 取一份标本全部初鉴记录（按日期 + id 倒序） */
export function initialRecords(records: Determination[], specimenId: string): Determination[] {
  return records
    .filter((item) => item.specimenId === specimenId && item.kind === '初鉴')
    .sort((a, b) => (b.date + b.id).localeCompare(a.date + a.id))
}

/** 最近一条初鉴记录（即待复核标本的原结论来源） */
export function latestInitial(records: Determination[], specimenId: string): Determination | null {
  return initialRecords(records, specimenId)[0] ?? null
}

/** 取一份标本全部复核记录（按日期 + id 倒序） */
export function reviewRecords(records: Determination[], specimenId: string): Determination[] {
  return records
    .filter((item) => item.specimenId === specimenId && item.kind === '复核')
    .sort((a, b) => (b.date + b.id).localeCompare(a.date + a.id))
}

/** 标本是否已定名（只有「已鉴定」才算，待复核不得视作已定名） */
export function isSpecimenConfirmed(specimen: Specimen): boolean {
  return specimen.status === '已鉴定'
}
