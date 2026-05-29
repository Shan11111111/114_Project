// frontend/app/eval-dashboard/page.tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  CartesianGrid,
  Legend,
} from 'recharts';

type EvalLog = {
  eval_id: number;
  question: string;
  rag_mode: string;
  faithfulness: number;
  supported_claims: number;
  total_claims: number;
  created_at: string;
  eval_json?: string;
};

type KnowledgeGap = {
  gap_id: number;
  question: string;
  claim: string;
  suggested_query: string;
  source_suggestion: string;
  status: string;
  created_at: string;
};

type QuickFilter =
  | 'all'
  | 'low'
  | 'mid'
  | 'high'
  | 'unsupported'
  | 'pubmed'
  | 'vector'
  | 'today'
  | 'auto_fusion'
  | 'latest10';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || '';

const QUICK_FILTERS: { key: QuickFilter; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'low', label: '低分 < 50%' },
  { key: 'mid', label: '中分 50~80%' },
  { key: 'high', label: '高分 ≥ 80%' },
  { key: 'unsupported', label: '有 Unsupported' },
  { key: 'pubmed', label: 'PubMed' },
  { key: 'vector', label: 'Vector' },
  { key: 'today', label: '今日' },
  { key: 'auto_fusion', label: 'Auto Fusion' },
  { key: 'latest10', label: '最新 10 筆' },
];

function scoreClass(score: number) {
  if (score >= 0.8) return 'bg-green-100 text-green-700 border-green-200';
  if (score >= 0.5) return 'bg-yellow-100 text-yellow-700 border-yellow-200';
  return 'bg-red-100 text-red-700 border-red-200';
}

function parseEvalJson(log: EvalLog | null) {
  if (!log?.eval_json) return null;
  try {
    return JSON.parse(log.eval_json);
  } catch {
    return null;
  }
}

function logBlob(log: EvalLog) {
  return `${log.question} ${log.rag_mode} ${log.created_at} ${
    log.eval_json || ''
  }`.toLowerCase();
}

function getUnsupportedCount(log: EvalLog) {
  const parsed = parseEvalJson(log);
  return parsed?.unsupported_claims?.length || 0;
}

function getSourceSummary(log: EvalLog) {
  const parsed = parseEvalJson(log);
  const details = parsed?.details || [];
  const sources = details
    .map((d: any) => d?.evidence_source?.source_type)
    .filter(Boolean);

  if (!sources.length) return '未提供';
  return Array.from(new Set(sources)).join(' / ');
}

export default function EvalDashboardPage() {
  const [logs, setLogs] = useState<EvalLog[]>([]);
  const [gaps, setGaps] = useState<KnowledgeGap[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedLog, setSelectedLog] = useState<EvalLog | null>(null);
  const [selectedGap, setSelectedGap] = useState<KnowledgeGap | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [quickFilter, setQuickFilter] = useState<QuickFilter>('all');

  async function loadData() {
    setLoading(true);
    try {
      const [summaryRes, gapsRes] = await Promise.all([
        fetch(`${API_BASE}/eval-dashboard/summary`, { cache: 'no-store' }),
        fetch(`${API_BASE}/eval-dashboard/knowledge-gaps`, { cache: 'no-store' }),
      ]);

      const summaryData = await summaryRes.json();
      const gapData = await gapsRes.json();

      setLogs(Array.isArray(summaryData) ? summaryData : []);
      setGaps(Array.isArray(gapData) ? gapData : []);
    } catch (err) {
      console.error('load eval dashboard failed:', err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (!autoRefresh) return;
    const timer = setInterval(loadData, 5000);
    return () => clearInterval(timer);
  }, [autoRefresh]);

  const filteredLogs = useMemo(() => {
    let result = [...logs];
    const q = keyword.trim().toLowerCase();

    if (q) {
      result = result.filter((x) => {
        const blob = logBlob(x);

        if (['低分', '沒證據', '幻覺', 'hallucination'].some((k) => q.includes(k))) {
          return x.faithfulness < 0.5 || blob.includes('"supported": false');
        }

        if (['高分', '穩定', '可信'].some((k) => q.includes(k))) {
          return x.faithfulness >= 0.8;
        }

        if (['中分', '普通'].some((k) => q.includes(k))) {
          return x.faithfulness >= 0.5 && x.faithfulness < 0.8;
        }

        return blob.includes(q);
      });
    }

    switch (quickFilter) {
      case 'low':
        result = result.filter((x) => x.faithfulness < 0.5);
        break;
      case 'mid':
        result = result.filter((x) => x.faithfulness >= 0.5 && x.faithfulness < 0.8);
        break;
      case 'high':
        result = result.filter((x) => x.faithfulness >= 0.8);
        break;
      case 'unsupported':
        result = result.filter((x) => (x.eval_json || '').includes('"supported": false'));
        break;
      case 'pubmed':
        result = result.filter((x) => logBlob(x).includes('pubmed'));
        break;
      case 'vector':
        result = result.filter((x) => logBlob(x).includes('vector'));
        break;
      case 'today':
        result = result.filter((x) =>
          x.created_at.startsWith(new Date().toISOString().split('T')[0])
        );
        break;
      case 'auto_fusion':
        result = result.filter((x) => x.rag_mode === 'auto_fusion');
        break;
      case 'latest10':
        result = result.slice(0, 10);
        break;
    }

    return result;
  }, [logs, keyword, quickFilter]);

  const chartLogs = useMemo(() => [...filteredLogs].reverse(), [filteredLogs]);

  const avgFaithfulness = useMemo(() => {
    if (!filteredLogs.length) return 0;
    const sum = filteredLogs.reduce((acc, x) => acc + Number(x.faithfulness || 0), 0);
    return sum / filteredLogs.length;
  }, [filteredLogs]);

  const selectedParsed = parseEvalJson(selectedLog);
  const selectedDetails = selectedParsed?.details || [];
  const latest = filteredLogs[0];

  function selectLogByEvalId(evalId: number | string | undefined) {
    if (!evalId) return;
    const target = logs.find((x) => String(x.eval_id) === String(evalId));
    if (target) {
      setSelectedLog(target);
      setSelectedGap(null);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 p-8">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-800">
              RAG Observability Dashboard
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              追蹤 Faithfulness、Unsupported Claims、Evidence Source 與知識缺口。
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setAutoRefresh((v) => !v)}
              className={`rounded-xl border px-4 py-2 text-sm ${
                autoRefresh
                  ? 'border-green-200 bg-green-50 text-green-700'
                  : 'border-slate-200 bg-white text-slate-600'
              }`}
            >
              {autoRefresh ? '自動更新中' : '開啟自動更新'}
            </button>

            <button
              onClick={loadData}
              className="rounded-xl bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-700"
            >
              重新整理
            </button>
          </div>
        </div>

        <div className="mb-3">
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="懶人查詢：低分、沒證據、幻覺、PubMed、Vector、更年期、維生素D、auto_fusion..."
            className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-slate-400"
          />
        </div>

        <div className="mb-6 flex flex-wrap gap-2">
          {QUICK_FILTERS.map((filter) => (
            <button
              key={filter.key}
              onClick={() => setQuickFilter(filter.key)}
              className={`rounded-full border px-4 py-2 text-sm transition ${
                quickFilter === filter.key
                  ? 'border-slate-900 bg-slate-900 text-white'
                  : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              {filter.label}
            </button>
          ))}

          {(keyword || quickFilter !== 'all') && (
            <button
              onClick={() => {
                setKeyword('');
                setQuickFilter('all');
              }}
              className="rounded-full border border-red-100 bg-red-50 px-4 py-2 text-sm text-red-600 hover:bg-red-100"
            >
              清除篩選
            </button>
          )}
        </div>

        <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-5">
          <div className="rounded-2xl bg-white p-5 shadow-sm">
            <div className="text-sm text-slate-500">平均 Faithfulness</div>
            <div className="mt-2 text-3xl font-bold text-slate-800">
              {(avgFaithfulness * 100).toFixed(1)}%
            </div>
          </div>

          <div className="rounded-2xl bg-white p-5 shadow-sm">
            <div className="text-sm text-slate-500">目前顯示筆數</div>
            <div className="mt-2 text-3xl font-bold text-slate-800">
              {filteredLogs.length}
            </div>
          </div>

          <div className="rounded-2xl bg-white p-5 shadow-sm">
            <div className="text-sm text-slate-500">最近一筆分數</div>
            <div className="mt-2 text-3xl font-bold text-slate-800">
              {latest ? `${(latest.faithfulness * 100).toFixed(1)}%` : '-'}
            </div>
          </div>

          <div className="rounded-2xl bg-white p-5 shadow-sm">
            <div className="text-sm text-slate-500">低於 50% 筆數</div>
            <div className="mt-2 text-3xl font-bold text-red-600">
              {filteredLogs.filter((x) => x.faithfulness < 0.5).length}
            </div>
          </div>

          <div className="rounded-2xl bg-white p-5 shadow-sm">
            <div className="text-sm text-slate-500">待補資料缺口</div>
            <div className="mt-2 text-3xl font-bold text-orange-600">
              {gaps.filter((x) => x.status === 'pending_review').length}
            </div>
          </div>
        </div>

        <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="rounded-2xl bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-semibold text-slate-800">Faithfulness 趨勢</h2>
              <span className="text-xs text-slate-500">點擊圖表節點可查看該筆資料</span>
            </div>

            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={chartLogs}
                  onClick={(state: any) => {
                    const payload = state?.activePayload?.[0]?.payload;
                    if (payload?.eval_id) selectLogByEvalId(payload.eval_id);
                  }}
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="eval_id" />
                  <YAxis domain={[0, 1]} />
                  <Tooltip
                    formatter={(value: any) => [`${(Number(value) * 100).toFixed(1)}%`, 'Faithfulness']}
                    labelFormatter={(label) => `Eval #${label}`}
                  />
                  <Line
                    type="monotone"
                    dataKey="faithfulness"
                    name="Faithfulness"
                    strokeWidth={3}
                    dot={{ r: 5 }}
                    activeDot={{ r: 8, onClick: (_: any, payload: any) => selectLogByEvalId(payload?.payload?.eval_id) }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="rounded-2xl bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-semibold text-slate-800">Claims 支持數</h2>
              <span className="text-xs text-slate-500">點擊柱狀圖可查看該題 claim</span>
            </div>

            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={filteredLogs}
                  onClick={(state: any) => {
                    const payload = state?.activePayload?.[0]?.payload;
                    if (payload?.eval_id) selectLogByEvalId(payload.eval_id);
                  }}
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="eval_id" />
                  <YAxis allowDecimals={false} />
                  <Tooltip labelFormatter={(label) => `Eval #${label}`} />
                  <Legend />
                  <Bar dataKey="supported_claims" name="Supported" />
                  <Bar dataKey="total_claims" name="Total" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-4">
            <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
              <div className="border-b p-4">
                <h2 className="font-bold text-slate-800">評估紀錄</h2>
                <p className="text-xs text-slate-500">
                  點擊表格列或圖表節點，右側會自動顯示該筆詳細資料。
                </p>
              </div>

              <table className="w-full border-collapse text-sm">
                <thead className="bg-slate-100 text-left text-slate-600">
                  <tr>
                    <th className="p-4">時間</th>
                    <th className="p-4">問題</th>
                    <th className="p-4">RAG 模式</th>
                    <th className="p-4">來源</th>
                    <th className="p-4">Faithfulness</th>
                    <th className="p-4">Claims</th>
                  </tr>
                </thead>

                <tbody>
                  {loading ? (
                    <tr>
                      <td className="p-4 text-slate-500" colSpan={6}>
                        載入中...
                      </td>
                    </tr>
                  ) : filteredLogs.length === 0 ? (
                    <tr>
                      <td className="p-4 text-slate-500" colSpan={6}>
                        目前沒有評估資料
                      </td>
                    </tr>
                  ) : (
                    filteredLogs.map((log) => (
                      <tr
                        key={log.eval_id}
                        onClick={() => {
                          setSelectedLog(log);
                          setSelectedGap(null);
                        }}
                        className={`cursor-pointer border-t hover:bg-slate-50 ${
                          selectedLog?.eval_id === log.eval_id ? 'bg-slate-50' : ''
                        }`}
                      >
                        <td className="p-4 text-slate-500">{log.created_at}</td>
                        <td className="p-4 font-medium text-slate-800">
                          <div className="line-clamp-2">{log.question}</div>
                          {getUnsupportedCount(log) > 0 && (
                            <div className="mt-1 text-xs text-red-600">
                              {getUnsupportedCount(log)} 個 unsupported claim
                            </div>
                          )}
                        </td>
                        <td className="p-4 text-slate-600">{log.rag_mode}</td>
                        <td className="p-4 text-slate-500">{getSourceSummary(log)}</td>
                        <td className="p-4">
                          <span
                            className={`rounded-full border px-3 py-1 text-xs font-semibold ${scoreClass(
                              log.faithfulness
                            )}`}
                          >
                            {(log.faithfulness * 100).toFixed(1)}%
                          </span>
                        </td>
                        <td className="p-4 text-slate-600">
                          {log.supported_claims} / {log.total_claims}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="rounded-2xl bg-white p-5 shadow-sm">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h2 className="font-bold text-slate-800">知識缺口 / 待補資料</h2>
                  <p className="text-xs text-slate-500">
                    由 unsupported claims 自動產生，管理者可依建議補教材。
                  </p>
                </div>

                <a
                  href="/llm/materials"
                  className="rounded-xl bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-700"
                >
                  前往教材管理
                </a>
              </div>

              {gaps.length === 0 ? (
                <div className="rounded-xl border border-dashed p-6 text-sm text-slate-500">
                  目前沒有待補資料缺口。
                </div>
              ) : (
                <div className="max-h-[420px] space-y-3 overflow-y-auto pr-1">
                  {gaps.map((gap) => (
                    <button
                      key={gap.gap_id}
                      onClick={() => {
                        setSelectedGap(gap);
                        setSelectedLog(null);
                      }}
                      className={`w-full rounded-xl border p-4 text-left hover:bg-orange-50 ${
                        selectedGap?.gap_id === gap.gap_id
                          ? 'border-orange-300 bg-orange-50'
                          : 'border-slate-200 bg-white'
                      }`}
                    >
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-orange-700">
                          Gap #{gap.gap_id}
                        </span>
                        <span className="rounded-full bg-orange-100 px-2 py-1 text-xs text-orange-700">
                          {gap.status}
                        </span>
                      </div>
                      <div className="line-clamp-2 text-sm font-medium text-slate-800">
                        {gap.claim}
                      </div>
                      <div className="mt-2 text-xs text-slate-500">
                        建議來源：{gap.source_suggestion}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <aside className="rounded-2xl bg-white p-5 shadow-sm">
            {selectedGap ? (
              <div>
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <h2 className="font-bold text-slate-800">知識缺口詳情</h2>
                    <p className="text-xs text-slate-500">
                      可依 Suggested Query 補教材或查 PubMed。
                    </p>
                  </div>
                  <button
                    onClick={() => setSelectedGap(null)}
                    className="text-sm text-slate-500 hover:text-slate-800"
                  >
                    清除
                  </button>
                </div>

                <div className="space-y-4 text-sm">
                  <div>
                    <div className="mb-1 text-xs font-semibold text-slate-500">原始問題</div>
                    <div className="rounded-xl bg-slate-50 p-3 text-slate-800">
                      {selectedGap.question}
                    </div>
                  </div>

                  <div>
                    <div className="mb-1 text-xs font-semibold text-slate-500">Unsupported Claim</div>
                    <div className="rounded-xl bg-red-50 p-3 text-red-800">
                      {selectedGap.claim}
                    </div>
                  </div>

                  <div>
                    <div className="mb-1 text-xs font-semibold text-slate-500">Suggested Query</div>
                    <div className="rounded-xl bg-orange-50 p-3 text-orange-800">
                      {selectedGap.suggested_query}
                    </div>
                  </div>

                  <div>
                    <div className="mb-1 text-xs font-semibold text-slate-500">建議補資料來源</div>
                    <div className="rounded-xl bg-slate-50 p-3 text-slate-700">
                      {selectedGap.source_suggestion}
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <button
                      onClick={() => navigator.clipboard.writeText(selectedGap.suggested_query)}
                      className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
                    >
                      複製查詢字串
                    </button>
                    <a
                      href="/llm/materials"
                      className="rounded-xl bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-700"
                    >
                      去教材管理補資料
                    </a>
                  </div>
                </div>
              </div>
            ) : (
              <div>
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <h2 className="font-bold text-slate-800">Claim 詳細證據</h2>
                    <p className="text-xs text-slate-500">
                      點選左側紀錄或圖表節點查看 evidence 與來源。
                    </p>
                  </div>

                  {selectedLog && (
                    <button
                      onClick={() => setSelectedLog(null)}
                      className="text-sm text-slate-500 hover:text-slate-800"
                    >
                      清除
                    </button>
                  )}
                </div>

                {!selectedLog ? (
                  <div className="rounded-xl border border-dashed p-6 text-sm text-slate-500">
                    尚未選擇評估紀錄。
                  </div>
                ) : (
                  <div>
                    <div className="mb-4 rounded-xl border bg-slate-50 p-4">
                      <div className="mb-1 text-xs text-slate-500">
                        Eval #{selectedLog.eval_id}
                      </div>
                      <div className="font-semibold text-slate-800">
                        {selectedLog.question}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2 text-xs">
                        <span className={`rounded-full border px-2 py-1 ${scoreClass(selectedLog.faithfulness)}`}>
                          Faithfulness {(selectedLog.faithfulness * 100).toFixed(1)}%
                        </span>
                        <span className="rounded-full bg-slate-100 px-2 py-1 text-slate-600">
                          {selectedLog.supported_claims}/{selectedLog.total_claims} claims
                        </span>
                        <span className="rounded-full bg-slate-100 px-2 py-1 text-slate-600">
                          {selectedLog.rag_mode}
                        </span>
                      </div>
                    </div>

                    {!selectedDetails.length ? (
                      <div className="rounded-xl border border-dashed p-6 text-sm text-slate-500">
                        沒有詳細資料。請確認後端 API 有回傳 eval_json。
                      </div>
                    ) : (
                      <div className="max-h-[720px] space-y-3 overflow-y-auto pr-1">
                        {selectedDetails.map((d: any, idx: number) => (
                          <div
                            key={idx}
                            className={`rounded-xl border p-4 ${
                              d.supported
                                ? 'border-green-100 bg-green-50/60'
                                : 'border-red-100 bg-red-50/60'
                            }`}
                          >
                            <div className="mb-2 flex items-center justify-between">
                              <span className="font-semibold text-slate-800">
                                Claim #{idx + 1}
                              </span>
                              <span
                                className={`rounded-full px-2 py-1 text-xs font-semibold ${
                                  d.supported
                                    ? 'bg-green-100 text-green-700'
                                    : 'bg-red-100 text-red-700'
                                }`}
                              >
                                {d.supported ? 'Supported' : 'Unsupported'}
                              </span>
                            </div>

                            <div className="mb-3 text-sm">
                              <div className="mb-1 text-xs font-semibold text-slate-500">
                                Claim
                              </div>
                              <div className="text-slate-800">{d.claim}</div>
                            </div>

                            <div className="mb-3 text-sm">
                              <div className="mb-1 text-xs font-semibold text-slate-500">
                                Evidence
                              </div>
                              <div className="rounded-lg bg-white p-3 text-slate-700">
                                {d.evidence || '無可用證據'}
                              </div>
                            </div>

                            <div className="mb-3 text-sm">
                              <div className="mb-1 text-xs font-semibold text-slate-500">
                                Reason
                              </div>
                              <div className="text-slate-700">
                                {d.reason || '未提供'}
                              </div>
                            </div>

                            <div className="rounded-lg bg-white p-3 text-xs text-slate-500">
                              來源：{d.evidence_source?.title || '未提供'}
                              {d.evidence_source?.page
                                ? `｜${d.evidence_source.page}`
                                : ''}
                              {d.evidence_source?.source_type
                                ? `｜${d.evidence_source.source_type}`
                                : ''}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </aside>
        </div>
      </div>
    </main>
  );
}