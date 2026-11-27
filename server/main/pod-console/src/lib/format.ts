export function formatRelativeTime(timestamp?: number | null): string {
  if (!timestamp) return '尚未连接';
  const diffSec = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (diffSec < 60) return '刚刚';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} 分钟前`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour} 小时前`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 30) return `${diffDay} 天前`;
  return new Date(timestamp).toLocaleDateString('zh-CN');
}

export function formatFileSize(bytes?: number | null): string {
  if (!bytes || bytes <= 0) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function formatDateTime(value?: string | number | null): string {
  if (!value) return '-';
  const date = typeof value === 'number' ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function boardDisplayName(board?: string | null): string {
  if (!board) return '未知板型';
  if (board === 'waveshare-1.75c') return 'Pod 1.75C 圆屏';
  return board;
}

export function isValidRedirectTarget(target?: string | null): target is string {
  if (!target) return false;
  return target.startsWith('/') && !target.startsWith('//') && !target.startsWith('/login') && !target.startsWith('/auth/idone/callback');
}
