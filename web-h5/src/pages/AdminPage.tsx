import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bot,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  FileSearch,
  Gauge,
  Inbox,
  LoaderCircle,
  LogOut,
  MessageSquareText,
  RefreshCw,
  Search,
  Server,
  ShieldCheck,
  ShieldX,
  UserRoundCheck,
  X,
} from 'lucide-react';
import {
  adminApi,
  AdminApiError,
  type AdminFeedback,
  type AdminOverview,
  type AdminReport,
  type AdminSecurity,
} from '@/api/admin';

const TOKEN_KEY = 'joblens_admin_token';
type Tab = 'overview' | 'reports' | 'feedbacks' | 'security';

const navItems: Array<{ id: Tab; label: string; icon: typeof BarChart3 }> = [
  { id: 'overview', label: '经营总览', icon: BarChart3 },
  { id: 'reports', label: '分析质量', icon: FileSearch },
  { id: 'feedbacks', label: '反馈审核', icon: MessageSquareText },
  { id: 'security', label: '系统与安全', icon: ShieldCheck },
];

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

function riskClass(level: string | null): string {
  if (level === '极高') return 'bg-red-100 text-red-700';
  if (level === '高') return 'bg-orange-100 text-orange-700';
  if (level === '中') return 'bg-amber-100 text-amber-700';
  return 'bg-emerald-100 text-emerald-700';
}

function statusLabel(status: string): string {
  if (status === 'approved') return '已通过';
  if (status === 'rejected') return '已驳回';
  return '待审核';
}

function Login({ onLogin }: { onLogin: (token: string, signal: AbortSignal) => Promise<void> }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => () => {
    requestIdRef.current += 1;
    controllerRef.current?.abort();
  }, []);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!value.trim()) return;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError('');
    try {
      await onLogin(value.trim(), controller.signal);
    } catch (reason) {
      if (requestId === requestIdRef.current && !controller.signal.aborted) {
        setError(reason instanceof Error ? reason.message : '登录失败。');
      }
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  };

  return <main className="flex min-h-screen items-center justify-center bg-gray-100 px-4">
    <form onSubmit={submit} className="w-full max-w-sm rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gray-900 text-white"><ShieldCheck className="h-5 w-5" /></div>
        <div><h1 className="text-lg font-semibold text-gray-950">JobLens 管理后台</h1><p className="text-sm text-gray-500">管理员身份验证</p></div>
      </div>
      <label className="mb-2 block text-sm font-medium text-gray-700" htmlFor="admin-token">管理凭据</label>
      <input id="admin-token" type="password" autoComplete="current-password" value={value} onChange={event => setValue(event.target.value)} className="h-11 w-full rounded-md border border-gray-300 px-3 text-sm outline-none focus:border-gray-700 focus:ring-2 focus:ring-gray-200" />
      {error && <p className="mt-3 text-sm text-red-600" role="alert">{error}</p>}
      <button type="submit" disabled={loading || !value.trim()} className="mt-5 flex h-11 w-full items-center justify-center gap-2 rounded-md bg-gray-900 text-sm font-semibold text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50">
        {loading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <UserRoundCheck className="h-4 w-4" />}进入后台
      </button>
    </form>
  </main>;
}

function Kpi({ label, value, detail, icon: Icon, tone }: { label: string; value: string; detail?: string; icon: typeof Activity; tone: string }) {
  return <div className="rounded-lg border border-gray-200 bg-white p-4">
    <div className="flex items-start justify-between gap-3"><p className="text-sm text-gray-500">{label}</p><span className={`rounded-md p-2 ${tone}`}><Icon className="h-4 w-4" /></span></div>
    <p className="mt-3 text-2xl font-semibold text-gray-950">{value}</p>
    {detail && <p className="mt-1 text-xs text-gray-500">{detail}</p>}
  </div>;
}

function SectionState({ loading, error, retry }: { loading: boolean; error: string; retry: () => void }) {
  if (loading) return <div className="flex min-h-64 items-center justify-center text-gray-500"><LoaderCircle className="mr-2 h-5 w-5 animate-spin" />加载中</div>;
  if (error) return <div className="flex min-h-64 flex-col items-center justify-center text-center"><AlertTriangle className="h-8 w-8 text-amber-500" /><p className="mt-3 text-sm text-gray-700">{error}</p><button onClick={retry} className="mt-4 flex items-center gap-2 rounded-md border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50"><RefreshCw className="h-4 w-4" />重试</button></div>;
  return null;
}

function OverviewView({ token, days, refreshVersion, onUnauthorized }: { token: string; days: number; refreshVersion: number; onUnauthorized: () => void }) {
  const [data, setData] = useState<AdminOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const controllerRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);
  const load = useCallback(async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const requestId = ++requestIdRef.current;
    setLoading(true); setError('');
    try {
      const result = await adminApi.overview(token, days, { signal: controller.signal });
      if (requestId === requestIdRef.current && !controller.signal.aborted) setData(result);
    } catch (reason) {
      if (requestId !== requestIdRef.current || controller.signal.aborted) return;
      if (reason instanceof AdminApiError && reason.status === 401) onUnauthorized();
      else setError(reason instanceof Error ? reason.message : '加载失败。');
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [days, onUnauthorized, token]);
  useEffect(() => {
    void load();
    return () => {
      requestIdRef.current += 1;
      controllerRef.current?.abort();
    };
  }, [load, refreshVersion]);
  if (!data) return <SectionState loading={loading} error={error} retry={load} />;
  const maxTrend = Math.max(1, ...data.trend.map(item => item.reports));
  const riskTotal = data.risk_distribution.reduce((sum, item) => sum + item.count, 0) || 1;
  return <div className="space-y-6">
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Kpi label="岗位报告" value={String(data.kpis.reports)} detail={`近 ${days} 天`} icon={FileSearch} tone="bg-blue-50 text-blue-700" />
      <Kpi label="模型调用率" value={`${(data.kpis.model_call_rate * 100).toFixed(1)}%`} detail="排除规则降级" icon={Bot} tone="bg-violet-50 text-violet-700" />
      <Kpi label="高风险占比" value={`${(data.kpis.high_risk_rate * 100).toFixed(1)}%`} detail={`平均风险分 ${data.kpis.average_risk_score}`} icon={AlertTriangle} tone="bg-orange-50 text-orange-700" />
      <Kpi label="估算成本" value={`¥${data.kpis.estimated_cost.toFixed(4)}`} detail="模型返回计费估算" icon={CircleDollarSign} tone="bg-emerald-50 text-emerald-700" />
      <Kpi label="平均耗时" value={`${(data.kpis.average_latency_ms / 1000).toFixed(1)}s`} icon={Clock3} tone="bg-cyan-50 text-cyan-700" />
      <Kpi label="待审核反馈" value={String(data.kpis.pending_feedback)} icon={Inbox} tone="bg-amber-50 text-amber-700" />
      <Kpi label="AI 日预算" value={`${data.system.ai_budget.used}/${data.system.ai_budget.limit}`} detail={`${(data.system.ai_budget.usage_ratio * 100).toFixed(1)}% 已使用`} icon={Gauge} tone="bg-gray-100 text-gray-700" />
      <Kpi label="核心依赖" value={data.system.database && data.system.redis ? '正常' : '异常'} detail={`DB ${data.system.database ? '正常' : '异常'} · Redis ${data.system.redis ? '正常' : '异常'}`} icon={Server} tone={data.system.database && data.system.redis ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'} />
    </div>

    <section className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
      <div className="rounded-lg border border-gray-200 bg-white p-5"><h2 className="text-base font-semibold text-gray-900">每日分析趋势</h2>
        <div className="mt-5 flex h-48 items-end gap-2 overflow-x-auto border-b border-gray-200 pb-2">
          {data.trend.map(item => <div key={item.date} className="flex min-w-9 flex-1 flex-col items-center justify-end gap-2" title={`${item.date}：${item.reports} 份报告`}>
            <span className="text-xs font-medium text-gray-600">{item.reports}</span>
            <div className="w-full max-w-8 rounded-t bg-blue-500" style={{ height: `${Math.max(4, item.reports / maxTrend * 130)}px` }} />
            <span className="text-[10px] text-gray-400">{item.date.slice(5)}</span>
          </div>)}
        </div>
        <div className="mt-3 flex gap-5 text-xs text-gray-500"><span>报告 {data.trend.reduce((sum, item) => sum + item.reports, 0)}</span><span>模型 {data.trend.reduce((sum, item) => sum + item.model_calls, 0)}</span><span>高风险 {data.trend.reduce((sum, item) => sum + item.high_risk, 0)}</span></div>
      </div>
      <div className="rounded-lg border border-gray-200 bg-white p-5"><h2 className="text-base font-semibold text-gray-900">风险等级分布</h2><div className="mt-5 space-y-4">
        {['低', '中', '高', '极高'].map(level => { const count = data.risk_distribution.find(item => item.label === level)?.count || 0; return <div key={level}><div className="mb-1 flex justify-between text-sm"><span>{level}</span><span className="text-gray-500">{count}</span></div><div className="h-2 overflow-hidden rounded bg-gray-100"><div className={`h-full ${level === '极高' ? 'bg-red-500' : level === '高' ? 'bg-orange-500' : level === '中' ? 'bg-amber-400' : 'bg-emerald-500'}`} style={{ width: `${count / riskTotal * 100}%` }} /></div></div>; })}
      </div></div>
    </section>

    <section className="rounded-lg border border-gray-200 bg-white"><div className="border-b border-gray-200 px-5 py-4"><h2 className="text-base font-semibold text-gray-900">近期报告</h2></div><ReportTable reports={data.recent_reports} onSelect={() => undefined} compact /></section>
  </div>;
}

function ReportTable({ reports, onSelect, compact = false }: { reports: AdminReport[]; onSelect: (report: AdminReport) => void; compact?: boolean }) {
  if (!reports.length) return <p className="p-8 text-center text-sm text-gray-500">暂无报告</p>;
  return <div className="overflow-x-auto"><table className="min-w-full text-left text-sm"><thead className="bg-gray-50 text-xs text-gray-500"><tr><th className="px-4 py-3 font-medium">时间</th><th className="px-4 py-3 font-medium">岗位</th><th className="px-4 py-3 font-medium">风险</th><th className="px-4 py-3 font-medium">来源</th>{!compact && <><th className="px-4 py-3 font-medium">耗时</th><th className="px-4 py-3 font-medium">成本</th></>}</tr></thead><tbody className="divide-y divide-gray-100">{reports.map(report => <tr key={report.report_id} onClick={() => onSelect(report)} className={compact ? '' : 'cursor-pointer hover:bg-gray-50'}><td className="whitespace-nowrap px-4 py-3 text-gray-500">{formatDate(report.created_at)}</td><td className="min-w-56 px-4 py-3"><p className="font-medium text-gray-900">{report.job_title || '未填写岗位'}</p><p className="mt-0.5 text-xs text-gray-500">{report.company_name || report.report_id}</p></td><td className="px-4 py-3"><span className={`inline-flex rounded px-2 py-1 text-xs font-medium ${riskClass(report.risk_level)}`}>{report.risk_level} · {report.overall_score}</span></td><td className="whitespace-nowrap px-4 py-3 text-gray-600">{report.analysis_source === 'model' ? report.provider || '模型' : '规则降级'}</td>{!compact && <><td className="px-4 py-3 text-gray-500">{report.latency_ms ? `${(report.latency_ms / 1000).toFixed(1)}s` : '-'}</td><td className="px-4 py-3 text-gray-500">¥{report.cost_estimate.toFixed(4)}</td></>}</tr>)}</tbody></table></div>;
}

function ReportsView({ token, onUnauthorized }: { token: string; onUnauthorized: () => void }) {
  const [items, setItems] = useState<AdminReport[]>([]); const [total, setTotal] = useState(0); const [page, setPage] = useState(1);
  const [draftQuery, setDraftQuery] = useState(''); const [appliedQuery, setAppliedQuery] = useState(''); const [risk, setRisk] = useState(''); const [source, setSource] = useState(''); const [selected, setSelected] = useState<AdminReport | null>(null);
  const [loading, setLoading] = useState(true); const [loaded, setLoaded] = useState(false); const [error, setError] = useState('');
  const controllerRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setAppliedQuery(draftQuery);
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [draftQuery]);

  const load = useCallback(async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const requestId = ++requestIdRef.current;
    setLoading(true); setError('');
    const params = new URLSearchParams({ page: String(page), page_size: '20' });
    if (appliedQuery) params.set('query', appliedQuery);
    if (risk) params.set('risk_level', risk);
    if (source) params.set('source', source);
    try {
      const result = await adminApi.reports(token, params, { signal: controller.signal });
      if (requestId !== requestIdRef.current || controller.signal.aborted) return;
      const lastPage = Math.max(1, Math.ceil(result.total / 20));
      setTotal(result.total);
      if (page > lastPage) {
        setPage(lastPage);
        return;
      }
      setItems(result.items);
      setLoaded(true);
    } catch (reason) {
      if (requestId !== requestIdRef.current || controller.signal.aborted) return;
      if (reason instanceof AdminApiError && reason.status === 401) onUnauthorized();
      else setError(reason instanceof Error ? reason.message : '加载失败。');
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [appliedQuery, onUnauthorized, page, risk, source, token]);
  useEffect(() => {
    void load();
    return () => {
      requestIdRef.current += 1;
      controllerRef.current?.abort();
    };
  }, [load]);
  return <div className="space-y-4"><div className="flex flex-wrap gap-3"><label className="relative min-w-64 flex-1"><Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" /><input value={draftQuery} onChange={event => setDraftQuery(event.target.value)} placeholder="搜索报告 ID、公司或岗位" className="h-10 w-full rounded-md border border-gray-300 pl-9 pr-3 text-sm outline-none focus:border-gray-600" /></label><select value={risk} onChange={event => { setRisk(event.target.value); setPage(1); }} className="h-10 rounded-md border border-gray-300 bg-white px-3 text-sm"><option value="">全部风险</option><option>低</option><option>中</option><option>高</option><option>极高</option></select><select value={source} onChange={event => { setSource(event.target.value); setPage(1); }} className="h-10 rounded-md border border-gray-300 bg-white px-3 text-sm"><option value="">全部来源</option><option value="model">模型</option><option value="fallback">规则降级</option></select></div>
    <section className="rounded-lg border border-gray-200 bg-white">{!loaded && (loading || error) ? <SectionState loading={loading} error={error} retry={load} /> : <ReportTable reports={items} onSelect={setSelected} />}</section>
    <div className="flex items-center justify-between text-sm text-gray-500"><span>共 {total} 条</span><div className="flex items-center gap-2"><button aria-label="上一页" disabled={loading || page === 1} onClick={() => setPage(value => value - 1)} className="rounded-md border border-gray-300 p-2 disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button><span>第 {page} 页</span><button aria-label="下一页" disabled={loading || page * 20 >= total} onClick={() => setPage(value => value + 1)} className="rounded-md border border-gray-300 p-2 disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button></div></div>
    {selected && <ReportDetail report={selected} onClose={() => setSelected(null)} />}
  </div>;
}

function ReportDetail({ report, onClose }: { report: AdminReport; onClose: () => void }) {
  return <div className="fixed inset-0 z-50 flex justify-end bg-gray-950/40" role="dialog" aria-modal="true"><div className="h-full w-full max-w-2xl overflow-y-auto bg-white shadow-xl"><header className="sticky top-0 flex items-center justify-between border-b border-gray-200 bg-white px-5 py-4"><div><h2 className="font-semibold text-gray-950">{report.job_title || '报告详情'}</h2><p className="text-xs text-gray-500">{report.report_id}</p></div><button onClick={onClose} aria-label="关闭" className="rounded-md p-2 hover:bg-gray-100"><X className="h-5 w-5" /></button></header><div className="space-y-6 p-5"><div className="flex flex-wrap gap-2"><span className={`rounded px-2 py-1 text-xs font-medium ${riskClass(report.risk_level)}`}>{report.risk_level} · {report.overall_score}</span><span className="rounded bg-gray-100 px-2 py-1 text-xs text-gray-600">置信度 {report.confidence}</span><span className="rounded bg-blue-50 px-2 py-1 text-xs text-blue-700">{report.provider || '规则降级'} / {report.model || '-'}</span></div><DetailBlock title="岗位描述" text={report.jd_text} /><DetailBlock title="HR 沟通" text={report.hr_chat_text || '未提供'} /><DetailList title="风险类型" values={report.risk_types} /><DetailList title="证据" values={report.evidence} /><DetailList title="信息缺口" values={report.missing_info} /><DetailList title="追问建议" values={report.questions} /><DetailBlock title="建议" text={report.recommendation} /></div></div></div>;
}

function DetailBlock({ title, text }: { title: string; text: string }) { return <section><h3 className="mb-2 text-sm font-semibold text-gray-900">{title}</h3><p className="whitespace-pre-wrap rounded-md bg-gray-50 p-3 text-sm leading-6 text-gray-700">{text}</p></section>; }
function DetailList({ title, values }: { title: string; values: string[] }) { return <section><h3 className="mb-2 text-sm font-semibold text-gray-900">{title}</h3>{values.length ? <ul className="space-y-2">{values.map((value, index) => <li key={`${value}-${index}`} className="flex gap-2 text-sm text-gray-700"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-gray-400" />{value}</li>)}</ul> : <p className="text-sm text-gray-400">无</p>}</section>; }

function FeedbacksView({ token, onUnauthorized, onChanged }: { token: string; onUnauthorized: () => void; onChanged: () => void }) {
  const [items, setItems] = useState<AdminFeedback[]>([]); const [total, setTotal] = useState(0); const [page, setPage] = useState(1); const [kind, setKind] = useState('all'); const [status, setStatus] = useState('pending'); const [notes, setNotes] = useState<Record<string, string>>({}); const [busy, setBusy] = useState(''); const [loading, setLoading] = useState(true); const [loaded, setLoaded] = useState(false); const [error, setError] = useState('');
  const controllerRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);
  const reviewControllerRef = useRef<AbortController | null>(null);
  const reviewRequestIdRef = useRef(0);
  const load = useCallback(async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const requestId = ++requestIdRef.current;
    setLoading(true); setError('');
    const params = new URLSearchParams({ page: String(page), page_size: '20', kind, status });
    try {
      const result = await adminApi.feedbacks(token, params, { signal: controller.signal });
      if (requestId !== requestIdRef.current || controller.signal.aborted) return;
      const lastPage = Math.max(1, Math.ceil(result.total / 20));
      setTotal(result.total);
      if (page > lastPage) {
        setPage(lastPage);
        return;
      }
      setItems(result.items);
      setNotes(Object.fromEntries(result.items.map(item => [item.id, item.reviewer_note || ''])));
      setLoaded(true);
    } catch (reason) {
      if (requestId !== requestIdRef.current || controller.signal.aborted) return;
      if (reason instanceof AdminApiError && reason.status === 401) onUnauthorized();
      else setError(reason instanceof Error ? reason.message : '加载失败。');
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [kind, onUnauthorized, page, status, token]);
  useEffect(() => {
    void load();
    return () => {
      requestIdRef.current += 1;
      controllerRef.current?.abort();
    };
  }, [load]);
  useEffect(() => () => {
    reviewRequestIdRef.current += 1;
    reviewControllerRef.current?.abort();
  }, []);
  const review = async (item: AdminFeedback, nextStatus: string) => {
    reviewControllerRef.current?.abort();
    const controller = new AbortController();
    reviewControllerRef.current = controller;
    const requestId = ++reviewRequestIdRef.current;
    setBusy(item.id);
    try {
      await adminApi.reviewFeedback(token, item.kind, item.id, nextStatus, notes[item.id] || '', { signal: controller.signal });
      if (requestId !== reviewRequestIdRef.current || controller.signal.aborted) return;
      await load();
      if (requestId === reviewRequestIdRef.current && !controller.signal.aborted) onChanged();
    } catch (reason) {
      if (requestId !== reviewRequestIdRef.current || controller.signal.aborted) return;
      if (reason instanceof AdminApiError && reason.status === 401) onUnauthorized();
      else setError(reason instanceof Error ? reason.message : '审核失败。');
    } finally {
      if (requestId === reviewRequestIdRef.current) setBusy('');
    }
  };
  return <div className="space-y-4"><div className="flex flex-wrap gap-3"><select value={kind} onChange={event => { setKind(event.target.value); setPage(1); }} className="h-10 rounded-md border border-gray-300 bg-white px-3 text-sm"><option value="all">全部反馈</option><option value="report">报告纠错</option><option value="interview">面试反馈</option></select><select value={status} onChange={event => { setStatus(event.target.value); setPage(1); }} className="h-10 rounded-md border border-gray-300 bg-white px-3 text-sm"><option value="pending">待审核</option><option value="approved">已通过</option><option value="rejected">已驳回</option><option value="all">全部状态</option></select><span className="self-center text-sm text-gray-500">{total} 条</span></div>{!loaded && (loading || error) ? <SectionState loading={loading} error={error} retry={load} /> : items.length === 0 ? <div className="rounded-lg border border-gray-200 bg-white py-16 text-center text-sm text-gray-500">暂无反馈</div> : <div className="space-y-3">{items.map(item => <article key={`${item.kind}-${item.id}`} className="rounded-lg border border-gray-200 bg-white p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><span className="text-sm font-semibold text-gray-900">{item.title}</span><span className="rounded bg-gray-100 px-2 py-1 text-xs text-gray-600">{item.kind === 'report' ? '报告纠错' : '面试反馈'}</span><span className={`rounded px-2 py-1 text-xs ${item.review_status === 'approved' ? 'bg-emerald-100 text-emerald-700' : item.review_status === 'rejected' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>{statusLabel(item.review_status)}</span></div><p className="mt-1 text-xs text-gray-500">{item.company_name || '未知公司'} · {item.job_title || item.report_id || '未关联报告'} · {formatDate(item.created_at)}</p></div>{item.risk_level && <span className={`rounded px-2 py-1 text-xs font-medium ${riskClass(item.risk_level)}`}>{item.risk_level} · {item.overall_score}</span>}</div><p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-gray-700">{item.content}</p>{item.tags.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{item.tags.map(tag => <span key={tag} className="rounded bg-gray-100 px-2 py-1 text-xs text-gray-600">{tag}</span>)}</div>}<div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto]"><input value={notes[item.id] || ''} onChange={event => setNotes(value => ({ ...value, [item.id]: event.target.value }))} maxLength={500} placeholder="内部审核备注" className="h-10 rounded-md border border-gray-300 px-3 text-sm outline-none focus:border-gray-600" /><div className="flex gap-2"><button disabled={busy === item.id} onClick={() => void review(item, 'approved')} className="flex h-10 items-center gap-1 rounded-md bg-emerald-600 px-3 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"><Check className="h-4 w-4" />通过</button><button disabled={busy === item.id} onClick={() => void review(item, 'rejected')} className="flex h-10 items-center gap-1 rounded-md bg-red-600 px-3 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"><ShieldX className="h-4 w-4" />驳回</button>{item.review_status !== 'pending' && <button disabled={busy === item.id} onClick={() => void review(item, 'pending')} className="h-10 rounded-md border border-gray-300 px-3 text-sm hover:bg-gray-50">待审</button>}</div></div></article>)}</div>}<div className="flex justify-end gap-2"><button aria-label="上一页" disabled={loading || page === 1} onClick={() => setPage(value => value - 1)} className="rounded-md border border-gray-300 p-2 disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button><span className="self-center text-sm text-gray-500">第 {page} 页</span><button aria-label="下一页" disabled={loading || page * 20 >= total} onClick={() => setPage(value => value + 1)} className="rounded-md border border-gray-300 p-2 disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button></div></div>;
}

function SecurityView({ token, days, onUnauthorized }: { token: string; days: number; onUnauthorized: () => void }) {
  const [data, setData] = useState<AdminSecurity | null>(null); const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  const controllerRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);
  const load = useCallback(async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const requestId = ++requestIdRef.current;
    setLoading(true); setError('');
    try {
      const result = await adminApi.security(token, days, { signal: controller.signal });
      if (requestId === requestIdRef.current && !controller.signal.aborted) setData(result);
    } catch (reason) {
      if (requestId !== requestIdRef.current || controller.signal.aborted) return;
      if (reason instanceof AdminApiError && reason.status === 401) onUnauthorized();
      else setError(reason instanceof Error ? reason.message : '加载失败。');
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [days, onUnauthorized, token]);
  useEffect(() => {
    void load();
    return () => {
      requestIdRef.current += 1;
      controllerRef.current?.abort();
    };
  }, [load]);
  if (!data) return <SectionState loading={loading} error={error} retry={load} />;
  const values = [{ label: 'API 请求', value: data.api.total, icon: Activity }, { label: '成功率', value: `${(data.api.success_rate * 100).toFixed(1)}%`, icon: Gauge }, { label: 'AI 调用', value: data.api.ai_calls, icon: Bot }, { label: '4xx', value: data.api.client_errors, icon: AlertTriangle }, { label: '5xx', value: data.api.server_errors, icon: Server }, { label: '被限流', value: data.api.rate_limited, icon: ShieldX }, { label: '要求验证', value: data.api.captcha_required, icon: ShieldCheck }, { label: '验证通过', value: data.api.captcha_passed, icon: Check }];
  return <div className="space-y-6"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{values.map(item => <Kpi key={item.label} label={item.label} value={String(item.value)} icon={item.icon} tone="bg-gray-100 text-gray-700" />)}</div><section className="rounded-lg border border-gray-200 bg-white"><div className="border-b border-gray-200 px-5 py-4"><h2 className="text-base font-semibold text-gray-900">安全事件</h2></div>{data.events.length === 0 ? <p className="p-8 text-center text-sm text-gray-500">暂无安全事件</p> : <div className="divide-y divide-gray-100">{data.events.map(event => <div key={event.id} className="grid gap-2 px-5 py-4 text-sm md:grid-cols-[160px_180px_1fr_140px]"><span className="text-gray-500">{formatDate(event.created_at)}</span><span className="font-medium text-gray-900">{event.event_type}</span><span className="text-gray-600">{event.api_path || '-'}</span><span className="text-gray-500">{event.action_taken || event.severity}</span></div>)}</div>}</section></div>;
}

export function AdminPage() {
  const [token, setToken] = useState(() => sessionStorage.getItem(TOKEN_KEY) || '');
  const [verified, setVerified] = useState(false);
  const [tab, setTab] = useState<Tab>('overview');
  const [days, setDays] = useState(7);
  const [overviewVersion, setOverviewVersion] = useState(0);
  const authControllerRef = useRef<AbortController | null>(null);
  const authRequestIdRef = useRef(0);
  const unauthorized = useCallback(() => {
    authRequestIdRef.current += 1;
    authControllerRef.current?.abort();
    sessionStorage.removeItem(TOKEN_KEY);
    setToken('');
    setVerified(false);
  }, []);
  const login = async (nextToken: string, signal: AbortSignal) => {
    authControllerRef.current?.abort();
    const requestId = ++authRequestIdRef.current;
    await adminApi.overview(nextToken, 7, { signal });
    if (requestId !== authRequestIdRef.current || signal.aborted) return;
    sessionStorage.setItem(TOKEN_KEY, nextToken);
    setToken(nextToken);
    setVerified(true);
  };
  useEffect(() => {
    if (!token || verified) return;
    const controller = new AbortController();
    authControllerRef.current?.abort();
    authControllerRef.current = controller;
    const requestId = ++authRequestIdRef.current;
    void adminApi.overview(token, 7, { signal: controller.signal }).then(() => {
      if (requestId === authRequestIdRef.current && !controller.signal.aborted) setVerified(true);
    }).catch(reason => {
      if (requestId !== authRequestIdRef.current || controller.signal.aborted) return;
      if (reason instanceof AdminApiError && reason.status === 401) unauthorized();
      else setVerified(true);
    });
    return () => {
      if (requestId === authRequestIdRef.current) authRequestIdRef.current += 1;
      controller.abort();
    };
  }, [token, unauthorized, verified]);
  const title = useMemo(() => navItems.find(item => item.id === tab)?.label || '管理后台', [tab]);
  if (!token || !verified) return <Login onLogin={login} />;
  return <div className="min-h-screen bg-gray-100 text-gray-900"><header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-gray-200 bg-white px-4 md:px-6"><div className="flex items-center gap-3"><div className="flex h-9 w-9 items-center justify-center rounded-md bg-gray-900 text-white"><ShieldCheck className="h-5 w-5" /></div><div><p className="font-semibold">JobLens 管理后台</p><p className="text-xs text-gray-500">{title}</p></div></div><div className="flex items-center gap-3"><span className="hidden items-center gap-1.5 text-xs text-emerald-700 sm:flex"><span className="h-2 w-2 rounded-full bg-emerald-500" />已连接</span><button onClick={unauthorized} title="退出登录" aria-label="退出登录" className="rounded-md border border-gray-300 p-2 text-gray-600 hover:bg-gray-50"><LogOut className="h-4 w-4" /></button></div></header><div className="mx-auto flex max-w-[1600px] flex-col md:flex-row"><aside className="border-b border-gray-200 bg-white md:min-h-[calc(100vh-4rem)] md:w-56 md:border-b-0 md:border-r"><nav className="flex gap-1 overflow-x-auto p-3 md:flex-col">{navItems.map(item => { const Icon = item.icon; return <button key={item.id} onClick={() => setTab(item.id)} className={`flex min-w-max items-center gap-2 rounded-md px-3 py-2.5 text-sm font-medium ${tab === item.id ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-100'}`}><Icon className="h-4 w-4" />{item.label}</button>; })}</nav></aside><main className="min-w-0 flex-1 p-4 md:p-6"><div className="mb-5 flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-xl font-semibold text-gray-950">{title}</h1><p className="mt-1 text-sm text-gray-500">近 {days} 天</p></div>{(tab === 'overview' || tab === 'security') && <div className="flex rounded-md border border-gray-300 bg-white p-1">{[1, 7, 30].map(value => <button key={value} onClick={() => setDays(value)} className={`rounded px-3 py-1.5 text-sm ${days === value ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-100'}`}>{value} 天</button>)}</div>}</div>{tab === 'overview' && <OverviewView token={token} days={days} refreshVersion={overviewVersion} onUnauthorized={unauthorized} />}{tab === 'reports' && <ReportsView token={token} onUnauthorized={unauthorized} />}{tab === 'feedbacks' && <FeedbacksView token={token} onUnauthorized={unauthorized} onChanged={() => setOverviewVersion(value => value + 1)} />}{tab === 'security' && <SecurityView token={token} days={days} onUnauthorized={unauthorized} />}</main></div></div>;
}
