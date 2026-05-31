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
    CartesianGrid,
} from 'recharts';

type EvalLog = {
    eval_id: number;
    question: string;
    rag_mode: string;
    faithfulness: number | null;
    supported_claims: number;
    total_claims: number;
    raw_total_claims?: number;
    safety_claims?: number;
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

type GapCandidate = {
    candidate_id: number;
    source_type: string;
    title: string;
    url?: string;
    summary: string;
    score: number;
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
    { key: 'low', label: '低分' },
    { key: 'mid', label: '中分' },
    { key: 'high', label: '高分' },
    { key: 'unsupported', label: '缺證據' },
    { key: 'pubmed', label: 'PubMed' },
    { key: 'vector', label: 'Vector' },
    { key: 'today', label: '今日' },
    { key: 'auto_fusion', label: 'Auto Fusion' },
    { key: 'latest10', label: '最新 10 筆' },
];

function scoreClass(score: number) {
    if (score >= 0.8) return 'bg-emerald-100 text-emerald-700 border-emerald-200';
    if (score >= 0.5) return 'bg-amber-100 text-amber-700 border-amber-200';
    return 'bg-rose-100 text-rose-700 border-rose-200';
}

function scoreDotClass(score: number) {
    if (score >= 0.8) return 'bg-emerald-500';
    if (score >= 0.5) return 'bg-amber-500';
    return 'bg-rose-500';
}

function statusText(score: number, lowCount: number, gapCount: number) {
    if (lowCount > 0 || gapCount > 0) return '需補證據';
    if (score >= 0.8) return '穩定';
    if (score >= 0.5) return '可觀察';
    return '高風險';
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
    return `${log.question} ${log.rag_mode} ${log.created_at} ${log.eval_json || ''}`.toLowerCase();
}

function getFaithfulnessScore(log: EvalLog | null) {
    if (!log) return 0;
    if (typeof log.faithfulness === 'number') return log.faithfulness;

    const parsed = parseEvalJson(log);
    if (typeof parsed?.faithfulness === 'number') return parsed.faithfulness;

    return 0;
}

function getSafetyCount(log: EvalLog) {
    const parsed = parseEvalJson(log);

    if (typeof parsed?.safety_claims === 'number') {
        return parsed.safety_claims;
    }

    if (typeof log.safety_claims === 'number') {
        return log.safety_claims;
    }

    return Array.isArray(parsed?.details)
        ? parsed.details.filter((d: any) => d?.support_type === 'general_safety_advice').length
        : 0;
}

function getRawTotalClaims(log: EvalLog) {
    const parsed = parseEvalJson(log);

    if (typeof parsed?.raw_total_claims === 'number') {
        return parsed.raw_total_claims;
    }

    if (typeof log.raw_total_claims === 'number') {
        return log.raw_total_claims;
    }

    return Array.isArray(parsed?.details) ? parsed.details.length : log.total_claims;
}

function isSafetyClaim(d: any) {
    return d?.support_type === 'general_safety_advice';
}

function isUnsupportedClaim(d: any) {
    return d?.support_type === 'unsupported' || d?.supported === false;
}

function claimBadgeLabel(d: any) {
    if (isSafetyClaim(d)) return 'Safety';
    if (d?.supported) return 'Supported';
    return 'Unsupported';
}

function claimCardClass(d: any) {
    if (isSafetyClaim(d)) return 'border-sky-100 bg-sky-50/80';
    if (d?.supported) return 'border-emerald-100 bg-emerald-50/70';
    return 'border-rose-100 bg-rose-50/80';
}

function claimBadgeClass(d: any) {
    if (isSafetyClaim(d)) return 'bg-sky-100 text-sky-700';
    if (d?.supported) return 'bg-emerald-100 text-emerald-700';
    return 'bg-rose-100 text-rose-700';
}
function getUnsupportedCount(log: EvalLog) {
    const parsed = parseEvalJson(log);

    const unsupportedClaims = Array.isArray(parsed?.unsupported_claims)
        ? parsed.unsupported_claims.filter((d: any) => !isSafetyClaim(d)).length
        : 0;

    const detailUnsupported = Array.isArray(parsed?.details)
        ? parsed.details.filter((d: any) => isUnsupportedClaim(d) && !isSafetyClaim(d)).length
        : 0;

    return Math.max(unsupportedClaims, detailUnsupported);
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

function formatTime(value: string) {
    if (!value) return '-';
    return value.replace('T', ' ').slice(0, 16);
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
    const [gapCandidates, setGapCandidates] = useState<GapCandidate[]>([]);
    const [loadingCandidates, setLoadingCandidates] = useState(false);
    const [approvingCandidateId, setApprovingCandidateId] = useState<number | null>(null);
    const [gapBusyId, setGapBusyId] = useState<number | null>(null);
    const [gapActionMessage, setGapActionMessage] = useState('');

    const PAGE_SIZE = 6;
    const [page, setPage] = useState(1);

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

    useEffect(() => {
        setPage(1);
    }, [keyword, quickFilter]);

    const filteredLogs = useMemo(() => {
        let result = [...logs];
        const q = keyword.trim().toLowerCase();

        if (q) {
            result = result.filter((x) => {
                const blob = logBlob(x);

                if (['低分', '沒證據', '缺證據', '幻覺', 'hallucination'].some((k) => q.includes(k))) {
                    return getFaithfulnessScore(x) < 0.5 || blob.includes('"supported": false') || getUnsupportedCount(x) > 0;
                }

                if (['高分', '穩定', '可信'].some((k) => q.includes(k))) {
                    return getFaithfulnessScore(x) >= 0.8;
                }

                if (['中分', '普通'].some((k) => q.includes(k))) {
                    return getFaithfulnessScore(x) >= 0.5 && getFaithfulnessScore(x) < 0.8;
                }

                return blob.includes(q);
            });
        }

        switch (quickFilter) {
            case 'low':
                result = result.filter((x) => getFaithfulnessScore(x) < 0.5);
                break;
            case 'mid':
                result = result.filter((x) => getFaithfulnessScore(x) >= 0.5 && getFaithfulnessScore(x) < 0.8);
                break;
            case 'high':
                result = result.filter((x) => getFaithfulnessScore(x) >= 0.8);
                break;
            case 'unsupported':
                result = result.filter((x) => (x.eval_json || '').includes('"supported": false') || getUnsupportedCount(x) > 0);
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

    const pagedLogs = useMemo(() => {
        const start = (page - 1) * PAGE_SIZE;
        return filteredLogs.slice(start, start + PAGE_SIZE);
    }, [filteredLogs, page]);

    const totalPages = Math.max(1, Math.ceil(filteredLogs.length / PAGE_SIZE));
    const chartLogs = useMemo(
        () =>
            [...filteredLogs].reverse().map((x) => ({
                ...x,
                faithfulness_score: getFaithfulnessScore(x),
            })),
        [filteredLogs]
    );

    const avgFaithfulness = useMemo(() => {
        if (!filteredLogs.length) return 0;
        const sum = filteredLogs.reduce((acc, x) => acc + getFaithfulnessScore(x), 0);
        return sum / filteredLogs.length;
    }, [filteredLogs]);

    const lowCount = filteredLogs.filter((x) => getFaithfulnessScore(x) < 0.5).length;
    const midCount = filteredLogs.filter((x) => getFaithfulnessScore(x) >= 0.5 && getFaithfulnessScore(x) < 0.8).length;
    const highCount = filteredLogs.filter((x) => getFaithfulnessScore(x) >= 0.8).length;
    const safetyTotal = filteredLogs.reduce((acc, x) => acc + getSafetyCount(x), 0);





    const pendingGapCount = gaps.filter((x) => x.status === 'pending_review').length;
    const unsupportedTotal = filteredLogs.reduce((acc, x) => acc + getUnsupportedCount(x), 0);
    const latest = filteredLogs[0];
    const activeLog = selectedLog || latest || null;
    const activeParsed = parseEvalJson(activeLog);
    const activeDetails = activeParsed?.details || [];
    const dashboardStatus = statusText(avgFaithfulness, lowCount, pendingGapCount);

    const priorityLogs = useMemo(() => {
        return filteredLogs
            .filter((x) => getFaithfulnessScore(x) < 0.8 || getUnsupportedCount(x) > 0)
            .slice(0, 8);
    }, [filteredLogs]);

    function selectLog(log: EvalLog) {
        setSelectedLog(log);
        setSelectedGap(null);
        setGapCandidates([]);
        setGapActionMessage('');
    }

    function selectLogByEvalId(evalId: number | string | undefined) {
        if (!evalId) return;
        const target = logs.find((x) => String(x.eval_id) === String(evalId));
        if (target) selectLog(target);
    }

    async function loadGapCandidates(gapId: number) {
        setLoadingCandidates(true);

        try {
            const res = await fetch(`${API_BASE}/eval-dashboard/gap-candidates/${gapId}`, {
                cache: 'no-store',
            });

            if (!res.ok) throw new Error('load gap candidates failed');

            const data = await res.json();
            setGapCandidates(Array.isArray(data) ? data : []);
        } catch (err) {
            console.error('loadGapCandidates failed:', err);
            setGapCandidates([]);
        } finally {
            setLoadingCandidates(false);
        }
    }

    async function prepareGapMaterial(gap: KnowledgeGap) {
        setGapBusyId(gap.gap_id);
        setGapActionMessage('');

        try {
            const res = await fetch(`${API_BASE}/eval-dashboard/knowledge-gaps/${gap.gap_id}/prepare-material`, {
                method: 'POST',
            });

            const data = await res.json();

            if (!res.ok) {
                throw new Error(data?.detail || data?.message || 'prepare-material failed');
            }

            const candidates = Array.isArray(data?.candidates) ? data.candidates : [];
            setGapCandidates(candidates);

            await loadData();

            setGapActionMessage(
                candidates.length > 0
                    ? `已找到 ${candidates.length} 筆候選教材，請逐筆審查後再匯入。`
                    : '沒有找到候選教材，請換查詢詞或改查其他來源。'
            );
        } catch (err) {
            console.error('prepareGapMaterial failed:', err);
            setGapActionMessage('準備教材失敗，請確認後端 API、IIS Rewrite 或 PubMed 查詢。');
        } finally {
            setGapBusyId(null);
        }
    }

    async function approveCandidate(candidateId: number) {
        if (!selectedGap) return;

        setApprovingCandidateId(candidateId);
        setGapActionMessage('');

        try {
            const res = await fetch(`${API_BASE}/eval-dashboard/gap-candidates/${candidateId}/approve`, {
                method: 'POST',
            });

            const data = await res.json();

            if (!res.ok) {
                throw new Error(data?.detail || data?.message || 'approve failed');
            }

            await loadData();
            await loadGapCandidates(selectedGap.gap_id);

            setGapActionMessage(
                data?.index_ok
                    ? '已審查匯入，並完成向量索引。'
                    : `已匯入教材庫，但索引失敗：${data?.index_error || '請看後端 log'}`
            );
        } catch (err) {
            console.error('approveCandidate failed:', err);
            setGapActionMessage('審查匯入失敗，請確認 TeachingMaterial 欄位、uploads 權限或 Qdrant。');
        } finally {
            setApprovingCandidateId(null);
        }
    }

    async function recheckGap(gap: KnowledgeGap) {
        setGapBusyId(gap.gap_id);
        setGapActionMessage('');
        try {
            const res = await fetch(`${API_BASE}/eval-dashboard/knowledge-gaps/${gap.gap_id}/recheck`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ question: gap.question, claim: gap.claim }),
            });
            if (!res.ok) throw new Error('recheck endpoint not ready');
            await loadData();
            await loadGapCandidates(gap.gap_id);
            const data = await res.json().catch(() => null);
            setGapActionMessage(data?.message || '已重新檢查候選教材，資料已更新。');
        } catch (err) {
            setGapActionMessage('重跑檢查需要後端 /recheck API；目前只能先查看缺口與草稿。');
        } finally {
            setGapBusyId(null);
        }
    }

    return (
        <main className="h-screen overflow-hidden bg-slate-950 p-4 text-slate-900">
            <div className="mx-auto flex h-full max-w-[1600px] flex-col gap-4">
                <section className="rounded-[2rem] border border-white/10 bg-white p-5 shadow-2xl shadow-slate-950/20">
                    <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                        <div className="flex items-start gap-4">
                            <div className={`mt-1 h-4 w-4 rounded-full ${lowCount > 0 || pendingGapCount > 0 ? 'bg-rose-500' : 'bg-emerald-500'} shadow-lg`} />
                            <div>
                                <div className="text-sm font-semibold text-slate-500">AI 回答品質檢查台</div>
                                <div className="mt-1 flex flex-wrap items-end gap-3">
                                    <h1 className="text-4xl font-black tracking-tight text-slate-950">
                                        {(avgFaithfulness * 100).toFixed(1)}%
                                    </h1>
                                    <span className="mb-1 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-sm font-bold text-slate-700">
                                        {dashboardStatus}
                                    </span>
                                    <span className="mb-1 text-sm text-slate-500">
                                        {filteredLogs.length} 筆評估 · {unsupportedTotal} 個缺證據 Claim · {safetyTotal} 個安全提醒 · {pendingGapCount} 個待補教材
                                    </span>
                                </div>
                            </div>
                        </div>

                        <div className="flex flex-1 flex-col gap-3 xl:max-w-3xl">
                            <div className="flex gap-2">
                                <input
                                    value={keyword}
                                    onChange={(e) => setKeyword(e.target.value)}
                                    placeholder="搜尋：低分、缺證據、PubMed、Vector、更年期、維生素D、auto_fusion..."
                                    className="min-w-0 flex-1 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-slate-400 focus:bg-white"
                                />
                                <button
                                    onClick={loadData}
                                    className="rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-700"
                                >
                                    重新整理
                                </button>
                                <button
                                    onClick={() => setAutoRefresh((v) => !v)}
                                    className={`rounded-2xl border px-4 py-3 text-sm font-semibold transition ${autoRefresh
                                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                        : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                                        }`}
                                >
                                    {autoRefresh ? '自動中' : '自動'}
                                </button>
                            </div>

                            <div className="flex flex-wrap gap-2">
                                {QUICK_FILTERS.map((filter) => (
                                    <button
                                        key={filter.key}
                                        onClick={() => setQuickFilter(filter.key)}
                                        className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${quickFilter === filter.key
                                            ? 'border-slate-950 bg-slate-950 text-white shadow-sm'
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
                                        className="rounded-full border border-rose-100 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-600 hover:bg-rose-100"
                                    >
                                        清除
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                </section>

                <section className="grid min-h-0 flex-1 grid-cols-1 gap-4 xl:grid-cols-[340px_minmax(0,1fr)_440px]">
                    <aside className="flex min-h-0 flex-col gap-4 rounded-[2rem] border border-white/10 bg-white p-4 shadow-2xl shadow-slate-950/20">
                        <div className="grid grid-cols-3 gap-2">
                            <div className="rounded-2xl border border-rose-100 bg-rose-50 p-3">
                                <div className="text-xs font-semibold text-rose-600">風險</div>
                                <div className="mt-1 text-2xl font-black text-rose-700">{lowCount}</div>
                            </div>
                            <div className="rounded-2xl border border-amber-100 bg-amber-50 p-3">
                                <div className="text-xs font-semibold text-amber-600">觀察</div>
                                <div className="mt-1 text-2xl font-black text-amber-700">{midCount}</div>
                            </div>
                            <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-3">
                                <div className="text-xs font-semibold text-emerald-600">穩定</div>
                                <div className="mt-1 text-2xl font-black text-emerald-700">{highCount}</div>
                            </div>
                        </div>

                        <div className="min-h-0 flex-1 overflow-hidden rounded-3xl border border-slate-200 bg-slate-50">
                            <div className="flex items-center justify-between border-b border-slate-200 bg-white p-4">
                                <div>
                                    <h2 className="font-black text-slate-900">待處理</h2>
                                    <div className="text-xs text-slate-500">紅色優先，橘色補教材</div>
                                </div>
                                <a
                                    href="/llm/materials"
                                    className="rounded-xl bg-orange-500 px-3 py-2 text-xs font-bold text-white hover:bg-orange-600"
                                >
                                    補教材
                                </a>
                            </div>

                            <div className="h-full space-y-3 overflow-y-auto p-3 pb-20">
                                {pendingGapCount === 0 && priorityLogs.length === 0 ? (
                                    <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-5 text-sm text-slate-500">
                                        目前沒有明顯風險項目。
                                    </div>
                                ) : (
                                    <>
                                        {gaps
                                            .filter((gap) => gap.status === 'pending_review')
                                            .slice(0, 5)
                                            .map((gap) => (
                                                <button
                                                    key={gap.gap_id}
                                                    onClick={() => {
                                                        setSelectedGap(gap);
                                                        setSelectedLog(null);
                                                        setGapActionMessage('');
                                                        setGapCandidates([]);
                                                        loadGapCandidates(gap.gap_id);
                                                    }}
                                                    className={`w-full rounded-2xl border p-3 text-left transition hover:-translate-y-0.5 hover:shadow-md ${selectedGap?.gap_id === gap.gap_id
                                                        ? 'border-orange-300 bg-orange-50 shadow-sm'
                                                        : 'border-orange-100 bg-white'
                                                        }`}
                                                >
                                                    <div className="mb-2 flex items-center justify-between gap-2">
                                                        <span className="rounded-full bg-orange-100 px-2 py-1 text-[11px] font-black text-orange-700">
                                                            待補教材
                                                        </span>
                                                        <span className="text-[11px] text-slate-400">Gap #{gap.gap_id}</span>
                                                    </div>
                                                    <div className="line-clamp-2 text-sm font-bold text-slate-800">{gap.claim}</div>
                                                    <div className="mt-2 line-clamp-1 text-xs text-orange-700">{gap.suggested_query}</div>
                                                </button>
                                            ))}

                                        {priorityLogs.map((log) => (
                                            <button
                                                key={log.eval_id}
                                                onClick={() => selectLog(log)}
                                                className={`w-full rounded-2xl border p-3 text-left transition hover:-translate-y-0.5 hover:shadow-md ${activeLog?.eval_id === log.eval_id && !selectedGap
                                                    ? 'border-slate-400 bg-white shadow-sm'
                                                    : 'border-slate-200 bg-white'
                                                    }`}
                                            >
                                                <div className="mb-2 flex items-center justify-between gap-2">
                                                    <span className={`rounded-full border px-2 py-1 text-[11px] font-black ${scoreClass(getFaithfulnessScore(log))}`}>
                                                        {(getFaithfulnessScore(log) * 100).toFixed(0)}%
                                                    </span>
                                                    {getUnsupportedCount(log) > 0 && (
                                                        <span className="rounded-full bg-rose-100 px-2 py-1 text-[11px] font-black text-rose-700">
                                                            {getUnsupportedCount(log)} 缺證據
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="line-clamp-2 text-sm font-bold text-slate-800">{log.question}</div>
                                                <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
                                                    <span>{log.rag_mode}</span>
                                                    <span>#{log.eval_id}</span>
                                                </div>
                                            </button>
                                        ))}
                                    </>
                                )}
                            </div>
                        </div>
                    </aside>

                    <section className="flex min-h-0 flex-col gap-4">
                        <div className="rounded-[2rem] border border-white/10 bg-white p-4 shadow-2xl shadow-slate-950/20">
                            <div className="mb-3 flex items-center justify-between">
                                <div>
                                    <h2 className="font-black text-slate-900">Faithfulness 趨勢</h2>
                                    <div className="text-xs text-slate-500">每個節點代表一筆評估</div>
                                </div>
                                <div className="flex gap-2 text-xs font-bold">
                                    <span className="rounded-full bg-rose-100 px-2 py-1 text-rose-700">低於 50%</span>
                                    <span className="rounded-full bg-amber-100 px-2 py-1 text-amber-700">50–80%</span>
                                    <span className="rounded-full bg-emerald-100 px-2 py-1 text-emerald-700">80% 以上</span>
                                </div>
                            </div>

                            <div className="h-56">
                                <ResponsiveContainer width="100%" height="100%">
                                    <LineChart
                                        data={chartLogs}
                                        onClick={(state: any) => {
                                            const payload = state?.activePayload?.[0]?.payload;
                                            if (payload?.eval_id) selectLogByEvalId(payload.eval_id);
                                        }}
                                    >
                                        <CartesianGrid strokeDasharray="3 3" />
                                        <XAxis dataKey="eval_id" tick={{ fontSize: 12 }} />
                                        <YAxis domain={[0, 1]} tickFormatter={(v) => `${Number(v) * 100}%`} tick={{ fontSize: 12 }} />
                                        <Tooltip
                                            formatter={(value: any) => [`${(Number(value) * 100).toFixed(1)}%`, 'Faithfulness']}
                                            labelFormatter={(label) => `Eval #${label}`}
                                        />
                                        <Line
                                            type="monotone"
                                            dataKey="faithfulness_score"
                                            name="Faithfulness"
                                            strokeWidth={4}
                                            dot={{ r: 5 }}
                                            activeDot={{ r: 9, onClick: (_: any, payload: any) => selectLogByEvalId(payload?.payload?.eval_id) }}
                                        />
                                    </LineChart>
                                </ResponsiveContainer>
                            </div>
                        </div>

                        <div className="min-h-0 flex-1 overflow-hidden rounded-[2rem] border border-white/10 bg-white shadow-2xl shadow-slate-950/20">
                            <div className="flex items-center justify-between border-b border-slate-200 p-4">
                                <div>
                                    <h2 className="font-black text-slate-900">最近評估</h2>
                                    <div className="text-xs text-slate-500">{filteredLogs.length} 筆符合目前條件</div>
                                </div>
                                <div className="flex items-center gap-2">
                                    <button
                                        disabled={page === 1}
                                        onClick={() => setPage((p) => p - 1)}
                                        className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold disabled:opacity-40"
                                    >
                                        ←
                                    </button>
                                    <span className="text-sm font-bold text-slate-600">{page}/{totalPages}</span>
                                    <button
                                        disabled={page >= totalPages}
                                        onClick={() => setPage((p) => p + 1)}
                                        className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold disabled:opacity-40"
                                    >
                                        →
                                    </button>
                                </div>
                            </div>

                            <div className="h-full overflow-y-auto p-4 pb-20">
                                {loading ? (
                                    <div className="rounded-2xl border border-dashed border-slate-300 p-6 text-sm text-slate-500">載入中...</div>
                                ) : filteredLogs.length === 0 ? (
                                    <div className="rounded-2xl border border-dashed border-slate-300 p-6 text-sm text-slate-500">目前沒有評估資料。</div>
                                ) : (
                                    <div className="grid grid-cols-1 gap-3 2xl:grid-cols-2">
                                        {pagedLogs.map((log) => (
                                            <button
                                                key={log.eval_id}
                                                onClick={() => selectLog(log)}
                                                className={`group rounded-3xl border p-4 text-left transition hover:-translate-y-0.5 hover:shadow-lg ${activeLog?.eval_id === log.eval_id && !selectedGap
                                                    ? 'border-slate-900 bg-slate-50 shadow-md'
                                                    : 'border-slate-200 bg-white'
                                                    }`}
                                            >
                                                <div className="mb-3 flex items-center justify-between gap-2">
                                                    <div className="flex items-center gap-2">
                                                        <span className={`h-2.5 w-2.5 rounded-full ${scoreDotClass(getFaithfulnessScore(log))}`} />
                                                        <span className="text-xs font-black text-slate-500">Eval #{log.eval_id}</span>
                                                    </div>
                                                    <span className={`rounded-full border px-3 py-1 text-xs font-black ${scoreClass(getFaithfulnessScore(log))}`}>
                                                        {(getFaithfulnessScore(log) * 100).toFixed(1)}%
                                                    </span>
                                                </div>

                                                <div className="line-clamp-2 min-h-[2.5rem] text-sm font-black leading-5 text-slate-900">
                                                    {log.question}
                                                </div>

                                                <div className="mt-4 grid grid-cols-4 gap-2 text-xs">
                                                    <div className="rounded-2xl bg-slate-50 p-2">
                                                        <div className="text-slate-400">Claims</div>
                                                        <div className="font-black text-slate-700">{log.supported_claims}/{log.total_claims}</div>
                                                    </div>
                                                    <div className="rounded-2xl bg-slate-50 p-2">
                                                        <div className="text-slate-400">缺證據</div>
                                                        <div className="font-black text-rose-600">{getUnsupportedCount(log)}</div>
                                                    </div>
                                                    <div className="rounded-2xl bg-sky-50 p-2">
                                                        <div className="text-sky-400">安全提醒</div>
                                                        <div className="font-black text-sky-600">{getSafetyCount(log)}</div>
                                                    </div>
                                                    <div className="rounded-2xl bg-slate-50 p-2">
                                                        <div className="text-slate-400">模式</div>
                                                        <div className="truncate font-black text-slate-700">{log.rag_mode}</div>
                                                    </div>
                                                </div>

                                                <div className="mt-3 flex items-center justify-between text-xs text-slate-400">
                                                    <span className="truncate">{getSourceSummary(log)}</span>
                                                    <span>{formatTime(log.created_at)}</span>
                                                </div>
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    </section>

                    <aside className="min-h-0 overflow-hidden rounded-[2rem] border border-white/10 bg-white shadow-2xl shadow-slate-950/20">
                        {selectedGap ? (
                            <div className="flex h-full flex-col">
                                <div className="border-b border-slate-200 p-5">
                                    <div className="mb-3 flex items-center justify-between">
                                        <span className="rounded-full bg-orange-100 px-3 py-1 text-xs font-black text-orange-700">缺口修補流程</span>
                                        <button
                                            onClick={() => setSelectedGap(null)}
                                            className="rounded-full border border-slate-200 px-3 py-1 text-xs font-bold text-slate-500 hover:bg-slate-50"
                                        >
                                            關閉
                                        </button>
                                    </div>
                                    <h2 className="text-xl font-black text-slate-950">從缺口到入庫</h2>
                                    <div className="mt-3 grid grid-cols-5 gap-1 text-center text-[10px] font-black text-slate-500">
                                        {['缺口', '找資料', '草稿', '審查', '重測'].map((step, idx) => (
                                            <div
                                                key={step}
                                                className={`rounded-full px-2 py-1 ${idx === 0
                                                    ? 'bg-orange-100 text-orange-700'
                                                    : gapCandidates.length > 0
                                                        ? 'bg-emerald-100 text-emerald-700'
                                                        : 'bg-slate-100 text-slate-400'
                                                    }`}
                                            >
                                                {step}
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
                                    <div className="rounded-3xl border border-rose-100 bg-rose-50 p-4">
                                        <div className="mb-2 flex items-center justify-between">
                                            <div className="text-xs font-black text-rose-500">需要補強的 Claim</div>
                                            <span className="rounded-full bg-white px-2 py-1 text-[10px] font-black text-rose-600">Gap #{selectedGap.gap_id}</span>
                                        </div>
                                        <div className="text-sm font-bold leading-6 text-rose-950">{selectedGap.claim}</div>
                                    </div>

                                    <div className="grid grid-cols-1 gap-3">
                                        <div className="rounded-3xl bg-slate-50 p-4">
                                            <div className="mb-1 text-xs font-black text-slate-400">原始問題</div>
                                            <div className="text-sm font-semibold text-slate-800">{selectedGap.question}</div>
                                        </div>

                                        <div className="rounded-3xl border border-orange-100 bg-orange-50 p-4">
                                            <div className="mb-1 text-xs font-black text-orange-500">系統應該自動拿去查的關鍵字</div>
                                            <div className="text-sm font-black leading-6 text-orange-950">{selectedGap.suggested_query || selectedGap.claim}</div>
                                        </div>
                                    </div>

                                    <div className="rounded-[1.75rem] border border-slate-200 bg-white p-5">
                                        <div className="mb-4 flex items-center justify-between gap-3">
                                            <div>
                                                <div className="text-sm font-black text-slate-950">候選教材審查</div>
                                                <div className="mt-1 text-xs font-bold text-slate-400">
                                                    系統找到的資料要先審查，通過後才會寫入教材庫並嘗試進入向量資料庫。
                                                </div>
                                            </div>
                                            {loadingCandidates && (
                                                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-500">
                                                    載入中
                                                </span>
                                            )}
                                        </div>

                                        {gapCandidates.length === 0 ? (
                                            <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4">
                                                <div className="text-sm font-black text-slate-800">目前沒有候選教材</div>
                                                <div className="mt-1 text-xs font-bold leading-5 text-slate-500">
                                                    請先按「準備教材」，系統會用上方查詢詞去找可補證據的資料。
                                                </div>
                                                <button
                                                    onClick={() => prepareGapMaterial(selectedGap)}
                                                    disabled={gapBusyId === selectedGap.gap_id}
                                                    className="mt-4 w-full rounded-2xl bg-orange-500 px-4 py-3 text-sm font-black text-white hover:bg-orange-600 disabled:opacity-50"
                                                >
                                                    {gapBusyId === selectedGap.gap_id ? '準備中...' : '準備教材'}
                                                </button>
                                            </div>
                                        ) : (
                                            <div className="space-y-3">
                                                {gapCandidates.map((candidate) => (
                                                    <article
                                                        key={candidate.candidate_id}
                                                        className="rounded-2xl border border-slate-200 bg-slate-50 p-4"
                                                    >
                                                        <div className="mb-2 flex items-center justify-between gap-2">
                                                            <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-black text-emerald-700">
                                                                {candidate.source_type || 'source'}
                                                            </span>
                                                            <span className="rounded-full bg-slate-200 px-2.5 py-1 text-[11px] font-black text-slate-700">
                                                                Score {Number(candidate.score || 0).toFixed(2)}
                                                            </span>
                                                        </div>

                                                        <div className="text-sm font-black leading-5 text-slate-950">
                                                            {candidate.title}
                                                        </div>

                                                        <div className="mt-3 max-h-32 overflow-y-auto rounded-xl bg-white p-3 text-xs font-semibold leading-5 text-slate-600">
                                                            {candidate.summary || '沒有摘要內容'}
                                                        </div>

                                                        <div className="mt-3 grid grid-cols-2 gap-2">
                                                            {candidate.url ? (
                                                                <a
                                                                    href={candidate.url}
                                                                    target="_blank"
                                                                    rel="noreferrer"
                                                                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-center text-xs font-black text-slate-700 hover:bg-slate-100"
                                                                >
                                                                    開啟來源
                                                                </a>
                                                            ) : (
                                                                <button
                                                                    disabled
                                                                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-300"
                                                                >
                                                                    無來源
                                                                </button>
                                                            )}

                                                            <button
                                                                onClick={() => approveCandidate(candidate.candidate_id)}
                                                                disabled={approvingCandidateId === candidate.candidate_id}
                                                                className="rounded-xl bg-slate-950 px-3 py-2 text-xs font-black text-white hover:bg-slate-700 disabled:opacity-50"
                                                            >
                                                                {approvingCandidateId === candidate.candidate_id ? '匯入中...' : '審查匯入'}
                                                            </button>
                                                        </div>
                                                    </article>
                                                ))}
                                            </div>
                                        )}
                                    </div>

                                    {gapActionMessage && (
                                        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm font-bold text-slate-600">
                                            {gapActionMessage}
                                        </div>
                                    )}
                                </div>

                                <div className="grid grid-cols-2 gap-3 border-t border-slate-200 p-5">
                                    <button
                                        onClick={() => prepareGapMaterial(selectedGap)}
                                        disabled={gapBusyId === selectedGap.gap_id}
                                        className="rounded-2xl bg-orange-500 px-3 py-3 text-sm font-black text-white hover:bg-orange-600 disabled:opacity-50"
                                    >
                                        重新找資料
                                    </button>
                                    <button
                                        onClick={() => recheckGap(selectedGap)}
                                        disabled={gapBusyId === selectedGap.gap_id}
                                        className="rounded-2xl bg-slate-950 px-3 py-3 text-sm font-black text-white hover:bg-slate-700 disabled:opacity-50"
                                    >
                                        重跑檢查
                                    </button>
                                </div>
                            </div>) : (
                            <div className="flex h-full flex-col">
                                <div className="border-b border-slate-200 p-5">
                                    <div className="mb-2 flex items-center justify-between">
                                        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-700">證據詳情</span>
                                        {activeLog && (
                                            <span className={`rounded-full border px-3 py-1 text-xs font-black ${scoreClass(getFaithfulnessScore(activeLog))}`}>
                                                {(getFaithfulnessScore(activeLog) * 100).toFixed(1)}%
                                            </span>
                                        )}
                                    </div>
                                    <h2 className="line-clamp-2 text-xl font-black text-slate-950">
                                        {activeLog ? activeLog.question : '尚未選擇評估'}
                                    </h2>
                                    {activeLog && (
                                        <div className="mt-3 flex flex-wrap gap-2 text-xs font-bold">
                                            <span className="rounded-full bg-slate-100 px-2 py-1 text-slate-600">Eval #{activeLog.eval_id}</span>
                                            <span className="rounded-full bg-slate-100 px-2 py-1 text-slate-600">{activeLog.rag_mode}</span>
                                            <span className="rounded-full bg-slate-100 px-2 py-1 text-slate-600">
                                                {activeLog.supported_claims}/{activeLog.total_claims} RAG claims
                                            </span>
                                            {getSafetyCount(activeLog) > 0 && (
                                                <span className="rounded-full bg-sky-100 px-2 py-1 text-sky-700">
                                                    {getSafetyCount(activeLog)} safety
                                                </span>
                                            )}
                                            {getRawTotalClaims(activeLog) !== activeLog.total_claims && (
                                                <span className="rounded-full bg-slate-100 px-2 py-1 text-slate-500">
                                                    raw {getRawTotalClaims(activeLog)}
                                                </span>
                                            )}
                                        </div>
                                    )}
                                </div>

                                {!activeLog ? (
                                    <div className="p-5">
                                        <div className="rounded-3xl border border-dashed border-slate-300 p-6 text-sm text-slate-500">目前沒有資料。</div>
                                    </div>
                                ) : !activeDetails.length ? (
                                    <div className="p-5">
                                        <div className="rounded-3xl border border-dashed border-slate-300 p-6 text-sm text-slate-500">
                                            沒有詳細 claim 資料，請確認後端有回傳 eval_json。
                                        </div>
                                    </div>
                                ) : (
                                    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-5">
                                        {activeDetails.map((d: any, idx: number) => (
                                            <article
                                                key={idx}
                                                className={`rounded-3xl border p-4 ${claimCardClass(d)}`}
                                            >
                                                <div className="mb-3 flex items-center justify-between gap-2">
                                                    <span className="text-sm font-black text-slate-900">Claim #{idx + 1}</span>

                                                    <div className="flex items-center gap-2">
                                                        <span className={`rounded-full px-3 py-1 text-xs font-black ${claimBadgeClass(d)}`}>
                                                            {claimBadgeLabel(d)}
                                                        </span>

                                                        {d.support_type && (
                                                            <span className="rounded-full bg-white/80 px-2 py-1 text-[11px] font-black text-slate-500">
                                                                {d.support_type}
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>

                                                <div className="space-y-3 text-sm">
                                                    <div>
                                                        <div className="mb-1 text-xs font-black text-slate-400">Claim</div>
                                                        <div className="font-semibold text-slate-900">{d.claim}</div>
                                                    </div>

                                                    <div className="rounded-2xl bg-white/90 p-3">
                                                        <div className="mb-1 text-xs font-black text-slate-400">Evidence</div>
                                                        <div className="text-slate-700">
                                                            {isSafetyClaim(d)
                                                                ? '一般安全衛教提醒，不納入 RAG Faithfulness 分母'
                                                                : d.evidence || '無可用證據'}
                                                        </div>
                                                    </div>

                                                    <div>
                                                        <div className="mb-1 text-xs font-black text-slate-400">Reason</div>
                                                        <div className="text-slate-700">{d.reason || '未提供'}</div>
                                                    </div>

                                                    <div className="rounded-2xl bg-white/90 p-3 text-xs font-semibold text-slate-500">
                                                        來源：{d.evidence_source?.title || '未提供'}
                                                        {d.evidence_source?.page ? `｜${d.evidence_source.page}` : ''}
                                                        {d.evidence_source?.source_type ? `｜${d.evidence_source.source_type}` : ''}
                                                    </div>
                                                </div>
                                            </article>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                    </aside>
                </section>
            </div>
        </main>
    );
}
