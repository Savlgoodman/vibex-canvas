import { useEffect, useMemo, useState } from 'react';
import type { AgentRecord } from '../../types';
import { DEFAULT_AGENT_GROUP } from '../../types';
import { useStore } from '../../store/useStore';
import { useImageState } from '../../hooks/useImageUrl';
import { AlphaImage } from '../ui/AlphaImage';
import './AgentRecordsPanel.css';

/** A group is folded once it holds more than one row of cards. */
const COLLAPSE_THRESHOLD = 3;

export function AgentRecordsPanel({ onBack }: { onBack: () => void }) {
  const groups = useStore((s) => s.agentRecords);
  const loaded = useStore((s) => s.agentRecordsLoaded);
  const loadAgentRecords = useStore((s) => s.loadAgentRecords);

  useEffect(() => { void loadAgentRecords(); }, [loadAgentRecords]);

  // Newest group first; the default bucket always last.
  const entries = useMemo(() => {
    return Object.entries(groups)
      .sort(([a, recordsA], [b, recordsB]) => {
        if (a === DEFAULT_AGENT_GROUP) return 1;
        if (b === DEFAULT_AGENT_GROUP) return -1;
        return latest(recordsB) - latest(recordsA);
      });
  }, [groups]);

  // Groups holding more than one row start folded; the rest expand on click.
  const [open, setOpen] = useState<Set<string>>(() => new Set(
    entries.filter(([, records]) => records.length <= COLLAPSE_THRESHOLD).map(([key]) => key),
  ));
  useEffect(() => {
    setOpen(new Set(
      entries.filter(([, records]) => records.length <= COLLAPSE_THRESHOLD).map(([key]) => key),
    ));
  }, [entries]);

  const total = entries.reduce((sum, [, records]) => sum + records.length, 0);

  return (
    <aside className="agent-panel">
      <div className="task-list-header">
        <span className="task-list-title">Agent 记录</span>
        <div className="task-list-actions">
          <span className="agent-panel-total">{total}</span>
          <button className="task-archive-toggle" onClick={onBack} title="返回任务">返回</button>
        </div>
      </div>

      <div className="task-list-scroll">
        {entries.length === 0 && (
          <div className="task-list-empty">
            {loaded ? '还没有 Agent 生成记录' : '正在加载…'}
          </div>
        )}

        {entries.map(([key, records]) => {
          const isOpen = open.has(key);
          return (
            <div className="agent-group" key={key}>
              <button
                className="agent-group-header"
                onClick={() => setOpen((prev) => {
                  const next = new Set(prev);
                  if (next.has(key)) next.delete(key); else next.add(key);
                  return next;
                })}
                title={key === DEFAULT_AGENT_GROUP ? undefined : key}
              >
                <svg
                  className={`agent-group-chevron ${isOpen ? 'open' : ''}`}
                  width="12" height="12" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="2"
                >
                  <polyline points="9 18 15 12 9 6" />
                </svg>
                {key === DEFAULT_AGENT_GROUP && (
                  <svg className="agent-group-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="9" />
                    <line x1="8" y1="12" x2="16" y2="12" />
                  </svg>
                )}
                <span className="agent-group-dir">{key === DEFAULT_AGENT_GROUP ? '未指定目录' : key}</span>
                <span className="agent-group-count">{records.length}</span>
              </button>

              {isOpen && (
                <div className="agent-group-body">
                  {records.map((record) => <AgentCard key={record.id} record={record} />)}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}

function AgentCard({ record }: { record: AgentRecord }) {
  const first = record.imagePaths?.[0];
  const { url, missing } = useImageState(first ? `file:${first}` : undefined);
  const count = record.imagePaths?.length ?? 0;

  return (
    <div className="agent-card">
      <div className="agent-card-thumb">
        {url ? (
          <>
            <AlphaImage src={url} alt="" small />
            {count > 1 && <span className="agent-card-count">{count}</span>}
          </>
        ) : missing ? (
          <div className="agent-card-missing" title="图片已丢失或删除">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="3" />
              <line x1="4" y1="4" x2="20" y2="20" />
            </svg>
          </div>
        ) : (
          <div className="agent-card-loading"><div className="spinner" /></div>
        )}
      </div>
      <div className="agent-card-info">
        <div className="agent-card-title" title={record.prompt}>{record.prompt || '无提示词'}</div>
        <div className="agent-card-meta">
          {record.model}
          <span className="task-card-dot" />
          {formatTime(record.createdAt)}
        </div>
      </div>
    </div>
  );
}

function latest(records: AgentRecord[]): number {
  return records[0]?.createdAt ?? 0;
}

function formatTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
  return `${Math.floor(diff / 86400000)} 天前`;
}
