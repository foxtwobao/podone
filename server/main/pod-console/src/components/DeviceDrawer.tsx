import { useState } from 'react';
import { Bell, Cpu, Trash2, Volume2, X } from 'lucide-react';
import { api, type PodDevice, type PodVoiceOption } from '../lib/api';
import { boardDisplayName, formatDateTime } from '../lib/format';
import { useToast } from './Toast';

interface DeviceDrawerProps {
  device: PodDevice;
  voices: PodVoiceOption[];
  defaultVoice: string;
  ttsModel: string;
  onClose: () => void;
  onUpdated: (updated: PodDevice) => void;
  onUnbound: (id: string) => void;
}

export function DeviceDrawer({
  device,
  voices,
  defaultVoice,
  ttsModel,
  onClose,
  onUpdated,
  onUnbound,
}: DeviceDrawerProps) {
  const { toast } = useToast();
  const [alias, setAlias] = useState(device.alias || '');
  const [customVoice, setCustomVoice] = useState(Boolean(device.ttsVoice));
  const [ttsVoice, setTtsVoice] = useState(device.ttsVoice || defaultVoice || voices[0]?.id || '');
  const [voiceQuery, setVoiceQuery] = useState('');
  const [allowIncomingCall, setAllowIncomingCall] = useState(device.allowIncomingCall);
  const [allowAsyncNotice, setAllowAsyncNotice] = useState(device.allowAsyncNotice);
  const [dndEnabled, setDndEnabled] = useState(device.dndEnabled);
  const [dndStart, setDndStart] = useState(device.dndStart || '23:00');
  const [dndEnd, setDndEnd] = useState(device.dndEnd || '08:00');
  const [autoUpdate, setAutoUpdate] = useState(device.autoUpdate);
  const [saving, setSaving] = useState(false);
  const [confirmUnbind, setConfirmUnbind] = useState(false);
  const [unbinding, setUnbinding] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      const updated = await api.updatePod(device.id, {
        alias: alias.trim(),
        ttsVoice: customVoice ? ttsVoice : '',
        allowIncomingCall,
        allowAsyncNotice,
        dndEnabled,
        dndStart,
        dndEnd,
        autoUpdate,
      });
      onUpdated(updated);
      toast('设备设置已保存', 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : '保存失败', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleUnbind = async () => {
    setUnbinding(true);
    try {
      await api.unbindPod(device.id);
      toast('设备已解绑', 'success');
      onUnbound(device.id);
    } catch (err) {
      toast(err instanceof Error ? err.message : '解绑失败', 'error');
    } finally {
      setUnbinding(false);
    }
  };

  const defaultVoiceLabel = voices.find((v) => v.id === defaultVoice)?.name || defaultVoice || '未配置';

  return (
    <div className="card p-5 border-[var(--primary)]/50 space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-base font-semibold m-0">
              {device.alias || boardDisplayName(device.board)} · 设备设置
            </h3>
            <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-[var(--surface-subtle)] border border-[var(--border)] text-[var(--fg-muted)]">
              {device.macAddress}
            </span>
          </div>
          <p className="text-xs text-[var(--fg-muted)] mt-1 mb-0">
            板型 {device.board || 'unknown'} · 绑定于 {formatDateTime(device.createDateTimestamp)}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1.5 rounded-lg hover:bg-[var(--surface-subtle)] text-[var(--fg-muted)] cursor-pointer"
          aria-label="关闭设置"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {device.needsReenrollment && (
        <div className="p-3 rounded-xl border border-amber-500/40 bg-amber-500/10 text-xs text-amber-700 dark:text-amber-300">
          该设备为历史绑定记录，缺少新版设备安全指纹（pairedClientHash）。请点击底部「解绑设备」，再通过设备屏幕上的激活码重新绑定。
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Identity & Voice */}
        <div className="card-subtle p-4 space-y-3.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-semibold">
              <Volume2 className="w-4 h-4 text-[var(--primary)]" />
              <span>名称与播报音色</span>
            </div>
            {ttsModel && (
              <span className="text-[11px] font-mono text-[var(--fg-muted)]">{ttsModel}</span>
            )}
          </div>

          <div className="space-y-1.5">
            <label className="text-xs text-[var(--fg-muted)] block">设备别名</label>
            <input
              type="text"
              maxLength={64}
              value={alias}
              onChange={(e) => setAlias(e.target.value)}
              placeholder="例如：书房桌面、卧室床头"
              className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--fg)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/40"
            />
          </div>

          <div className="flex items-center justify-between gap-3 pt-1">
            <div>
              <div className="text-xs font-medium">为这台 Pod 单独指定音色</div>
              <div className="text-[11px] text-[var(--fg-muted)]">
                关闭时跟随系统默认音色（{defaultVoiceLabel}）
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={customVoice}
              onClick={() => setCustomVoice((v) => !v)}
              className={`w-10 h-6 rounded-full p-0.5 transition-colors cursor-pointer shrink-0 ${
                customVoice ? 'bg-[var(--primary)]' : 'bg-[var(--border)]'
              }`}
            >
              <span
                className={`block w-5 h-5 rounded-full bg-white transition-transform ${
                  customVoice ? 'translate-x-4' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          {customVoice && (
            <div className="space-y-2">
              {voices.length > 0 ? (
                <>
                  {voices.length > 6 && (
                    <input
                      type="text"
                      value={voiceQuery}
                      onChange={(e) => setVoiceQuery(e.target.value)}
                      placeholder={`搜索 ${voices.length} 个内置音色…`}
                      className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-[var(--border)] bg-[var(--surface)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/40"
                    />
                  )}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-56 overflow-y-auto pr-0.5">
                    {voices
                      .filter((v) => {
                        const q = voiceQuery.trim().toLowerCase();
                        if (!q) return true;
                        return (
                          v.name.toLowerCase().includes(q) ||
                          v.id.toLowerCase().includes(q) ||
                          (v.desc || '').toLowerCase().includes(q)
                        );
                      })
                      .map((v) => {
                        const selected = ttsVoice === v.id;
                        const isDefault = v.id === defaultVoice;
                        return (
                          <button
                            key={v.id}
                            type="button"
                            onClick={() => setTtsVoice(v.id)}
                            className={`text-left px-3 py-2 rounded-lg border transition-colors cursor-pointer ${
                              selected
                                ? 'border-[var(--primary)] bg-[var(--primary)]/10'
                                : 'border-[var(--border)] bg-[var(--surface)] hover:border-[var(--fg-muted)]/40'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-1">
                              <span className="text-xs font-semibold truncate">{v.name}</span>
                              {isDefault && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--surface-subtle)] text-[var(--fg-muted)] shrink-0">
                                  默认
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-[var(--fg-muted)] truncate">
                              {v.desc || v.id}
                            </div>
                          </button>
                        );
                      })}
                  </div>
                </>
              ) : (
                <input
                  type="text"
                  maxLength={128}
                  value={ttsVoice}
                  onChange={(e) => setTtsVoice(e.target.value)}
                  placeholder="输入当前 TTS 模型支持的音色编码"
                  className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-[var(--border)] bg-[var(--surface)]"
                />
              )}
            </div>
          )}
        </div>

        {/* Notifications & Firmware */}
        <div className="space-y-4">
          <div className="card-subtle p-4 space-y-3">
            <div className="flex items-center gap-2 text-xs font-semibold">
              <Bell className="w-4 h-4 text-[var(--primary)]" />
              <span>来电与通知偏好</span>
            </div>

            <ToggleRow
              title="接收 Bot 主动来电"
              desc="允许 Botone call_user 在此设备响铃接听"
              checked={allowIncomingCall}
              onChange={setAllowIncomingCall}
            />
            <ToggleRow
              title="播报例行任务与异步结果"
              desc="关闭后结果仅保留在 Botone 对话记录"
              checked={allowAsyncNotice}
              onChange={setAllowAsyncNotice}
            />
            <ToggleRow
              title="夜间免打扰时段"
              desc="时段内不响铃、不主动播报通知"
              checked={dndEnabled}
              onChange={setDndEnabled}
            />
            {dndEnabled && (
              <div className="flex items-center gap-2 pt-1">
                <input
                  type="time"
                  value={dndStart}
                  onChange={(e) => setDndStart(e.target.value)}
                  className="px-2.5 py-1.5 text-xs font-mono rounded-lg border border-[var(--border)] bg-[var(--surface)]"
                />
                <span className="text-xs text-[var(--fg-muted)]">至</span>
                <input
                  type="time"
                  value={dndEnd}
                  onChange={(e) => setDndEnd(e.target.value)}
                  className="px-2.5 py-1.5 text-xs font-mono rounded-lg border border-[var(--border)] bg-[var(--surface)]"
                />
              </div>
            )}
          </div>

          <div className="card-subtle p-4 space-y-3">
            <div className="flex items-center gap-2 text-xs font-semibold">
              <Cpu className="w-4 h-4 text-[var(--primary)]" />
              <span>固件与安全</span>
            </div>
            <ToggleRow
              title="自动固件更新（OTA）"
              desc={`当前 v${device.appVersion || '-'}${device.latestVersion ? ` · 最新 v${device.latestVersion}` : ''}`}
              checked={autoUpdate}
              onChange={setAutoUpdate}
            />
          </div>
        </div>
      </div>

      {/* Footer actions */}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-[var(--border)]">
        <div>
          {!confirmUnbind ? (
            <button
              type="button"
              onClick={() => setConfirmUnbind(true)}
              className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-red-500/35 bg-red-500/10 text-red-600 dark:text-red-400 hover:bg-red-500/15 cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>解绑设备</span>
            </button>
          ) : (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-red-600 dark:text-red-400">
                解绑会断开连接，但不影响 Botone 中的「波波」和历史记录，确认？
              </span>
              <button
                type="button"
                disabled={unbinding}
                onClick={handleUnbind}
                className="text-xs font-medium px-3 py-1.5 rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 cursor-pointer"
              >
                {unbinding ? '解绑中…' : '确认解绑'}
              </button>
              <button
                type="button"
                onClick={() => setConfirmUnbind(false)}
                className="text-xs px-2.5 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] cursor-pointer"
              >
                取消
              </button>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            className="text-xs font-medium px-3.5 py-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--surface-subtle)] cursor-pointer"
          >
            取消
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={handleSave}
            className="text-xs font-medium px-4 py-2 rounded-lg bg-[var(--primary)] text-[var(--primary-fg)] hover:opacity-95 disabled:opacity-50 cursor-pointer"
          >
            {saving ? '保存中…' : '保存设置'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ToggleRow({
  title,
  desc,
  checked,
  onChange,
}: {
  title: string;
  desc: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="text-xs font-medium">{title}</div>
        <div className="text-[11px] text-[var(--fg-muted)]">{desc}</div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`w-10 h-6 rounded-full p-0.5 transition-colors cursor-pointer shrink-0 ${
          checked ? 'bg-[var(--primary)]' : 'bg-[var(--border)]'
        }`}
      >
        <span
          className={`block w-5 h-5 rounded-full bg-white transition-transform ${
            checked ? 'translate-x-4' : 'translate-x-0'
          }`}
        />
      </button>
    </div>
  );
}
