import { useEffect, useState } from 'react';
import { useStore } from '../../store/useStore';
import { fetchModels, testConnection } from '../../services/api';
import { defaultModelCaps, resolveModelCaps } from '../../services/modelCaps';
import { RATE_LIMIT_BOUNDS } from '../../services/rateLimit';
import type { ModelCaps, ProtocolId, Provider } from '../../types';
import { PROTOCOL_LIST, protocolOf } from '../../protocols/registry';
import { ProtocolIcon } from '../ui/ProtocolIcon';
import { useBackdropDismiss } from '../ui/useBackdropDismiss';
import './SettingsModal.css';

type SettingsSection = 'general' | 'providers';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function SettingsModal({ open, onClose }: Props) {
  const providers = useStore((s) => s.providers);
  const deleteProvider = useStore((s) => s.deleteProvider);
  const setDefaultProvider = useStore((s) => s.setDefaultProvider);
  const [section, setSection] = useState<SettingsSection>('general');
  const [editingProvider, setEditingProvider] = useState<Provider | null>(null);
  const [showEditor, setShowEditor] = useState(false);

  const dismissSettings = useBackdropDismiss(onClose);
  if (!open) return null;

  const handleAdd = () => {
    setEditingProvider(null);
    setShowEditor(true);
  };

  const handleEdit = (p: Provider) => {
    setEditingProvider(p);
    setShowEditor(true);
  };

  const handleDelete = (id: string) => {
    deleteProvider(id);
  };

  const handleSetDefault = (id: string) => {
    setDefaultProvider(id);
  };

  return (
    <div className="settings-overlay" {...dismissSettings}>
      <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-modal-header">
          <h2 className="settings-modal-title">设置</h2>
          <button className="settings-modal-close" onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="settings-modal-body">
          <nav className="settings-nav" aria-label="设置分类">
            <button
              type="button"
              className={`settings-nav-item ${section === 'general' ? 'active' : ''}`}
              onClick={() => setSection('general')}
            >
              通用设置
            </button>
            <button
              type="button"
              className={`settings-nav-item ${section === 'providers' ? 'active' : ''}`}
              onClick={() => setSection('providers')}
            >
              供应商配置
            </button>
          </nav>
          <div className="settings-content">
            {section === 'general' ? <GeneralSettings /> : (
              <>
          <div className="settings-section-header">
            <span className="settings-section-title">供应商</span>
            <button className="settings-add-btn" onClick={handleAdd}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              添加供应商
            </button>
          </div>

          <div className="provider-list-modal">
            {providers.length === 0 && (
              <div className="provider-empty-modal">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
                  <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
                </svg>
                <p>还没有供应商</p>
                <span>添加供应商后即可开始生图</span>
              </div>
            )}
            {providers.map((p) => (
              <div key={p.id} className="provider-card">
                <div className="provider-card-header">
                  <div className="provider-card-name">
                    <ProtocolIcon protocol={protocolOf(p.protocol)} />
                    {p.isDefault && <span className="provider-badge">默认</span>}
                    {p.name}
                  </div>
                  <div className="provider-card-actions">
                    <button
                      className={`provider-action ${p.isDefault ? 'active' : ''}`}
                      onClick={() => handleSetDefault(p.id)}
                      title="设为默认"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill={p.isDefault ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
                        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                      </svg>
                    </button>
                    <button className="provider-action" onClick={() => handleEdit(p)} title="编辑">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                        <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                      </svg>
                    </button>
                    <button className="provider-action provider-action-delete" onClick={() => handleDelete(p.id)} title="删除">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                      </svg>
                    </button>
                  </div>
                </div>
                <div className="provider-card-body">
                  <div className="provider-card-row">
                    <span className="provider-card-label">地址</span>
                    <span className="provider-card-value">{p.baseUrl}</span>
                  </div>
                  <div className="provider-card-row">
                    <span className="provider-card-label">密钥</span>
                    <span className="provider-card-value provider-key">{p.apiKey ? '••••' + p.apiKey.slice(-4) : '—'}</span>
                  </div>
                  <div className="provider-card-row provider-card-row-tags">
                    <span className="provider-card-label">模型</span>
                    {p.models.length > 0 ? (
                      <div className="provider-model-tags">
                        {p.models.map((m) => {
                          const caps = resolveModelCaps(p, m);
                          return (
                            <span key={m} className="provider-model-tag">
                              {m}
                              {caps.transparent && <em>透明</em>}
                              {caps.extendedQuality && <em>高画质</em>}
                            </span>
                          );
                        })}
                      </div>
                    ) : (
                      <span className="provider-card-value">暂无模型</span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
              </>
            )}
          </div>
        </div>

        {showEditor && (
          <ProviderEditorModal
            provider={editingProvider}
            onClose={() => setShowEditor(false)}
          />
        )}
      </div>
    </div>
  );
}

function GeneralSettings() {
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);

  return (
    <div className="settings-general">
      <div className="settings-pref">
        <div>
          <div className="settings-pref-title">分段预览</div>
          <div className="settings-pref-desc">生成过程中最多展示 3 张过渡图</div>
        </div>
        <label className="settings-switch">
          <input
            type="checkbox"
            checked={settings.partialImages}
            onChange={(e) => updateSettings({ partialImages: e.target.checked })}
          />
          <span>{settings.partialImages ? '已开启' : '已关闭'}</span>
        </label>
      </div>

      <div className="settings-limit">
        <div className="settings-pref-title">生图限流</div>
        <div className="settings-pref-desc">大批量生图时，所有任务共用这两个限制。图片会排队，等到空位再请求。</div>
        <div className="settings-limit-grid">
          <LimitField
            label="同时并发"
            desc="同一时刻最多有这么多张图在请求中"
            value={settings.maxConcurrent}
            min={RATE_LIMIT_BOUNDS.concurrent.min}
            max={RATE_LIMIT_BOUNDS.concurrent.max}
            onCommit={(maxConcurrent) => updateSettings({ maxConcurrent })}
          />
          <LimitField
            label="每分钟张数"
            desc="任意连续 60 秒内最多开始这么多张图"
            value={settings.maxPerMinute}
            min={RATE_LIMIT_BOUNDS.perMinute.min}
            max={RATE_LIMIT_BOUNDS.perMinute.max}
            onCommit={(maxPerMinute) => updateSettings({ maxPerMinute })}
          />
        </div>
      </div>
    </div>
  );
}

function LimitField({ label, desc, value, min, max, onCommit }: {
  label: string;
  desc: string;
  value: number;
  min: number;
  max: number;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);

  const commit = (raw: string) => {
    const n = Math.round(Number(raw));
    onCommit(Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : value);
  };

  return (
    <label className="settings-limit-field">
      <span className="settings-limit-label">{label}</span>
      <input
        className="settings-number"
        type="number"
        min={min}
        max={max}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
      />
      <span className="settings-pref-desc">{desc}</span>
    </label>
  );
}

function ProviderEditorModal({ provider, onClose }: { provider: Provider | null; onClose: () => void }) {
  const addProvider = useStore((s) => s.addProvider);
  const updateProvider = useStore((s) => s.updateProvider);

  const [protocol, setProtocol] = useState<ProtocolId>(provider ? protocolOf(provider.protocol) : 'other');
  const [name, setName] = useState(provider?.name ?? '');
  const [baseUrl, setBaseUrl] = useState(provider?.baseUrl ?? '');
  const [apiKey, setApiKey] = useState(provider?.apiKey ?? '');
  const [models, setModels] = useState<string[]>(provider?.models ?? []);
  const [modelCaps, setModelCaps] = useState<Record<string, ModelCaps>>(() => {
    const init: Record<string, ModelCaps> = {};
    for (const name of provider?.models ?? []) {
      init[name] = provider?.modelCaps?.[name] ?? defaultModelCaps(name);
    }
    return init;
  });
  const [manualModel, setManualModel] = useState('');
  const [fetchedModels, setFetchedModels] = useState<string[]>([]);
  const [fetching, setFetching] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<'ok' | 'fail' | null>(null);
  const [saving, setSaving] = useState(false);

  const dismissEditor = useBackdropDismiss(onClose);
  const isEdit = !!provider;

  const handleTest = async () => {
    const temp: Provider = { id: provider?.id ?? 'temp', name, baseUrl, apiKey, models };
    setTesting(true);
    setTestResult(null);
    try {
      const ok = await testConnection(temp);
      setTestResult(ok ? 'ok' : 'fail');
    } catch {
      setTestResult('fail');
    } finally {
      setTesting(false);
    }
  };

  const handleFetchModels = async () => {
    const temp: Provider = { id: provider?.id ?? 'temp', name, baseUrl, apiKey, models };
    setFetching(true);
    try {
      const fetched = await fetchModels(temp);
      setFetchedModels(fetched);
    } catch {
      setFetchedModels([]);
    } finally {
      setFetching(false);
    }
  };

  const handleAddModel = (model: string) => {
    if (!model.trim() || models.includes(model.trim())) return;
    const name = model.trim();
    setModels([...models, name]);
    setModelCaps((prev) => ({ ...prev, [name]: prev[name] ?? defaultModelCaps(name) }));
    setManualModel('');
  };

  const handleRemoveModel = (model: string) => {
    setModels(models.filter((m) => m !== model));
    setModelCaps((prev) => {
      const next = { ...prev };
      delete next[model];
      return next;
    });
  };

  const setCap = (model: string, key: keyof ModelCaps, value: boolean) => {
    setModelCaps((prev) => ({
      ...prev,
      [model]: { ...(prev[model] ?? defaultModelCaps(model)), [key]: value },
    }));
  };

  const handleSave = async () => {
    if (!name.trim() || !baseUrl.trim()) return;
    setSaving(true);
    if (isEdit) {
      updateProvider(provider!.id, { name, baseUrl, apiKey, models, modelCaps, protocol });
    } else {
      addProvider({ name, baseUrl, apiKey, models, modelCaps, protocol });
    }
    setSaving(false);
    onClose();
  };

  return (
    <div className="editor-overlay" {...dismissEditor}>
      <div className="editor-modal" onClick={(e) => e.stopPropagation()}>
        <div className="editor-modal-header">
          <h3 className="editor-modal-title">{isEdit ? '编辑供应商' : '添加供应商'}</h3>
          <button className="editor-modal-close" onClick={onClose}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="editor-modal-body">
          <div className="editor-field">
            <span className="editor-field-label">协议</span>
            <div className="protocol-picks">
              {PROTOCOL_LIST.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`protocol-pick ${protocol === item.id ? 'active' : ''}`}
                  onClick={() => setProtocol(item.id)}
                >
                  <ProtocolIcon protocol={item.id} />
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          <label className="editor-field">
            <span className="editor-field-label">名称</span>
            <input
              className="editor-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如 OpenAI 官方"
            />
          </label>

          <label className="editor-field">
            <span className="editor-field-label">接口地址</span>
            <input
              className="editor-input"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.openai.com"
            />
          </label>

          <label className="editor-field">
            <span className="editor-field-label">密钥</span>
            <input
              className="editor-input"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-..."
            />
          </label>

          <div className="editor-actions-row">
            <button className="editor-btn editor-btn-secondary" onClick={handleTest} disabled={testing || !baseUrl}>
              {testing ? '测试中...' : '测试连接'}
            </button>
            {testResult === 'ok' && <span className="editor-status editor-status-ok">已连接</span>}
            {testResult === 'fail' && <span className="editor-status editor-status-fail">连接失败</span>}
          </div>

          <div className="editor-divider" />

          <div className="editor-field">
            <div className="editor-field-header">
              <span className="editor-field-label">模型</span>
              <button className="editor-fetch-btn" onClick={handleFetchModels} disabled={fetching || !baseUrl || !apiKey}>
                {fetching ? '获取中...' : '获取模型'}
              </button>
            </div>

            {models.length > 0 && (
              <div className="editor-model-list">
                {models.map((m) => (
                  <span key={m} className="editor-model-tag">
                    {m}
                    <button type="button" onClick={() => handleRemoveModel(m)} title="移除">
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  </span>
                ))}
              </div>
            )}

            {fetchedModels.length > 0 && (
              <div className="editor-fetched">
                <span className="editor-fetched-label">接口返回的模型：</span>
                <div className="editor-fetched-list">
                  {fetchedModels.map((m) => (
                    <button
                      key={m}
                      className={`editor-fetched-item ${models.includes(m) ? 'added' : ''}`}
                      onClick={() => handleAddModel(m)}
                      disabled={models.includes(m)}
                    >
                      {models.includes(m) ? '✓' : '+'} {m}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {protocol === 'gpt' && models.length > 0 && (
              <div className="model-cap-list">
                <span className="editor-fetched-label">模型能力</span>
                {models.map((m) => {
                  const caps = modelCaps[m] ?? defaultModelCaps(m);
                  return (
                    <div key={m} className="model-cap-row">
                      <span className="model-cap-name">{m}</span>
                      <label>
                        <input type="checkbox" checked={caps.transparent} onChange={(e) => setCap(m, 'transparent', e.target.checked)} />
                        透明背景
                      </label>
                      <label>
                        <input type="checkbox" checked={caps.extendedQuality} onChange={(e) => setCap(m, 'extendedQuality', e.target.checked)} />
                        更高质量
                      </label>
                    </div>
                  );
                })}
                <span className="model-cap-note">名称包含 sunburst 或 flare 时默认开启</span>
              </div>
            )}

            <div className="editor-manual">
              <input
                className="editor-input editor-input-sm"
                value={manualModel}
                onChange={(e) => setManualModel(e.target.value)}
                placeholder="输入模型名称后按回车添加"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAddModel(manualModel);
                }}
              />
            </div>
          </div>
        </div>

        <div className="editor-modal-footer">
          <button className="editor-btn editor-btn-ghost" onClick={onClose}>取消</button>
          <button className="editor-btn editor-btn-primary" onClick={handleSave} disabled={saving || !name.trim() || !baseUrl.trim()}>
            {saving ? '保存中...' : isEdit ? '保存修改' : '添加供应商'}
          </button>
        </div>
      </div>
    </div>
  );
}
