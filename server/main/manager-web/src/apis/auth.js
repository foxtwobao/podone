import { getServiceUrl } from './api';

export function authUrl(path) {
  const url = new URL(`${getServiceUrl().replace(/\/$/, '')}/user/${path}`, window.location.origin);
  if (url.origin !== window.location.origin) {
    throw new Error('IDONE 登录需要通过同一站点访问管理接口');
  }
  return url.href;
}

async function post(path, token) {
  const response = await fetch(authUrl(path), {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const result = await response.json();
  if (path === 'logout' && (response.status === 401 || [401, 10021].includes(result.code))) return;
  if (!response.ok || result.code !== 0) throw new Error(result.msg || '登录请求失败，请重试');
  return result.data;
}

// 一次性凭据不自动重试；失败后重新发起 IDONE 登录。
export const exchangeIdoneToken = () => post('idone/exchange');
export const logout = token => post('logout', token);
