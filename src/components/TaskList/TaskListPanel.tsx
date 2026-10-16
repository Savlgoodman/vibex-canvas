import { useState } from 'react';
import { useStore } from '../../store/useStore';
import { useImageUrl } from '../../hooks/useImageUrl';
import { AlphaImage } from '../ui/AlphaImage';
import './TaskListPanel.css';

export function TaskListPanel() {
  const tasks = useStore((s) => s.tasks);
  const activeTaskId = useStore((s) => s.activeTaskId);
  const setActiveTask = useStore((s) => s.setActiveTask);
  const addTask = useStore((s) => s.addTask);
  const archiveTask = useStore((s) => s.archiveTask);
  const restoreTask = useStore((s) => s.restoreTask);
  const [showArchived, setShowArchived] = useState(false);
  const visible = tasks.filter((task) => !!task.archived === showArchived);
  const archivedCount = tasks.filter((task) => task.archived).length;

  return (
    <aside className="task-list-panel">
      <div className="task-list-header">
        <span className="task-list-title">{showArchived ? '归档' : '任务'}</span>
        <div className="task-list-actions">
          <button
            className={`task-archive-toggle ${showArchived ? 'active' : ''}`}
            onClick={() => setShowArchived((v) => !v)}
            title={showArchived ? '返回任务' : '查看归档'}
          >
            归档{archivedCount ? ` ${archivedCount}` : ''}
          </button>
          {!showArchived && (
        <button className="task-new-btn" onClick={() => addTask()} title="新建任务">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
          )}
        </div>
      </div>
      <div className="task-list-scroll">
        {visible.length === 0 && (
          <div className="task-list-empty">{showArchived ? '还没有归档' : '还没有任务'}</div>
        )}
        {visible.map((task) => (
          <TaskCard
            key={task.id}
            task={task}
            isActive={task.id === activeTaskId}
            onClick={() => setActiveTask(task.id)}
            onArchive={() => showArchived ? restoreTask(task.id) : archiveTask(task.id)}
            archived={showArchived}
          />
        ))}
      </div>
    </aside>
  );
}

function TaskCard({ task, isActive, onClick, onArchive, archived }: {
  task: { id: string; title: string; thumbnailUrl?: string; records: { status: string }[]; updatedAt: number };
  isActive: boolean;
  onClick: () => void;
  onArchive: () => void;
  archived: boolean;
}) {
  const imageUrl = useImageUrl(task.thumbnailUrl);
  const generating = task.records.some((r) => r.status === 'pending');

  return (
    <div
      className={`task-card ${isActive ? 'active' : ''}`}
      onClick={onClick}
    >
      <div className="task-card-thumb">
        {imageUrl ? (
          <AlphaImage src={imageUrl} alt="" small />
        ) : generating ? (
          <div className="task-card-loading" title="生成中">
            <div className="spinner" />
          </div>
        ) : (
          <div className="task-card-placeholder">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="3" y="3" width="18" height="18" rx="3" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <path d="M21 15l-5-5L5 21" />
            </svg>
          </div>
        )}
        {generating && imageUrl && (
          <div className="task-card-live" title="仍在生成">
            <div className="spinner" />
          </div>
        )}
      </div>
      <div className="task-card-info">
        <div className="task-card-title">{task.title || '未命名'}</div>
        <div className="task-card-meta">
          {task.records.length} 条记录
          <span className="task-card-dot" />
          {formatTime(task.updatedAt)}
        </div>
      </div>
      <button
        className="task-card-archive"
        onClick={(e) => { e.stopPropagation(); onArchive(); }}
        title={archived ? '恢复' : '归档'}
      >
        {archived ? '恢复' : (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 7h18" />
            <path d="M5 7l1 13h12l1-13" />
            <path d="M9 11h6" />
          </svg>
        )}
      </button>
    </div>
  );
}

function formatTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
  return `${Math.floor(diff / 86400000)} 天前`;
}
