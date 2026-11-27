import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import { api, idoneLoginUrl, type PubConfig } from '../lib/api';
import { saveLoginRedirect } from '../lib/auth';
import { PodDial } from '../components/PodDial';

export function LoginPage() {
  const [searchParams] = useSearchParams();
  const [pubConfig, setPubConfig] = useState<PubConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>(() =>
    searchParams.get('authError')
      ? 'IDONE 登录未完成，请重新登录；如仍失败请联系管理员。'
      : '',
  );

  useEffect(() => {
    let active = true;
    api
      .getPubConfig()
      .then((cfg) => {
        if (active) setPubConfig(cfg);
      })
      .catch(() => {
        if (active) setError('无法读取服务登录配置，请刷新页面重试。');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const handleLogin = () => {
    saveLoginRedirect(searchParams.get('redirect'));
    window.location.assign(idoneLoginUrl());
  };

  const ready = pubConfig?.idoneEnabled === true;

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-[var(--bg)] text-[var(--fg)]">
      <div className="card w-full max-w-sm p-6 sm:p-8 space-y-6">
        <div className="flex flex-col items-center text-center gap-3">
          <PodDial size="lg" mood="idle" />
          <div>
            <h1 className="text-xl font-semibold m-0">Podone 控制台</h1>
            <p className="text-xs text-[var(--fg-muted)] mt-1.5 mb-0">
              使用 IDONE 账号登录，绑定并管理你的桌面语音 Pod，与 Botone「波波」无缝联动。
            </p>
          </div>
        </div>

        {error && (
          <div
            role="alert"
            className="p-3 rounded-xl border border-red-500/40 bg-red-500/10 text-xs text-red-600 dark:text-red-400"
          >
            {error}
          </div>
        )}

        <button
          type="button"
          disabled={loading || !ready}
          onClick={handleLogin}
          className="w-full inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-[var(--primary)] text-[var(--primary-fg)] text-sm font-medium hover:opacity-95 disabled:opacity-50 cursor-pointer"
        >
          <ShieldCheck className="w-4 h-4" />
          <span>{loading ? '正在检查登录配置…' : '使用 IDONE 登录'}</span>
        </button>

        {!loading && !ready && !error && (
          <p className="text-xs text-center text-amber-600 dark:text-amber-400 m-0">
            IDONE 登录尚未配置，请联系管理员检查服务端环境变量。
          </p>
        )}

        <div className="text-[11px] text-center text-[var(--fg-muted)] pt-2 border-t border-[var(--border)]">
          <span>Podone Hardware Companion</span>
          {pubConfig?.version ? <span> · v{pubConfig.version}</span> : null}
        </div>
      </div>
    </div>
  );
}
