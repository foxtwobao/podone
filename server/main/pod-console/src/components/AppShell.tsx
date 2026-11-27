import React, { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ExternalLink, LogOut, Moon, Settings2, Sun } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { PodDial } from './PodDial';
import { useToast } from './Toast';

interface AppShellProps {
  botoneUrl?: string;
  children: React.ReactNode;
}

const THEME_KEY = 'podone_theme';

export function AppShell({ botoneUrl, children }: AppShellProps) {
  const { user, isAdmin, logout } = useAuth();
  const { toast } = useToast();
  const location = useLocation();
  const navigate = useNavigate();
  const [dark, setDark] = useState<boolean>(() => {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'dark') return true;
    if (saved === 'light') return false;
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light');
  }, [dark]);

  const inAdmin = location.pathname.startsWith('/admin');

  const handleLogout = async () => {
    await logout();
    toast('已退出登录');
    navigate('/login', { replace: true });
  };

  return (
    <div className="min-h-screen flex flex-col bg-[var(--bg)] text-[var(--fg)]">
      <header className="sticky top-0 z-30 border-b border-[var(--border)] bg-[var(--surface)]/90 backdrop-blur">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-3">
          <Link to="/" className="flex items-center gap-2.5 no-underline text-inherit">
            <PodDial size="sm" />
            <div className="flex items-center gap-2">
              <span className="font-semibold text-[15px] tracking-tight">Podone</span>
              <span className="hidden sm:inline-block text-[11px] px-2 py-0.5 rounded-full bg-[var(--surface-subtle)] border border-[var(--border)] text-[var(--fg-muted)]">
                {inAdmin ? '平台运维' : '硬件控制台'}
              </span>
            </div>
          </Link>

          <div className="flex items-center gap-2">
            {botoneUrl && (
              <a
                href={botoneUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--surface-subtle)] text-[var(--fg)] no-underline transition-colors"
              >
                <span className="hidden sm:inline">打开 Botone</span>
                <span className="sm:hidden">Botone</span>
                <ExternalLink className="w-3.5 h-3.5 text-[var(--fg-muted)]" />
              </a>
            )}

            {isAdmin && (
              <Link
                to={inAdmin ? '/' : '/admin'}
                className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border no-underline transition-colors ${
                  inAdmin
                    ? 'bg-[var(--primary)] text-[var(--primary-fg)] border-[var(--primary)]'
                    : 'border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--surface-subtle)] text-[var(--fg)]'
                }`}
              >
                <Settings2 className="w-3.5 h-3.5" />
                <span>{inAdmin ? '我的 Pod' : '管理后台'}</span>
              </Link>
            )}

            <button
              type="button"
              onClick={() => setDark((d) => !d)}
              className="p-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--surface-subtle)] text-[var(--fg-muted)] cursor-pointer"
              title={dark ? '切换到浅色模式' : '切换到深色模式'}
              aria-label="切换主题"
            >
              {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>

            {user && (
              <div className="flex items-center gap-1.5 pl-1 border-l border-[var(--border)]">
                <span className="hidden md:inline text-xs text-[var(--fg-muted)] max-w-[140px] truncate">
                  {user.username}
                </span>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="p-1.5 rounded-lg hover:bg-[var(--surface-subtle)] text-[var(--fg-muted)] hover:text-[var(--fg)] cursor-pointer"
                  title="退出登录"
                  aria-label="退出登录"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 w-full max-w-5xl mx-auto px-4 sm:px-6 py-5 sm:py-7">
        {children}
      </main>
    </div>
  );
}
