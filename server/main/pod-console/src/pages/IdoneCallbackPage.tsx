import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, setToken } from '../lib/api';
import { consumeLoginRedirect, useAuth } from '../lib/auth';
import { PodDial } from '../components/PodDial';

export function IdoneCallbackPage() {
  const navigate = useNavigate();
  const { refreshUser } = useAuth();
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await api.exchangeIdone();
        if (!res?.token) {
          throw new Error('登录凭证无效，请重新登录');
        }
        setToken(res.token);
        await refreshUser();
        if (active) {
          navigate(consumeLoginRedirect(), { replace: true });
        }
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : 'IDONE 登录交换失败，请重新登录');
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [navigate, refreshUser]);

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-[var(--bg)] text-[var(--fg)]">
      <div className="card w-full max-w-sm p-6 text-center space-y-4">
        <div className="flex justify-center">
          <PodDial size="lg" mood={error ? 'warn' : 'curious'} />
        </div>
        {error ? (
          <>
            <p className="text-sm font-medium text-red-600 dark:text-red-400 m-0">{error}</p>
            <button
              type="button"
              onClick={() => navigate('/login', { replace: true })}
              className="px-4 py-2 rounded-xl bg-[var(--primary)] text-[var(--primary-fg)] text-xs font-medium cursor-pointer"
            >
              返回重新登录
            </button>
          </>
        ) : (
          <p className="text-sm text-[var(--fg-muted)] m-0">正在完成 IDONE 登录…</p>
        )}
      </div>
    </div>
  );
}
