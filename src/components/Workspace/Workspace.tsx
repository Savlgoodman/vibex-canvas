import { useState, useMemo, useCallback } from 'react';
import { useStore } from '../../store/useStore';
import { recordImages, recordReferenceImages } from '../../types';
import { ParamsPanel } from './ParamsPanel';
import { OutputPanel } from './OutputPanel';
import './Workspace.css';

export function Workspace() {
  const tasks = useStore((s) => s.tasks);
  const activeTaskId = useStore((s) => s.activeTaskId);
  const activeAgentRecordId = useStore((s) => s.activeAgentRecordId);
  const findAgentRecord = useStore((s) => s.findAgentRecord);
  const updateTaskMeta = useStore((s) => s.updateTaskMeta);
  const partialPreviews = useStore((s) => s.partialPreviews);
  const task = tasks.find((t) => t.id === activeTaskId);
  const agentRecord = activeAgentRecordId ? findAgentRecord(activeAgentRecordId) : null;
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null);
  const [promptOverride, setPromptOverride] = useState<string | undefined>(undefined);
  const [refAppend, setRefAppend] = useState<{ n: number; url: string } | null>(null);
  const [viewKey, setViewKey] = useState<string | null>(activeTaskId ?? activeAgentRecordId);

  // Reset before children render, so switching views does not inherit the form.
  const viewNow = agentRecord ? `agent:${agentRecord.id}` : activeTaskId ?? null;
  if (viewKey !== viewNow) {
    setViewKey(viewNow);
    setSelectedRecordId(null);
    setPromptOverride(undefined);
    setRefAppend(null);
  }

  const currentRecord = useMemo(() => {
    if (!task) return null;
    if (selectedRecordId) {
      const found = task.records.find((r) => r.id === selectedRecordId);
      if (found) return found;
    }
    return task.records[0] ?? null;
  }, [task, selectedRecordId]);

  const handleRecordCreated = useCallback((recordId: string) => {
    setSelectedRecordId(recordId);
    setPromptOverride(undefined);
  }, []);

  const handleAddToReference = useCallback((imageUrl: string) => {
    setRefAppend({ n: Date.now(), url: imageUrl });
    setPromptOverride('');
  }, []);

  // --- Agent record view ---
  if (agentRecord) {
    const images = recordImages(agentRecord);
    const refs = recordReferenceImages(agentRecord);
    return (
      <main className="workspace" key={viewKey}>
        <div className="workspace-params">
          <ParamsPanel
            key={agentRecord.id}
            initialPrompt={agentRecord.prompt}
            initialReferenceImages={refs}
            initialMask={agentRecord.maskImage}
            refAppend={null}
            onRecordCreated={() => {}}
          />
        </div>
        <div className="workspace-output">
          <OutputPanel
            imageMarkers={images}
            currentError={undefined}
            generating={false}
            pendingCount={undefined}
            partialUrl={undefined}
            onSelectRecord={() => {}}
            selectedRecordId={agentRecord.id}
            onAddToReference={handleAddToReference}
            referenceMarker={refs.length === 1 ? refs[0] : undefined}
          />
        </div>
      </main>
    );
  }

  if (!task) {
    return (
      <div className="workspace workspace-empty">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
          <rect x="3" y="3" width="18" height="18" rx="3" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <path d="M21 15l-5-5L5 21" />
        </svg>
        <p>选择或创建一个任务</p>
      </div>
    );
  }

  const handleSelectRecord = (recordId: string) => {
    setSelectedRecordId(recordId);
    const record = task.records.find((r) => r.id === recordId);
    if (record) {
      updateTaskMeta(task.id, {
        providerId: record.providerId,
        model: record.model,
        size: record.size,
        quality: record.quality,
        outputFormat: record.outputFormat,
        background: record.background,
        outputCompression: record.outputCompression,
        imageCount: record.count ?? (recordImages(record).length || 1),
        protocolOptions: record.protocolOptions,
      });
      setPromptOverride(record.prompt);
    }
  };

  const initialPrompt = promptOverride ?? currentRecord?.prompt ?? '';
  const initialReferenceImages = currentRecord ? recordReferenceImages(currentRecord) : [];
  const initialMask = currentRecord?.maskImage;

  return (
    <main className="workspace" key={activeTaskId}>
      <div className="workspace-params">
        <ParamsPanel
          key={activeTaskId}
          initialPrompt={initialPrompt}
          initialReferenceImages={initialReferenceImages}
          initialMask={initialMask}
          refAppend={refAppend}
          onRecordCreated={handleRecordCreated}
        />
      </div>
      <div className="workspace-output">
        <OutputPanel
          imageMarkers={
            currentRecord?.status === 'pending'
              ? Array.from({ length: Math.min(9, Math.max(1, currentRecord.count ?? 1)) }, (_, i) => currentRecord.imageUrls?.[i] || '')
              : currentRecord?.status === 'success'
                ? recordImages(currentRecord)
                : []
          }
          currentError={currentRecord?.status === 'failed' ? currentRecord.error : undefined}
          generating={currentRecord?.status === 'pending'}
          pendingCount={currentRecord?.status === 'pending' ? currentRecord.count ?? 1 : undefined}
          partialUrl={currentRecord ? partialPreviews[currentRecord.id] : undefined}
          onSelectRecord={handleSelectRecord}
          selectedRecordId={currentRecord?.id ?? null}
          onAddToReference={handleAddToReference}
          referenceMarker={
            currentRecord?.status === 'success' && recordReferenceImages(currentRecord).length === 1
              ? recordReferenceImages(currentRecord)[0]
              : undefined
          }
        />
      </div>
    </main>
  );
}
