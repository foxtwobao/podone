import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, ExternalLink, Plus, RefreshCw, SlidersHorizontal } from 'lucide-react';
import { api, type PodDevice, type PodLiveState, type PodOverview } from '../lib/api';
import { useAuth } from '../lib/auth';
import { boardDisplayName, formatRelativeTime } from '../lib/format';
import { AppShell } from '../components/AppShell';
import { DeviceDrawer } from '../components/DeviceDrawer';
import { PodDial } from '../components/PodDial';
import { useToast } from '../components/Toast';

export function MyPodsPage() {
  const { isAdmin } = useAuth();
  const { toast } = useToast();
  const [overview, setOverview] = useState<PodOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    try {
      const data = await api.getPodOverview();
      setOverview(data);
    } catch (err) {
      toast(err instanceof Error ? err.message : '加载设备失败', 'error');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const devices = overview?.devices ?? [];
  const voices = overview?.voices ?? [];
  const defaultVoice = overview?.voiceConfig.defaultVoice ?? '';
  const botoneUrl = overview?.botoneUrl ?? '';
  const readiness = overview?.readiness ?? null;
  const legacyCount = devices.filter((d) => d.needsReenrollment).length;
  const onlineCount = overview?.onlineCount ?? devices.filter((d) => d.online).length;
  const selectedDevice = devices.find((d) => d.id === selectedId) ?? null;

  const voiceLabel = (code: string) => {
    if (!code) {
      const def = voices.find((v) => v.id === defaultVoice)?.name || defaultVoice || '未设置';
      return `跟随默认 (${def})`;
    }
    return voices.find((v) => v.id === code)?.name || code;
  };

  const handleUpdated = (updated: PodDevice) => {
    setOverview((prev) =>
      prev
        ? { ...prev, devices: prev.devices.map((d) => (d.id === updated.id ? updated : d)) }
        : prev,
    );
  };

  const handleUnbound = (id: string) => {
    setSelectedId(null);
    setOverview((prev) =>
      prev ? { ...prev, devices: prev.devices.filter((d) => d.id !== id) } : prev,
    );
  };

  const banner = resolveReadinessBanner({
    overview,
    legacyCount,
    botoneUrl,
  });

  const botoneBoboLink =
    botoneUrl && readiness?.boboBotId ? `${botoneUrl}/bots/${readiness.boboBotId}` : botoneUrl;

  const tokenStatusPill = (): { dot: 'ok' | 'warn' | 'err' | 'muted'; val: string } => {
    if (!readiness) return { dot: 'muted', val: '未探测' };
    switch (readiness.authStatus) {
      case 'ready':
        return { dot: 'ok', val: '已授权' };
      case 'authorization_required':
        return { dot: 'warn', val: '待授权' };
      case 'quota_exhausted':
        return { dot: 'err', val: '额度耗尽' };
      case 'model_connection_required':
        return { dot: 'warn', val: '模型连接异常' };
      case 'account_required':
        return { dot: 'warn', val: '需登录 Botone' };
      default:
        return { dot: 'muted', val: '暂不可用' };
    }
  };

  const tokenPill = tokenStatusPill();

  return (
    <AppShell botoneUrl={botoneUrl}>
      <div className="space-y-5">
        {/* Readiness & Botone companion card */}
        <section
          className={`card p-4 sm:p-5 space-y-4 ${
            banner.tone === 'danger'
              ? 'border-red-500/45 bg-red-500/[0.04]'
              : banner.tone === 'warn'
                ? 'border-amber-500/45 bg-amber-500/[0.04]'
                : ''
          }`}
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1 flex-1 min-w-[240px]">
              <div className="flex items-center gap-2 text-sm font-semibold">
                {banner.tone === 'ok' ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                ) : (
                  <AlertTriangle
                    className={`w-4 h-4 shrink-0 ${
                      banner.tone === 'danger' ? 'text-red-500' : 'text-amber-500'
                    }`}
                  />
                )}
                <span>{banner.title}</span>
              </div>
              <p className="text-xs text-[var(--fg-muted)] m-0 leading-relaxed">{banner.desc}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {banner.ctaUrl && banner.ctaLabel && (
                <a
                  href={banner.ctaUrl}
                  target="_blank"
                  rel="noreferrer"
                  className={`inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg no-underline ${
                    banner.tone === 'danger'
                      ? 'bg-red-600 text-white'
                      : 'bg-[var(--primary)] text-[var(--primary-fg)]'
                  }`}
                >
                  <span>{banner.ctaLabel}</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              )}
              {overview && !overview.voiceConfigured && isAdmin && (
                <Link
                  to="/admin"
                  className="text-xs font-medium px-3 py-1.5 rounded-lg bg-[var(--primary)] text-[var(--primary-fg)] no-underline"
                >
                  前往配置语音模型
                </Link>
              )}
              <button
                type="button"
                disabled={refreshing}
                onClick={() => void load(true)}
                className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--surface-subtle)] cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
                <span>刷新体检</span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <StatusPill dot="ok" label="IDONE" value="已登录" />
            <StatusPill
              dot={
                readiness
                  ? readiness.accountReady
                    ? 'ok'
                    : 'warn'
                  : 'muted'
              }
              label="Botone 波波"
              value={
                readiness
                  ? readiness.boboReady
                    ? '已就绪'
                    : readiness.accountReady
                      ? '首次对话初始化'
                      : '未建账号'
                  : '待检测'
              }
            />
            <StatusPill dot={tokenPill.dot} label="TokenONE" value={tokenPill.val} />
            <StatusPill
              dot={onlineCount > 0 ? 'ok' : 'muted'}
              label="Pod 在线"
              value={`${onlineCount}/${devices.length}`}
            />
          </div>

          {botoneUrl && (
            <div className="flex items-center flex-wrap gap-2 pt-3 border-t border-[var(--border)] text-xs">
              <span className="text-[var(--fg-muted)]">大脑与对话管理（Botone）：</span>
              <a
                href={botoneBoboLink}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg hover:bg-[var(--surface-subtle)] text-[var(--fg)] no-underline"
              >
                编辑波波指令 <ExternalLink className="w-3 h-3 text-[var(--fg-muted)]" />
              </a>
              <a
                href={botoneUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg hover:bg-[var(--surface-subtle)] text-[var(--fg)] no-underline"
              >
                对话记录与任务 <ExternalLink className="w-3 h-3 text-[var(--fg-muted)]" />
              </a>
              <a
                href={botoneUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg hover:bg-[var(--surface-subtle)] text-[var(--fg)] no-underline"
              >
                模型授权与审批 <ExternalLink className="w-3 h-3 text-[var(--fg-muted)]" />
              </a>
            </div>
          )}
        </section>

        {/* Device Grid Header */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold m-0">我的 Pod</h2>
            <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--surface-subtle)] border border-[var(--border)] text-[var(--fg-muted)]">
              {devices.length} 台
            </span>
          </div>
          <Link
            to="/bind"
            className="inline-flex items-center gap-1.5 text-xs font-medium px-3.5 py-2 rounded-xl bg-[var(--primary)] text-[var(--primary-fg)] hover:opacity-95 no-underline"
          >
            <Plus className="w-4 h-4" />
            <span>绑定新 Pod</span>
          </Link>
        </div>

        {/* Loading / Empty / Cards */}
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            {[1, 2].map((i) => (
              <div key={i} className="card p-5 h-40 animate-pulse bg-[var(--surface)]" />
            ))}
          </div>
        ) : devices.length === 0 ? (
          <div className="card p-8 sm:p-10 text-center space-y-4">
            <div className="flex justify-center">
              <PodDial size="lg" mood="curious" />
            </div>
            <div className="space-y-1">
              <h3 className="text-base font-semibold m-0">还没有绑定任何 Pod</h3>
              <p className="text-xs text-[var(--fg-muted)] max-w-md mx-auto m-0">
                插电联网后，打开设备圆屏上显示的绑定链接，或点击下方按钮输入 6 位激活码即可直接归属到你的账号，无需再手动创建智能体。
              </p>
            </div>
            <Link
              to="/bind"
              className="inline-flex items-center gap-1.5 text-xs font-medium px-4 py-2.5 rounded-xl bg-[var(--primary)] text-[var(--primary-fg)] no-underline"
            >
              <Plus className="w-4 h-4" />
              <span>立即输入激活码绑定</span>
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            {devices.map((pod) => {
              const selected = selectedId === pod.id;
              const dialMood = pod.needsReenrollment
                ? 'warn'
                : pod.liveState === 'speaking' || pod.liveState === 'calling'
                  ? 'speaking'
                  : pod.online
                    ? 'idle'
                    : 'offline';
              return (
                <div
                  key={pod.id}
                  className={`card p-4 flex flex-col gap-3.5 transition-colors ${
                    selected ? 'border-[var(--primary)] ring-1 ring-[var(--primary)]' : ''
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <PodDial mood={dialMood} size="md" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm truncate">
                          {pod.alias || boardDisplayName(pod.board)}
                        </span>
                        {pod.needsReenrollment ? (
                          <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30">
                            需重新登记
                          </span>
                        ) : (
                          <LiveBadge
                            state={pod.liveState}
                            lastConnectedAt={pod.lastConnectedAtTimestamp}
                          />
                        )}
                      </div>
                      <div className="text-[11.5px] text-[var(--fg-muted)] mt-0.5 flex items-center gap-1.5 flex-wrap">
                        <span className="font-mono">{pod.board || 'unknown'}</span>
                        <span>·</span>
                        <span>v{pod.appVersion || '-'}</span>
                        {pod.hasUpdate && (
                          <span className="text-[var(--primary)] font-medium">
                            (可升 v{pod.latestVersion})
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 px-3 py-2 rounded-xl bg-[var(--surface-subtle)] text-[11.5px]">
                    <div className="truncate">
                      <span className="text-[var(--fg-muted)]">音色：</span>
                      <span className="font-medium">{voiceLabel(pod.ttsVoice)}</span>
                    </div>
                    <div className="truncate">
                      <span className="text-[var(--fg-muted)]">来电/通知：</span>
                      <span className="font-medium">
                        {pod.dndEnabled
                          ? `免打扰 ${pod.dndStart}–${pod.dndEnd}`
                          : pod.allowIncomingCall
                            ? '允许来电'
                            : '仅通知'}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-2 mt-auto">
                    <span className="text-[11px] font-mono text-[var(--fg-muted)]">
                      {pod.macAddress}
                    </span>
                    <button
                      type="button"
                      onClick={() => setSelectedId(selected ? null : pod.id)}
                      className={`inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border cursor-pointer transition-colors ${
                        selected
                          ? 'bg-[var(--primary)] text-[var(--primary-fg)] border-[var(--primary)]'
                          : 'border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--surface-subtle)]'
                      }`}
                    >
                      <SlidersHorizontal className="w-3.5 h-3.5" />
                      <span>{selected ? '收起设置' : '设备设置'}</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Selected Device Drawer */}
        {selectedDevice && overview && (
          <DeviceDrawer
            key={selectedDevice.id}
            device={selectedDevice}
            voices={voices}
            defaultVoice={defaultVoice}
            ttsModel={overview.voiceConfig.ttsModel}
            onClose={() => setSelectedId(null)}
            onUpdated={handleUpdated}
            onUnbound={handleUnbound}
          />
        )}
      </div>
    </AppShell>
  );
}

function resolveReadinessBanner({
  overview,
  legacyCount,
  botoneUrl,
}: {
  overview: PodOverview | null;
  legacyCount: number;
  botoneUrl: string;
}): {
  tone: 'ok' | 'warn' | 'danger';
  title: string;
  desc: string;
  ctaLabel?: string;
  ctaUrl?: string;
} {
  if (overview && !overview.voiceConfigured) {
    return {
      tone: 'warn',
      title: '系统尚未完成语音模型配置',
      desc: '管理员尚未配置 TokenONE 对话模型与 TTS 音色，唤醒 Pod 后将无法进行云端对话与播报。',
    };
  }
  const r = overview?.readiness;
  if (r?.authStatus === 'account_required') {
    return {
      tone: 'warn',
      title: '请先用同一个 IDONE 账号登录 Botone',
      desc: '当前 IDONE 账号尚未在 Botone 建立个人空间，请先打开 Botone 登录一次，之后唤醒 Pod 会自动初始化「波波」。',
      ctaLabel: botoneUrl ? '打开 Botone 登录' : undefined,
      ctaUrl: botoneUrl || undefined,
    };
  }
  if (r?.authStatus === 'authorization_required') {
    return {
      tone: 'warn',
      title: '还差一步：前往 Botone 完成 TokenONE 模型授权',
      desc: '你的 Pod 绑定正常，但当前账号尚未在 Botone 授权个人 TokenONE Key，唤醒设备时会播报授权提示。',
      ctaLabel: botoneUrl ? '去 Botone 完成授权' : undefined,
      ctaUrl: botoneUrl || undefined,
    };
  }
  if (r?.authStatus === 'quota_exhausted') {
    return {
      tone: 'danger',
      title: 'TokenONE 个人额度已耗尽',
      desc: '当前账号的语音对话与流式 TTS 调用已暂停（零公共 Key 回退）。补充额度后再次唤醒即可恢复。',
      ctaLabel: botoneUrl ? '前往 Botone 查看额度' : undefined,
      ctaUrl: botoneUrl || undefined,
    };
  }
  if (r?.authStatus === 'model_connection_required') {
    return {
      tone: 'warn',
      title: '个人模型连接不可用或未包含当前语音模型',
      desc: `请检查 Botone 中的个人模型连接是否包含系统指定的对话模型（${overview?.voiceConfig.chatModel || '-'}）。`,
      ctaLabel: botoneUrl ? '检查 Botone 模型连接' : undefined,
      ctaUrl: botoneUrl || undefined,
    };
  }
  if (legacyCount > 0) {
    return {
      tone: 'warn',
      title: `发现 ${legacyCount} 台历史绑定设备需要重新登记`,
      desc: '旧版绑定缺少设备安全指纹（pairedClientHash），请在下方卡片解绑后通过设备屏幕重新扫码绑定。',
    };
  }
  return {
    tone: 'ok',
    title: '已接入 Botone · 「波波」语音外设就绪',
    desc: '对话、记忆、Bot 车队调度与 TokenONE 个人计费均由 Botone 承载。现在对着在线的 Pod 说「你好波波」即可开始。',
  };
}

export function LiveBadge({
  state,
  lastConnectedAt,
}: {
  state: PodLiveState;
  lastConnectedAt?: number | null;
}) {
  if (state === 'speaking') {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-0.5 rounded-full bg-blue-500/15 text-blue-600 dark:text-blue-400 border border-blue-500/30">
        <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
        <span>对话中</span>
      </span>
    );
  }
  if (state === 'calling') {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-0.5 rounded-full bg-blue-500/15 text-blue-600 dark:text-blue-400 border border-blue-500/30">
        <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
        <span>专线通话中</span>
      </span>
    );
  }
  if (state === 'standby' || state === 'online') {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
        <span>{state === 'standby' ? '在线待机' : '在线聆听'}</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] px-2 py-0.5 rounded-full bg-[var(--surface-subtle)] border border-[var(--border)] text-[var(--fg-muted)]">
      <span className="w-1.5 h-1.5 rounded-full bg-[var(--fg-muted)]/50" />
      <span>离线 · {formatRelativeTime(lastConnectedAt)}</span>
    </span>
  );
}

function StatusPill({
  dot,
  label,
  value,
}: {
  dot: 'ok' | 'warn' | 'err' | 'muted';
  label: string;
  value: string;
}) {
  const color =
    dot === 'ok'
      ? 'bg-emerald-500'
      : dot === 'warn'
        ? 'bg-amber-500'
        : dot === 'err'
          ? 'bg-red-500'
          : 'bg-[var(--fg-muted)]/50';
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-[var(--surface-subtle)] border border-[var(--border)] text-xs min-w-0">
      <span className={`w-2 h-2 rounded-full shrink-0 ${color}`} />
      <span className="text-[var(--fg-muted)] shrink-0">{label}</span>
      <span className="font-semibold ml-auto truncate">{value}</span>
    </div>
  );
}
