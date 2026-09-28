/** 置信度 */
export const CONFIDENCES = ['高', '中', '低'] as const
export type Confidence = (typeof CONFIDENCES)[number]

/** 鉴定记录类型：初鉴 / 复核 */
export const DET_KINDS = ['初鉴', '复核'] as const
export type DeterminationKind = (typeof DET_KINDS)[number]

/** Determination 鉴定记录 */
export interface Determination {
  id: string
  specimenId: string
  determiner: string
  date: string
  /** 鉴定结论（学名） */
  conclusion: string
  /** 依据文献 */
  reference: string
  confidence: Confidence
  needReview: boolean
  /** 记录类型：初鉴或复核（v3 起，历史记录迁移为「初鉴」） */
  kind: DeterminationKind
  /**
   * 复核结论是否与原结论一致；仅复核记录有值。
   * true 一致 → 标本进入「已鉴定」；false 不一致 → 保留「待复核」。
   */
  agreed: boolean | null
}
