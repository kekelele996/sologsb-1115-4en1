import { useMemo, useState } from 'react'
import type { Confidence, DetStatus, Determination, Specimen } from '@/types'
import { CONFIDENCES } from '@/types'
import StatusTag from '@/components/common/StatusTag'
import { usePersistentStore } from '@/hooks/usePersistentStore'
import { determinationStore } from '@/stores/determinationStore'
import { specimenStore } from '@/stores/specimenStore'
import { siteStore } from '@/stores/siteStore'
import { downloadCsv } from '@/utils/export'
import { specimenTaxon } from '@/utils/codec'
import { compareConclusion, initialDetermination, latestReviewDetermination } from '@/utils/review'
import { uid } from '@/utils/id'

const QUEUE_STATUSES: DetStatus[] = ['待鉴定', '初鉴', '待复核']

/** 鉴定工作流：初鉴落记录并推进状态；待复核标本必须由另一名鉴定人独立复核 */
export default function DeterminationPage(): JSX.Element {
  const specimens = usePersistentStore(specimenStore, (state) => state.rows)
  const sites = usePersistentStore(siteStore, (state) => state.rows)
  const determinations = usePersistentStore(determinationStore, (state) => state.rows)

  const queue = useMemo(
    () => specimens.filter((item) => QUEUE_STATUSES.includes(item.status)),
    [specimens]
  )
  const [activeId, setActiveId] = useState('')
  const active = specimens.find((item) => item.id === activeId) ?? queue[0] ?? null

  const [determiner, setDeterminer] = useState('')
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [conclusion, setConclusion] = useState('')
  const [reference, setReference] = useState('')
  const [confidence, setConfidence] = useState<Confidence>('中')
  const [needReview, setNeedReview] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  /** 待复核标本走独立复核表单，其余走初鉴表单 */
  const isReview = active?.status === '待复核'
  const initial = active ? initialDetermination(determinations, active.id) : null
  const lastReview = active ? latestReviewDetermination(determinations, active.id) : null

  const siteName = (siteId: string): string => sites.find((site) => site.id === siteId)?.name ?? '未关联采集地'

  const historyOf = (specimenId: string): Determination[] =>
    determinations.filter((item) => item.specimenId === specimenId)

  const resetForm = (): void => {
    setConclusion('')
    setReference('')
    setNeedReview(false)
    setConfidence('中')
  }

  const pick = (specimen: Specimen): void => {
    setActiveId(specimen.id)
    setConclusion('')
    setReference('')
    setConfidence('中')
    setNeedReview(false)
    setMessage('')
    setError('')
  }

  const submit = async (): Promise<void> => {
    setError('')
    if (!active) {
      setError('队列已清空，没有待处理标本')
      return
    }
    const who = determiner.trim()
    const result = conclusion.trim()
    const basis = reference.trim()
    if (!who) {
      setError(isReview ? '请填写复核人' : '请填写鉴定人')
      return
    }
    if (!result) {
      setError(isReview ? '请填写复核结论（学名）' : '请填写鉴定结论（学名）')
      return
    }
    if (isReview) {
      // 复核必须能追溯到初鉴记录与初鉴人
      if (!initial) {
        setError('该标本缺少初鉴记录，无法复核；请先补做初鉴')
        return
      }
      // 独立复核：复核人与初鉴人相同时直接拒绝，不保存任何记录
      if (who === initial.determiner.trim()) {
        setError(`复核人不能与初鉴人相同（初鉴人：${initial.determiner}），请由另一名鉴定人复核`)
        return
      }
      // 复核必须填依据，结论与依据齐备才允许提交
      if (!basis) {
        setError('请填写复核依据（文献 / 标本对照等）')
        return
      }
      const verdict = compareConclusion(result, initial.conclusion)
      const record: Determination = {
        id: uid('det'),
        specimenId: active.id,
        determiner: who,
        date,
        conclusion: result,
        reference: basis,
        confidence,
        needReview: false,
        kind: '复核',
        reviewVerdict: verdict
      }
      await determinationStore.getState().save(record)
      if (verdict === '一致') {
        // 一致才允许定名；保留初鉴人，不被复核人覆盖
        await specimenStore.getState().save({ ...active, status: '已鉴定' })
        setMessage(`${active.code} 复核一致：${result}，标本已定名（状态更新为「已鉴定」）`)
      } else {
        // 不一致则保留待复核，初鉴结论与复核分歧都留痕，等待再次复核
        await specimenStore.getState().save({ ...active, status: '待复核' })
        setMessage(
          `${active.code} 复核不一致：初鉴「${initial.conclusion}」/ 复核「${result}」，标本保留「待复核」`
        )
      }
    } else {
      const record: Determination = {
        id: uid('det'),
        specimenId: active.id,
        determiner: who,
        date,
        conclusion: result,
        reference: basis,
        confidence,
        needReview,
        kind: '初鉴',
        reviewVerdict: null
      }
      await determinationStore.getState().save(record)
      await specimenStore.getState().save({
        ...active,
        status: needReview ? '待复核' : '已鉴定',
        determiner: who
      })
      setMessage(
        `${active.code} 已落初鉴记录：${record.conclusion}（置信度 ${record.confidence}，状态更新为${
          needReview ? '待复核' : '已鉴定'
        }）`
      )
    }
    setActiveId('')
    resetForm()
  }

  const exportHistory = (): void => {
    const rows = determinations.map((item) => {
      const specimen = specimens.find((sp) => sp.id === item.specimenId)
      return {
        code: specimen?.code ?? item.specimenId,
        kind: item.kind ?? '初鉴',
        determiner: item.determiner,
        date: item.date,
        conclusion: item.conclusion,
        reference: item.reference,
        confidence: item.confidence,
        needReview: item.needReview ? '是' : '否',
        reviewVerdict: item.kind === '复核' ? item.reviewVerdict ?? '—' : '—'
      }
    })
    downloadCsv('鉴定记录.csv', rows as unknown as Record<string, unknown>[], [
      { key: 'code', label: '标本编号' },
      { key: 'kind', label: '记录类型' },
      { key: 'determiner', label: '鉴定/复核人' },
      { key: 'date', label: '日期' },
      { key: 'conclusion', label: '结论' },
      { key: 'reference', label: '依据文献' },
      { key: 'confidence', label: '置信度' },
      { key: 'needReview', label: '需复核' },
      { key: 'reviewVerdict', label: '复核结论' }
    ])
  }

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">鉴定工作流</h1>
          <p className="page-sub">
            初鉴落记录并推进状态；「待复核」标本必须由另一名鉴定人独立复核：复核人与初鉴人相同不予保存，复核一致才定名，不一致保留待复核，全部结论留痕可查。
          </p>
        </div>
        <button className="btn-ghost" type="button" onClick={exportHistory}>
          导出鉴定记录
        </button>
      </header>

      <section className="grid gap-4 md:grid-cols-[320px_1fr]">
        <div className="panel flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-slate-700">待处理队列（{queue.length}）</h2>
          <div className="max-h-[420px] overflow-auto">
            {queue.map((specimen) => (
              <button
                key={specimen.id}
                type="button"
                onClick={() => pick(specimen)}
                className={`mb-1.5 w-full rounded-lg border px-3 py-2 text-left transition ${
                  active?.id === specimen.id ? 'border-field-500 bg-field-50' : 'border-slate-200 hover:bg-slate-50'
                }`}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs text-field-700">{specimen.code}</span>
                  <StatusTag status={specimen.status} />
                </span>
                <span className="mt-0.5 block text-xs text-slate-600">{specimenTaxon(specimen)}</span>
                <span className="block text-[11px] text-slate-400">
                  {siteName(specimen.siteId)} · {specimen.collectDate}
                </span>
              </button>
            ))}
            {queue.length === 0 ? <p className="text-sm text-slate-400">队列已清空，所有标本都已处理</p> : null}
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <div className="panel">
            <h2 className="text-sm font-semibold text-slate-700">
              {active ? `${isReview ? '独立复核' : '初鉴'} ${active.code}` : '请从左侧队列选择标本'}
            </h2>
            {active ? (
              <p className="mt-1 text-xs text-slate-500">
                {specimenTaxon(active)} · {siteName(active.siteId)} · 采集人 {active.collector || '—'} · 采集方式{' '}
                {active.method} · 体长 {active.bodyLength} mm
              </p>
            ) : null}

            {isReview && initial ? (
              <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                <p className="font-semibold">
                  原初鉴结论：{initial.conclusion}（初鉴人 {initial.determiner} · {initial.date} · 置信度{' '}
                  {initial.confidence}）
                </p>
                <p className="mt-0.5">初鉴依据：{initial.reference || '未填写'}</p>
                <p className="mt-0.5">
                  复核须由初鉴人以外的鉴定人填写；结论一致才定名，不一致则保留「待复核」，原初鉴结论继续留痕。
                  {lastReview ? (
                    <span className="mt-0.5 block">
                      上次复核：{lastReview.conclusion}（{lastReview.determiner} · 结论
                      {lastReview.reviewVerdict === '一致' ? '一致' : '不一致'}）
                    </span>
                  ) : null}
                </p>
              </div>
            ) : null}
            {isReview && !initial ? (
              <p className="mt-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800">
                该标本没有初鉴记录，无法发起独立复核。
              </p>
            ) : null}

            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <div>
                <span className="field-label">{isReview ? '复核人' : '鉴定人'}</span>
                <input
                  className="field-input"
                  value={determiner}
                  onChange={(e) => setDeterminer(e.target.value)}
                  placeholder={isReview && initial ? `须不同于初鉴人「${initial.determiner}」` : '如 覃羽'}
                />
              </div>
              <div>
                <span className="field-label">{isReview ? '复核日期' : '鉴定日期'}</span>
                <input type="date" className="field-input" value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
              <div className="md:col-span-2">
                <span className="field-label">{isReview ? '复核结论（学名）' : '鉴定结论（学名）'}</span>
                <input
                  className="field-input"
                  value={conclusion}
                  onChange={(e) => setConclusion(e.target.value)}
                  placeholder={isReview ? '独立给出复核结论，如 Carabus smaragdinus' : '如 Carabus smaragdinus'}
                />
              </div>
              <div className="md:col-span-2">
                <span className="field-label">
                  依据文献{isReview ? <b className="ml-1 text-red-500">（复核必填）</b> : null}
                </span>
                <input
                  className="field-input"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  placeholder="如 《中国步甲志》第二卷 P.218"
                />
              </div>
              <div>
                <span className="field-label">置信度</span>
                <select className="field-input" value={confidence} onChange={(e) => setConfidence(e.target.value as Confidence)}>
                  {CONFIDENCES.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </div>
              {!isReview ? (
                <label className="mt-5 flex items-center gap-2 text-sm text-slate-600">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-field-600"
                    checked={needReview}
                    onChange={(e) => setNeedReview(e.target.checked)}
                  />
                  标记为需复核（状态置为「待复核」，等待另一名鉴定人复核）
                </label>
              ) : null}
            </div>
            {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
            {message ? <p className="mt-3 text-sm text-field-700">{message}</p> : null}
            <div className="mt-3 flex gap-2">
              <button className="btn-primary" type="button" onClick={() => void submit()}>
                {isReview ? '提交复核记录' : '提交初鉴记录'}
              </button>
              <button
                className="btn-ghost"
                type="button"
                onClick={() => {
                  resetForm()
                  setError('')
                  setMessage('')
                }}
              >
                清空结论
              </button>
            </div>
          </div>

          {active ? (
            <div className="panel">
              <h3 className="text-sm font-semibold text-slate-700">
                该标本的鉴定 / 复核记录（{historyOf(active.id).length}，全部留痕可查）
              </h3>
              <ul className="mt-2 space-y-2 text-sm">
                {historyOf(active.id).map((record) => (
                  <li
                    key={record.id}
                    className={`rounded-lg border px-3 py-2 ${
                      record.kind === '复核'
                        ? record.reviewVerdict === '一致'
                          ? 'border-emerald-300 bg-emerald-50/60'
                          : 'border-amber-300 bg-amber-50/60'
                        : 'border-slate-200'
                    }`}
                  >
                    <p className="font-medium text-slate-800">
                      <span
                        className={`mr-1.5 rounded-full border px-1.5 py-0.5 text-[10px] align-middle ${
                          record.kind === '复核' ? 'border-field-300 text-field-700' : 'border-slate-300 text-slate-500'
                        }`}
                      >
                        {record.kind ?? '初鉴'}
                      </span>
                      {record.conclusion}
                      {record.kind === '复核' ? (
                        <span
                          className={`ml-2 rounded-full px-1.5 py-0.5 text-[10px] ${
                            record.reviewVerdict === '一致'
                              ? 'bg-emerald-100 text-emerald-700'
                              : 'bg-amber-100 text-amber-700'
                          }`}
                        >
                          {record.reviewVerdict === '一致' ? '与初鉴一致 → 已鉴定' : '与初鉴不一致 → 保留待复核'}
                        </span>
                      ) : null}
                    </p>
                    <p className="text-xs text-slate-500">
                      {record.determiner} · {record.date} · 置信度 {record.confidence} ·{' '}
                      {record.needReview ? '初鉴标记需复核' : '无需复核'}
                    </p>
                    <p className="text-xs text-slate-400">依据：{record.reference || '未填写'}</p>
                  </li>
                ))}
                {historyOf(active.id).length === 0 ? <li className="text-xs text-slate-400">暂无鉴定记录</li> : null}
              </ul>
            </div>
          ) : null}
        </div>
      </section>

      <section className="panel">
        <h2 className="text-sm font-semibold text-slate-700">全部鉴定记录（{determinations.length}）</h2>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[860px] border-collapse text-sm">
            <thead>
              <tr className="bg-slate-50 text-left text-xs text-slate-500">
                <th className="border border-slate-200 px-2 py-1">标本编号</th>
                <th className="border border-slate-200 px-2 py-1">类型</th>
                <th className="border border-slate-200 px-2 py-1">鉴定/复核人</th>
                <th className="border border-slate-200 px-2 py-1">日期</th>
                <th className="border border-slate-200 px-2 py-1">结论</th>
                <th className="border border-slate-200 px-2 py-1">依据文献</th>
                <th className="border border-slate-200 px-2 py-1">置信度</th>
                <th className="border border-slate-200 px-2 py-1">复核结论</th>
                <th className="border border-slate-200 px-2 py-1">标本状态</th>
                <th className="border border-slate-200 px-2 py-1">操作</th>
              </tr>
            </thead>
            <tbody>
              {determinations.map((record) => {
                const specimen = specimens.find((item) => item.id === record.specimenId)
                return (
                  <tr key={record.id}>
                    <td className="border border-slate-200 px-2 py-1 font-mono text-xs">{specimen?.code ?? '—'}</td>
                    <td className="border border-slate-200 px-2 py-1">{record.kind ?? '初鉴'}</td>
                    <td className="border border-slate-200 px-2 py-1">{record.determiner}</td>
                    <td className="border border-slate-200 px-2 py-1">{record.date}</td>
                    <td className="border border-slate-200 px-2 py-1">{record.conclusion}</td>
                    <td className="border border-slate-200 px-2 py-1 text-xs text-slate-500">{record.reference || '—'}</td>
                    <td className="border border-slate-200 px-2 py-1">{record.confidence}</td>
                    <td className="border border-slate-200 px-2 py-1">
                      {record.kind === '复核' ? (
                        <span className={record.reviewVerdict === '一致' ? 'text-emerald-700' : 'text-amber-700'}>
                          {record.reviewVerdict}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="border border-slate-200 px-2 py-1">{specimen ? <StatusTag status={specimen.status} /> : '—'}</td>
                    <td className="border border-slate-200 px-2 py-1">
                      <button
                        className="btn-danger"
                        type="button"
                        onClick={() => void determinationStore.getState().remove(record.id)}
                      >
                        删除
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
