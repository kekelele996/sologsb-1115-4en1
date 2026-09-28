import { useMemo, useState } from 'react'
import type { Confidence, DetStatus, Determination, Specimen } from '@/types'
import { CONFIDENCES } from '@/types'
import StatusTag from '@/components/common/StatusTag'
import { usePersistentStore } from '@/hooks/usePersistentStore'
import { determinationStore } from '@/stores/determinationStore'
import { specimenStore } from '@/stores/specimenStore'
import { siteStore } from '@/stores/siteStore'
import { downloadCsv } from '@/utils/export'
import { conclusionAgrees, latestInitial, reviewRecords } from '@/utils/determination'
import { specimenTaxon } from '@/utils/codec'
import { uid } from '@/utils/id'

const QUEUE_STATUSES: DetStatus[] = ['待鉴定', '初鉴', '待复核']

/** 鉴定记录的类型徽标 */
function RecordBadge({ record }: { record: Determination }): JSX.Element {
  if (record.kind === '复核') {
    return (
      <span
        className={`rounded-full border px-2 py-0.5 text-[11px] ${
          record.agreed
            ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
            : 'border-rose-300 bg-rose-50 text-rose-700'
        }`}
      >
        复核·{record.agreed ? '一致' : '不一致'}
      </span>
    )
  }
  return <span className="rounded-full border border-sky-300 bg-sky-50 px-2 py-0.5 text-[11px] text-sky-700">初鉴</span>
}

/** 鉴定工作流：初鉴提交 → 疑难标本转待复核 → 另一名鉴定人独立复核 */
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
  const original = active ? latestInitial(determinations, active.id) : null
  /** 待复核且有原初鉴记录才走独立复核；缺原记录的异常标本先补初鉴 */
  const reviewMode = active?.status === '待复核' && !!original

  const [determiner, setDeterminer] = useState('')
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [conclusion, setConclusion] = useState('')
  const [reference, setReference] = useState('')
  const [confidence, setConfidence] = useState<Confidence>('中')
  const [needReview, setNeedReview] = useState(false)
  const [message, setMessage] = useState('')

  const siteName = (siteId: string): string => sites.find((site) => site.id === siteId)?.name ?? '未关联采集地'

  const historyOf = (specimenId: string): Determination[] =>
    determinations.filter((item) => item.specimenId === specimenId)

  const pick = (specimen: Specimen): void => {
    setActiveId(specimen.id)
    // 复核结论必须由复核人独立填写，不预填原结论；初鉴沿用标本当前学名草稿
    setConclusion(specimen.status === '待复核' ? '' : [specimen.genus, specimen.species].filter(Boolean).join(' '))
    setReference('')
    setConfidence('中')
    // 待复核异常标本（缺原初鉴记录）补录初鉴时默认保持待复核，避免直接定名绕过复核
    setNeedReview(specimen.status === '待复核')
    setMessage('')
  }

  const resetForm = (): void => {
    setActiveId('')
    setConclusion('')
    setReference('')
    setConfidence('中')
    setNeedReview(false)
  }

  /** 提交初鉴记录 */
  const submitInitial = async (): Promise<void> => {
    if (!active) {
      setMessage('队列已清空，没有待处理标本')
      return
    }
    if (!determiner.trim()) {
      setMessage('请填写鉴定人')
      return
    }
    if (!conclusion.trim()) {
      setMessage('请填写鉴定结论（学名）')
      return
    }
    const record: Determination = {
      id: uid('det'),
      specimenId: active.id,
      determiner: determiner.trim(),
      date,
      conclusion: conclusion.trim(),
      reference: reference.trim(),
      confidence,
      needReview,
      kind: '初鉴',
      agreed: null
    }
    await determinationStore.getState().save(record)
    await specimenStore.getState().save({
      ...active,
      status: needReview ? '待复核' : '已鉴定',
      determiner: determiner.trim()
    })
    setMessage(
      `${active.code} 已落初鉴记录：${record.conclusion}（置信度 ${record.confidence}，状态更新为${
        needReview ? '待复核，等待另一名鉴定人独立复核' : '已鉴定'
      }）`
    )
    resetForm()
  }

  /** 提交独立复核记录：同一人不保存；一致进已鉴定，不一致保留待复核 */
  const submitReview = async (): Promise<void> => {
    if (!active) return
    if (!original) {
      setMessage('该标本缺少原初鉴记录，无法复核；请先补一条初鉴记录')
      return
    }
    const reviewer = determiner.trim()
    if (!reviewer) {
      setMessage('请填写复核人')
      return
    }
    // 独立复核：复核人与初鉴人相同时不保存
    if (reviewer === original.determiner.trim()) {
      setMessage(`复核人不能与初鉴人（${original.determiner}）为同一人，请由另一名鉴定人复核，本次记录未保存`)
      return
    }
    if (!conclusion.trim()) {
      setMessage('请填写复核结论（学名）')
      return
    }
    if (!reference.trim()) {
      setMessage('请填写复核依据文献')
      return
    }
    const agreed = conclusionAgrees(original.conclusion, conclusion)
    const record: Determination = {
      id: uid('det'),
      specimenId: active.id,
      determiner: reviewer,
      date,
      conclusion: conclusion.trim(),
      reference: reference.trim(),
      confidence,
      needReview: false,
      kind: '复核',
      agreed
    }
    await determinationStore.getState().save(record)
    if (agreed) {
      // 一致：定名完成，进入已鉴定，鉴定人记为复核人（原初鉴记录仍可查）
      await specimenStore.getState().save({ ...active, status: '已鉴定', determiner: reviewer })
      setMessage(`${active.code} 复核一致（${record.conclusion}），已进入「已鉴定」`)
    } else {
      // 不一致：保留待复核，标本鉴定人维持原初鉴人，等待再次复核
      await specimenStore.getState().save({ ...active, status: '待复核', determiner: original.determiner })
      setMessage(
        `${active.code} 复核不一致：原结论「${original.conclusion}」 vs 复核结论「${record.conclusion}」，保留「待复核」`
      )
    }
    resetForm()
  }

  const exportHistory = (): void => {
    const rows = determinations.map((item) => {
      const specimen = specimens.find((sp) => sp.id === item.specimenId)
      return {
        code: specimen?.code ?? item.specimenId,
        kind: item.kind,
        determiner: item.determiner,
        date: item.date,
        conclusion: item.conclusion,
        reference: item.reference,
        confidence: item.confidence,
        needReview: item.needReview ? '是' : '否',
        agreed: item.kind === '复核' ? (item.agreed ? '一致' : '不一致') : ''
      }
    })
    downloadCsv('鉴定记录.csv', rows as unknown as Record<string, unknown>[], [
      { key: 'code', label: '标本编号' },
      { key: 'kind', label: '记录类型' },
      { key: 'determiner', label: '鉴定人' },
      { key: 'date', label: '鉴定日期' },
      { key: 'conclusion', label: '鉴定结论' },
      { key: 'reference', label: '依据文献' },
      { key: 'confidence', label: '置信度' },
      { key: 'needReview', label: '需复核' },
      { key: 'agreed', label: '复核一致性' }
    ])
  }

  const reviewerSameAsInitial = reviewMode && !!original && determiner.trim() === original.determiner.trim()
  const liveAgrees = reviewMode && !!original && conclusion.trim().length > 0
    ? conclusionAgrees(original.conclusion, conclusion)
    : null

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">鉴定工作流</h1>
          <p className="page-sub">
            初鉴疑难标本勾选「需复核」转入待复核；待复核标本须由<b>另一名鉴定人</b>独立填写依据与结论，一致才进入「已鉴定」，不一致保留「待复核」，每条意见均可追溯。
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
            {queue.map((specimen) => {
              const initial = latestInitial(determinations, specimen.id)
              return (
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
                  {specimen.status === '待复核' && initial ? (
                    <span className="mt-0.5 block text-[11px] text-amber-700">
                      待复核：初鉴人 {initial.determiner} · 原结论 {initial.conclusion}
                    </span>
                  ) : null}
                </button>
              )
            })}
            {queue.length === 0 ? <p className="text-sm text-slate-400">队列已清空，所有标本都已处理</p> : null}
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <div className="panel">
            <h2 className="text-sm font-semibold text-slate-700">
              {active
                ? reviewMode
                  ? `独立复核 ${active.code}`
                  : `初鉴 ${active.code}`
                : '请从左侧队列选择标本'}
            </h2>
            {active ? (
              <p className="mt-1 text-xs text-slate-500">
                {specimenTaxon(active)} · {siteName(active.siteId)} · 采集人 {active.collector || '—'} · 采集方式{' '}
                {active.method} · 体长 {active.bodyLength} mm
              </p>
            ) : null}

            {reviewMode && original ? (
              <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                <p className="font-semibold">原初鉴结论（继续可查，不被覆盖）</p>
                <p className="mt-1">
                  {original.conclusion} · 初鉴人 {original.determiner} · {original.date} · 置信度 {original.confidence}
                </p>
                <p className="mt-0.5 text-amber-800">依据：{original.reference || '未填写'}</p>
              </div>
            ) : null}
            {active?.status === '待复核' && !reviewMode && !original ? (
              <p className="mt-3 rounded-lg border border-sky-300 bg-sky-50 px-3 py-2 text-xs text-sky-800">
                该标本虽为「待复核」，但缺少原初鉴记录（通常由历史批量改状态造成）。请先补录初鉴并勾选「需复核」，再由另一名鉴定人复核。
              </p>
            ) : null}

            {active ? (
              <>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <div>
                    <span className="field-label">{reviewMode ? '复核人（须与初鉴人不同）' : '鉴定人'}</span>
                    <input
                      className="field-input"
                      value={determiner}
                      onChange={(e) => setDeterminer(e.target.value)}
                      placeholder={reviewMode && original ? `不得为 ${original.determiner}` : '如 覃羽'}
                    />
                    {reviewerSameAsInitial ? (
                      <p className="mt-1 text-xs text-rose-600">复核人与初鉴人相同，该复核不会被保存</p>
                    ) : null}
                  </div>
                  <div>
                    <span className="field-label">{reviewMode ? '复核日期' : '鉴定日期'}</span>
                    <input type="date" className="field-input" value={date} onChange={(e) => setDate(e.target.value)} />
                  </div>
                  <div className="md:col-span-2">
                    <span className="field-label">{reviewMode ? '复核结论（学名）' : '鉴定结论（学名）'}</span>
                    <input
                      className="field-input"
                      value={conclusion}
                      onChange={(e) => setConclusion(e.target.value)}
                      placeholder={
                        reviewMode && original ? `独立填写学名；与原结论「${original.conclusion}」一致即通过` : '如 Carabus smaragdinus'
                      }
                    />
                    {reviewMode && liveAgrees !== null ? (
                      <p className={`mt-1 text-xs ${liveAgrees ? 'text-emerald-700' : 'text-rose-600'}`}>
                        {liveAgrees
                          ? '与原结论一致：提交后进入「已鉴定」'
                          : '与原结论不一致：提交后保留「待复核」，等待再次复核'}
                      </p>
                    ) : null}
                  </div>
                  <div className="md:col-span-2">
                    <span className="field-label">
                      依据文献{reviewMode ? '（复核必填）' : ''}
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
                    <select
                      className="field-input"
                      value={confidence}
                      onChange={(e) => setConfidence(e.target.value as Confidence)}
                    >
                      {CONFIDENCES.map((item) => (
                        <option key={item} value={item}>
                          {item}
                        </option>
                      ))}
                    </select>
                  </div>
                  {!reviewMode ? (
                    <label className="mt-5 flex items-center gap-2 text-sm text-slate-600">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-field-600"
                        checked={needReview}
                        onChange={(e) => setNeedReview(e.target.checked)}
                      />
                      疑难标本，标记为需复核（状态置为「待复核」）
                    </label>
                  ) : (
                    <p className="mt-5 text-xs text-slate-500">
                      复核标本不能直接勾选定名：结论一致自动进入「已鉴定」，不一致保留「待复核」。
                    </p>
                  )}
                </div>
                {message ? <p className="mt-3 text-sm text-field-700">{message}</p> : null}
                <div className="mt-3 flex gap-2">
                  <button
                    className="btn-primary"
                    type="button"
                    onClick={() => void (reviewMode ? submitReview() : submitInitial())}
                  >
                    {reviewMode ? '提交复核记录' : '提交初鉴记录'}
                  </button>
                  <button
                    className="btn-ghost"
                    type="button"
                    onClick={() => {
                      resetForm()
                      setMessage('')
                    }}
                  >
                    清空表单
                  </button>
                </div>
              </>
            ) : null}
          </div>

          {active ? (
            <div className="panel">
              <h3 className="text-sm font-semibold text-slate-700">
                该标本的鉴定 / 复核记录（初鉴 {historyOf(active.id).filter((r) => r.kind === '初鉴').length} 条 · 复核{' '}
                {reviewRecords(determinations, active.id).length} 条）
              </h3>
              <ul className="mt-2 space-y-2 text-sm">
                {historyOf(active.id).map((record) => (
                  <li key={record.id} className="rounded-lg border border-slate-200 px-3 py-2">
                    <p className="flex flex-wrap items-center gap-2 font-medium text-slate-800">
                      <RecordBadge record={record} />
                      {record.conclusion}
                    </p>
                    <p className="text-xs text-slate-500">
                      {record.determiner} · {record.date} · 置信度 {record.confidence} ·{' '}
                      {record.needReview ? '需复核' : '无需复核'}
                      {record.kind === '复核'
                        ? record.agreed
                          ? ' · 与原结论一致'
                          : ' · 与原结论不一致'
                        : ''}
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
          <table className="w-full min-w-[820px] border-collapse text-sm">
            <thead>
              <tr className="bg-slate-50 text-left text-xs text-slate-500">
                <th className="border border-slate-200 px-2 py-1">标本编号</th>
                <th className="border border-slate-200 px-2 py-1">类型</th>
                <th className="border border-slate-200 px-2 py-1">鉴定人</th>
                <th className="border border-slate-200 px-2 py-1">日期</th>
                <th className="border border-slate-200 px-2 py-1">结论</th>
                <th className="border border-slate-200 px-2 py-1">依据文献</th>
                <th className="border border-slate-200 px-2 py-1">置信度</th>
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
                    <td className="border border-slate-200 px-2 py-1">
                      <RecordBadge record={record} />
                    </td>
                    <td className="border border-slate-200 px-2 py-1">{record.determiner}</td>
                    <td className="border border-slate-200 px-2 py-1">{record.date}</td>
                    <td className="border border-slate-200 px-2 py-1">{record.conclusion}</td>
                    <td className="border border-slate-200 px-2 py-1 text-xs text-slate-500">{record.reference || '—'}</td>
                    <td className="border border-slate-200 px-2 py-1">{record.confidence}</td>
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
