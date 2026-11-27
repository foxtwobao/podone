import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, Sparkles } from 'lucide-react';
import { api, type BindPreview, type PodDevice, type PodVoiceOption } from '../lib/api';
import { useAuth } from '../lib/auth';
import { boardDisplayName } from '../lib/format';
import { AppShell } from '../components/AppShell';
import { PodDial } from '../components/PodDial';
import { useToast } from '../components/Toast';

const PRESET_NAMES = ['书房桌面', '卧室床头', '客厅边桌', '公司工位'];

export function BindPodPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();

  const initialCode = (searchParams.get('code') || '').replace(/\D/g, '').slice(0, 6);
  const [code, setCode] = useState(initialCode);
  const [alias, setAlias] = useState('书房桌面');
  const [customVoice, setCustomVoice] = useState(false);
  const [ttsVoice, setTtsVoice] = useState('');
  const [voiceQuery, setVoiceQuery] = useState('');
  const [voices, setVoices] = useState<PodVoiceOption[]>([]);
  const [defaultVoice, setDefaultVoice] = useState('');
  const [botoneUrl, setBotoneUrl] = useState('');
  const [preview, setPreview] = useState<BindPreview | null>(null);
  const [checkingCode, setCheckingCode] = useState(false);
  const [binding, setBinding] = useState(false);
  const [boundPod, setBoundPod] = useState<PodDevice | null>(null);

  useEffect(() => {
    api
      .getPodOverview()
      .then((res) => {
        setVoices(res.voices || []);
        setDefaultVoice(res.voiceConfig.defaultVoice || '');
        setBotoneUrl(res.botoneUrl || '');
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!/^\d{6}$/.test(code)) {
      setPreview(null);
      return;
    }
    let active = true;
    setCheckingCode(true);
    api
      .previewBindCode(code)
      .then((res) => {
        if (active) setPreview(res);
      })
      .catch(() => {
        if (active) setPreview({ valid: false });
      })
      .finally(() => {
        if (active) setCheckingCode(false);
      });
    return () => {
      active = false;
    };
  }, [code]);

  const handleBind = async () => {
    if (!/^\d{6}$/.test(code)) {
      toast('请输入完整的 6 位数字激活码', 'error');
      return;
    }
    setBinding(true);
    try {
      const pod = await api.bindPod({
        code,
        alias: alias.trim() || undefined,
        ttsVoice: customVoice && ttsVoice ? ttsVoice : undefined,
      });
      setBoundPod(pod);
      toast('Pod 绑定成功', 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : '绑定失败，请核对激活码', 'error');
    } finally {
      setBinding(false);
    }
  };

  return (
    <AppShell botoneUrl={botoneUrl}>
      <div className="max-w-md mx-auto space-y-4">
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 text-xs text-[var(--fg-muted)] hover:text-[var(--fg)] no-underline"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>返回我的 Pod</span>
        </Link>

        {boundPod ? (
          <div className="card p-6 space-y-5 text-center">
            <div className="flex flex-col items-center gap-3">
              <PodDial size="lg" mood="idle" />
              <div className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>绑定并激活成功</span>
              </div>
              <h2 className="text-lg font-semibold m-0">
                「{boundPod.alias || boardDisplayName(boundPod.board)}」已就绪
              </h2>
              <p className="text-xs text-[var(--fg-muted)] m-0">
                设备已直接归属到账号 {user?.username}，自动接入你的 Botone「波波」，无需再配置智能体。
              </p>
            </div>

            <div className="card-subtle p-3.5 text-left text-xs space-y-1.5">
              <div className="flex items-center gap-1.5 font-semibold">
                <Sparkles className="w-3.5 h-3.5 text-[var(--primary)]" />
                <span>现在试试唤醒它</span>
              </div>
              <p className="text-[var(--fg-muted)] m-0">
                对着设备说：<strong>「你好波波，今天杭州天气怎么样？」</strong>
                如果设备提示尚未完成模型授权，请点击下方按钮前往 Botone 授权一次即可。
              </p>
            </div>

            <div className="flex items-center justify-center gap-2 pt-1">
              {botoneUrl && (
                <a
                  href={botoneUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs font-medium px-3.5 py-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] no-underline text-[var(--fg)]"
                >
                  打开 Botone
                </a>
              )}
              <button
                type="button"
                onClick={() => navigate('/', { replace: true })}
                className="text-xs font-medium px-4 py-2 rounded-xl bg-[var(--primary)] text-[var(--primary-fg)] cursor-pointer"
              >
                进入我的 Pod
              </button>
            </div>
          </div>
        ) : (
          <div className="card p-5 sm:p-6 space-y-5">
            <div className="flex flex-col items-center text-center gap-2.5 pb-4 border-b border-[var(--border)]">
              <PodDial size="lg" mood="curious" />
              <h1 className="text-lg font-semibold m-0">
                {preview?.valid ? '发现一台新的 Pod' : '绑定新的 Pod'}
              </h1>
              <p className="text-xs text-[var(--fg-muted)] m-0">
                {preview?.valid
                  ? `${boardDisplayName(preview.board)} · ${preview.macMasked || ''}`
                  : '输入或确认设备圆屏上显示的 6 位激活码'}
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[var(--fg-muted)] block">
                1. 6 位激活码
              </label>
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="输入 6 位数字"
                className="w-full px-3.5 py-2.5 text-center font-mono text-xl font-bold tracking-[0.25em] rounded-xl border border-[var(--border)] bg-[var(--surface-subtle)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/40"
              />
              {checkingCode && (
                <p className="text-[11px] text-[var(--fg-muted)] m-0">正在校验激活码…</p>
              )}
              {!checkingCode && preview && !preview.valid && (
                <p className="text-[11px] text-amber-600 dark:text-amber-400 m-0">
                  {preview.reason === 'already_activated'
                    ? '该设备已被激活，如需换绑请先在原账号解绑。'
                    : '未找到有效的待激活设备，请核对设备屏幕上的 6 位数字。'}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium text-[var(--fg-muted)] block">
                2. 给这台 Pod 起个名字
              </label>
              <input
                type="text"
                maxLength={64}
                value={alias}
                onChange={(e) => setAlias(e.target.value)}
                placeholder="例如：书房桌面"
                className="w-full px-3 py-2 text-sm rounded-xl border border-[var(--border)] bg-[var(--surface)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/40"
              />
              <div className="flex flex-wrap gap-1.5">
                {PRESET_NAMES.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setAlias(preset)}
                    className={`text-[11.5px] px-2.5 py-1 rounded-full border cursor-pointer ${
                      alias === preset
                        ? 'border-[var(--primary)] bg-[var(--primary)]/10 text-[var(--primary)]'
                        : 'border-[var(--border)] bg-[var(--surface)] text-[var(--fg-muted)]'
                    }`}
                  >
                    {preset}
                  </button>
                ))}
              </div>
            </div>

            {voices.length > 0 && (
              <div className="space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <label className="text-xs font-medium text-[var(--fg-muted)] block">
                    3. 播报音色（共 {voices.length} 个可选，随时可改）
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setCustomVoice((v) => {
                        const next = !v;
                        if (next && !ttsVoice) setTtsVoice(defaultVoice || voices[0]?.id || '');
                        return next;
                      });
                    }}
                    className="text-[11.5px] font-medium text-[var(--primary)] cursor-pointer bg-transparent border-0 p-0"
                  >
                    {customVoice ? '改为跟随系统默认' : '单独指定音色'}
                  </button>
                </div>

                {!customVoice ? (
                  <div className="flex items-center justify-between px-3 py-2.5 rounded-xl border border-[var(--primary)] bg-[var(--primary)]/10">
                    <div>
                      <div className="text-xs font-semibold">
                        跟随系统默认（{voices.find((v) => v.id === defaultVoice)?.name || defaultVoice || '默认音色'}）
                      </div>
                      <div className="text-[11px] text-[var(--fg-muted)] font-mono">
                        {defaultVoice || voices[0]?.id}
                      </div>
                    </div>
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-[var(--surface)] border border-[var(--border)] text-[var(--fg-muted)]">
                      默认
                    </span>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {voices.length > 6 && (
                      <input
                        type="text"
                        value={voiceQuery}
                        onChange={(e) => setVoiceQuery(e.target.value)}
                        placeholder={`搜索 ${voices.length} 个音色名称或编码…`}
                        className="w-full px-3 py-1.5 text-xs rounded-lg border border-[var(--border)] bg-[var(--surface)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/40"
                      />
                    )}
                    <div className="grid grid-cols-2 gap-2 max-h-56 overflow-y-auto pr-0.5">
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
                          const isDefault = v.id === defaultVoice;
                          const selected = ttsVoice === v.id;
                          return (
                            <button
                              key={v.id}
                              type="button"
                              onClick={() => setTtsVoice(v.id)}
                              className={`text-left px-3 py-2 rounded-xl border cursor-pointer ${
                                selected
                                  ? 'border-[var(--primary)] bg-[var(--primary)]/10'
                                  : 'border-[var(--border)] bg-[var(--surface)]'
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
                  </div>
                )}
              </div>
            )}

            <button
              type="button"
              disabled={binding || !/^\d{6}$/.test(code)}
              onClick={handleBind}
              className="w-full py-2.5 px-4 rounded-xl bg-[var(--primary)] text-[var(--primary-fg)] text-sm font-medium hover:opacity-95 disabled:opacity-50 cursor-pointer"
            >
              {binding ? '正在激活绑定…' : `绑定到 ${user?.username || '我的账号'}`}
            </button>
          </div>
        )}
      </div>
    </AppShell>
  );
}
