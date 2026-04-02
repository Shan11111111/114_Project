"use client";

import React, { useEffect, useMemo, useState } from "react";
import { getUser } from "../../lib/auth";

const API_BASE =
  process.env.NEXT_PUBLIC_BACKEND_URL || "http://127.0.0.1:8000";

type UserRow = {
  id?: number;
  user_id: string;
  username?: string;
  email?: string;
  roles?: string;
  states?: string;
  email_verified_at?: string | null;
};

const ROLE_OPTIONS = ["student", "teacher", "doctor", "assistant", "manager"];
const STATE_OPTIONS = ["pending", "active", "disabled"];

export default function AdminUsersPage() {
  const [meId, setMeId] = useState("");
  const [meRole, setMeRole] = useState("");
  const [ready, setReady] = useState(false);

  const [q, setQ] = useState("");
  const [rows, setRows] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const listUrl = useMemo(() => `${API_BASE}/auth/admin/users`, []);

  useEffect(() => {
    const syncAuth = () => {
      const user = getUser();
      const uid = user?.user_id ?? "";
      const role = String(user?.roles || "").toLowerCase();

      setMeId(uid);
      setMeRole(role);
      setReady(true);
    };

    syncAuth();
    window.addEventListener("auth-changed", syncAuth);
    return () => window.removeEventListener("auth-changed", syncAuth);
  }, []);

  const isManager = meRole === "manager";

  const fetchUsers = async () => {
    if (!meId || !isManager) return;

    setLoading(true);
    setErr(null);

    try {
      const url =
        `${listUrl}?requester_user_id=${encodeURIComponent(meId)}` +
        `&requester_role=${encodeURIComponent(meRole)}` +
        (q.trim() ? `&q=${encodeURIComponent(q.trim())}` : "");

      const res = await fetch(url, {
        method: "GET",
        credentials: "include",
        cache: "no-store",
      });

      const text = await res.text();
      if (!res.ok) throw new Error(text || `HTTP ${res.status}`);

      const data = JSON.parse(text);
      setRows(data.users || []);
      setErr(null);
    } catch (e: any) {
      setErr(e?.message ?? "載入失敗");
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (ready && isManager && meId) {
      fetchUsers();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, isManager, meId]);

  const onChangeField = (
    userId: string,
    field: "roles" | "states",
    value: string
  ) => {
    setRows((prev) =>
      prev.map((r) => (r.user_id === userId ? { ...r, [field]: value } : r))
    );
  };

  const onSave = async (row: UserRow) => {
    if (!isManager || !row.user_id) return;

    setSavingId(row.user_id);
    setErr(null);

    try {
      const res = await fetch(
        `${API_BASE}/auth/admin/users/${encodeURIComponent(row.user_id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            requester_user_id: meId,
            requester_role: meRole,
            role: row.roles,
            state: row.states,
          }),
        }
      );

      const text = await res.text();
      if (!res.ok) throw new Error(text || `HTTP ${res.status}`);

      await fetchUsers();
    } catch (e: any) {
      setErr(e?.message ?? "更新失敗");
    } finally {
      setSavingId(null);
    }
  };

  const onDelete = async (row: UserRow) => {
    if (!isManager || !row.user_id) return;

    const ok = window.confirm(
      `確定刪除帳號？\n\n${row.username || "(無名稱)"}\n${row.email || ""}`
    );
    if (!ok) return;

    setDeletingId(row.user_id);
    setErr(null);

    try {
      const res = await fetch(
        `${API_BASE}/auth/admin/users/${encodeURIComponent(row.user_id)}`,
        {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            requester_user_id: meId,
            requester_role: meRole,
          }),
        }
      );

      const text = await res.text();
      if (!res.ok) throw new Error(text || `HTTP ${res.status}`);

      await fetchUsers();
    } catch (e: any) {
      setErr(e?.message ?? "刪除失敗");
    } finally {
      setDeletingId(null);
    }
  };

  if (!ready) {
    return (
      <div style={pageWrap}>
        <div style={hintCard}>檢查登入狀態中...</div>
      </div>
    );
  }

  if (!meId) {
    return (
      <div style={pageWrap}>
        <div style={hintCard}>請先登入。</div>
      </div>
    );
  }

  if (!isManager) {
    return (
      <div style={pageWrap}>
        <div style={hintCard}>只有 manager 可以進入帳號管理頁。</div>
      </div>
    );
  }

  return (
    <div style={pageWrap}>
      <h1 style={titleStyle}>帳號管理</h1>

      <div style={panelStyle}>
        <div style={subInfoStyle}>
          目前登入者：{meId} / 身分：{meRole}
        </div>

        <div style={toolbarStyle}>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") fetchUsers();
            }}
            placeholder="搜尋(enter送出): 使用者名稱 / email / 使用者系統代號 / 身分 / 狀態"
            style={searchInputStyle}
          />

          <button
            onClick={fetchUsers}
            disabled={loading}
            style={{
              ...refreshBtnStyle,
              opacity: loading ? 0.7 : 1,
              cursor: loading ? "not-allowed" : "pointer",
            }}
          >
            {loading ? "載入中..." : "刷新"}
          </button>
        </div>

        {err && !loading && <div style={errorStyle}>{err}</div>}
      </div>

      <div style={tableWrapStyle}>
        <table style={tableStyle}>
          <thead style={theadStyle}>
            <tr>
              <th style={th}>內部代碼</th>
              <th style={th}>使用者系統代號</th>
              <th style={th}>使用者名稱</th>
              <th style={th}>Email</th>
              <th style={th}>身分</th>
              <th style={th}>狀態</th>
              <th style={th}>驗證狀態</th>
              <th style={th}>操作</th>
            </tr>
          </thead>

          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td style={emptyTd} colSpan={8}>
                  {loading ? "載入中..." : "目前沒有資料"}
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const isSelf = row.user_id === meId;

                return (
                  <tr key={row.user_id} style={rowStyle}>
                    <td style={td}>{row.id ?? ""}</td>
                    <td style={{ ...td, fontFamily: "monospace" }}>{row.user_id}</td>
                    <td style={td}>{row.username || ""}</td>
                    <td style={td}>{row.email || ""}</td>

                    <td style={td}>
                      <select
                        value={row.roles || "student"}
                        disabled={isSelf}
                        onChange={(e) =>
                          onChangeField(row.user_id, "roles", e.target.value)
                        }
                        style={{
                          ...selectStyle,
                          opacity: isSelf ? 0.55 : 1,
                          cursor: isSelf ? "not-allowed" : "pointer",
                        }}
                      >
                        {ROLE_OPTIONS.map((v) => (
                          <option key={v} value={v}>
                            {v}
                          </option>
                        ))}
                      </select>
                    </td>

                    <td style={td}>
                      <select
                        value={row.states || "pending"}
                        disabled={isSelf}
                        onChange={(e) =>
                          onChangeField(row.user_id, "states", e.target.value)
                        }
                        style={{
                          ...selectStyle,
                          opacity: isSelf ? 0.55 : 1,
                          cursor: isSelf ? "not-allowed" : "pointer",
                        }}
                      >
                        {STATE_OPTIONS.map((v) => (
                          <option key={v} value={v}>
                            {v}
                          </option>
                        ))}
                      </select>
                    </td>

                    <td style={td}>
                      {row.email_verified_at
                        ? String(row.email_verified_at).slice(0, 19).replace("T", " ")
                        : "未驗證"}
                    </td>

                    <td style={td}>
                      <div style={{ display: "flex", gap: 10 }}>
                        <button
                          onClick={() => onSave(row)}
                          disabled={isSelf || savingId === row.user_id}
                          title={isSelf ? "不可修改自己的帳號" : "儲存變更"}
                          style={{
                            ...saveBtnStyle,
                            opacity: isSelf || savingId === row.user_id ? 0.5 : 1,
                            cursor:
                              isSelf || savingId === row.user_id
                                ? "not-allowed"
                                : "pointer",
                          }}
                        >
                          {savingId === row.user_id ? "儲存中..." : "儲存"}
                        </button>

                        <button
                          onClick={() => onDelete(row)}
                          disabled={isSelf || deletingId === row.user_id}
                          title={isSelf ? "不可刪除自己的帳號" : "刪除此帳號"}
                          style={{
                            ...deleteBtnStyle,
                            opacity: isSelf || deletingId === row.user_id ? 0.5 : 1,
                            cursor:
                              isSelf || deletingId === row.user_id
                                ? "not-allowed"
                                : "pointer",
                          }}
                        >
                          {deletingId === row.user_id ? "刪除中..." : "刪除"}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const pageWrap: React.CSSProperties = {
  padding: "96px 24px 24px",
  maxWidth: 1280,
  margin: "0 auto",
  color: "var(--foreground, #e2e8f0)",
};

const titleStyle: React.CSSProperties = {
  fontSize: 24,
  fontWeight: 800,
  marginBottom: 14,
  color: "#dbeafe",
  letterSpacing: "0.02em",
};

const panelStyle: React.CSSProperties = {
  border: "1px solid rgba(125, 211, 252, 0.18)",
  borderRadius: 20,
  padding: 18,
  marginBottom: 18,
  background:
    "linear-gradient(135deg, rgba(15,23,42,.78) 0%, rgba(30,41,59,.72) 55%, rgba(17,24,39,.72) 100%)",
  boxShadow: "0 12px 30px rgba(15, 23, 42, 0.18)",
  backdropFilter: "blur(10px)",
};

const hintCard: React.CSSProperties = {
  border: "1px solid rgba(125, 211, 252, 0.18)",
  borderRadius: 20,
  padding: 20,
  background:
    "linear-gradient(135deg, rgba(15,23,42,.78) 0%, rgba(30,41,59,.72) 55%, rgba(17,24,39,.72) 100%)",
};

const subInfoStyle: React.CSSProperties = {
  fontSize: 12,
  color: "#94a3b8",
  marginBottom: 10,
};

const toolbarStyle: React.CSSProperties = {
  display: "flex",
  gap: 12,
  alignItems: "center",
};

const searchInputStyle: React.CSSProperties = {
  flex: 1,
  padding: "12px 14px",
  borderRadius: 14,
  border: "1px solid rgba(56, 189, 248, 0.22)",
  background: "rgba(15, 23, 42, 0.42)",
  color: "#e2e8f0",
  outline: "none",
  boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.02)",
};

const refreshBtnStyle: React.CSSProperties = {
  padding: "11px 16px",
  borderRadius: 14,
  border: "1px solid rgba(56, 189, 248, 0.26)",
  background: "rgba(34, 211, 238, 0.12)",
  color: "#cffafe",
  fontWeight: 700,
};

const errorStyle: React.CSSProperties = {
  marginTop: 12,
  color: "#fca5a5",
  whiteSpace: "pre-wrap",
  background: "rgba(127, 29, 29, 0.12)",
  border: "1px solid rgba(248, 113, 113, 0.18)",
  padding: "10px 12px",
  borderRadius: 12,
};

const tableWrapStyle: React.CSSProperties = {
  border: "1px solid rgba(125, 211, 252, 0.16)",
  borderRadius: 20,
  overflow: "auto",
  background:
    "linear-gradient(180deg, rgba(15,23,42,.74) 0%, rgba(30,41,59,.68) 100%)",
  boxShadow: "0 12px 30px rgba(15, 23, 42, 0.15)",
};

const tableStyle: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: 14,
  color: "#e5eefb",
};

const theadStyle: React.CSSProperties = {
  background: "rgba(56, 189, 248, 0.10)",
};

const rowStyle: React.CSSProperties = {
  borderTop: "1px solid rgba(125, 211, 252, 0.10)",
};

const th: React.CSSProperties = {
  textAlign: "left",
  padding: 14,
  whiteSpace: "nowrap",
  color: "#cbd5e1",
  fontWeight: 700,
};

const td: React.CSSProperties = {
  padding: 14,
  verticalAlign: "middle",
  color: "#dbe7f5",
};

const emptyTd: React.CSSProperties = {
  padding: 18,
  color: "#94a3b8",
  textAlign: "center",
};

const selectStyle: React.CSSProperties = {
  padding: "9px 12px",
  borderRadius: 12,
  border: "1px solid rgba(56, 189, 248, 0.22)",
  background: "rgba(15, 23, 42, 0.55)",
  color: "#e2e8f0",
  outline: "none",
};

const saveBtnStyle: React.CSSProperties = {
  padding: "9px 14px",
  borderRadius: 12,
  border: "1px solid rgba(34, 211, 238, 0.24)",
  background: "rgba(34, 211, 238, 0.14)",
  color: "#cffafe",
  fontWeight: 700,
};

const deleteBtnStyle: React.CSSProperties = {
  padding: "9px 14px",
  borderRadius: 12,
  border: "1px solid rgba(248, 113, 113, 0.22)",
  background: "rgba(127, 29, 29, 0.14)",
  color: "#fecaca",
  fontWeight: 700,
};