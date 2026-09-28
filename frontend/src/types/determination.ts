/** 置信度 */
export const CONFIDENCES = ['高', '中', '低'] as const
export type Confidence = (typeof CONFIDENCES)[number]

/** 鉴定记录类型：初鉴 / 独立复核 */
export const DETERMINATION_KINDS = ['初鉴', '复核'] as const
export type DeterminationKind = (typeof DETERMINATION_KINDS)[number]

/** 复核结论：与初鉴一致 / 与初鉴不一致（提交时按结论文本比对后固化，不随后续修改漂移） */
export const REVIEW_VERDICTS = ['一致', '不一致'] as const
export type ReviewVerdict = (typeof REVIEW_VERDICTS)[number]

/** Determination 鉴定记录 */
export interface Determination {
  id: string
  specimenId: string
  /** 初鉴人或复核人 */
  determiner: string
  date: string
  /** 鉴定结论（学名） */
  conclusion: string
  /** 依据文献 */
  reference: string
  confidence: Confidence
  /** 初鉴时勾选：标记该标本需复核，置为「待复核」；复核记录恒为 false */
  needReview: boolean
  /** 记录类型：初鉴 / 复核（v3 迁移为历史记录补齐为「初鉴」） */
  kind: DeterminationKind
  /** 复核结论：仅复核记录有值，与初鉴结论比对得到，提交后固化留痕 */
  reviewVerdict?: ReviewVerdict | null
}
