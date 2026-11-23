import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ base: '/xiaozhi' }));
vi.mock('../src/apis/api', () => ({
  getServiceUrl: () => api.base,
  default: { user: { getPubConfig: vi.fn() } },
}));
vi.mock('../src/utils', () => ({ goToPage: vi.fn() }));

import { authUrl, exchangeIdoneToken } from '../src/apis/auth';
import store from '../src/store';
import { goToPage } from '../src/utils';

describe('IDONE authentication', () => {
  beforeEach(() => {
    api.base = '/xiaozhi';
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn());
    store.commit('clearAuth');
  });

  it('exchanges the HttpOnly cookie once without putting credentials in the URL', async () => {
    fetch.mockResolvedValue({ ok: true, json: async () => ({ code: 0, data: { token: 'app-token' } }) });
    expect(await exchangeIdoneToken()).toEqual({ token: 'app-token' });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, request] = fetch.mock.calls[0];
    expect(url).toBe(`${window.location.origin}/xiaozhi/user/idone/exchange`);
    expect(request).toMatchObject({ method: 'POST', credentials: 'same-origin', cache: 'no-store' });
    expect(request.headers).toEqual({});
  });

  it('does not retry a lost exchange response', async () => {
    fetch.mockRejectedValue(new Error('network failure'));
    await expect(exchangeIdoneToken()).rejects.toThrow('network failure');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('rejects expired exchanges and cross-origin API configuration', async () => {
    fetch.mockResolvedValue({ ok: true, json: async () => ({ code: 400, msg: '登录已失效' }) });
    await expect(exchangeIdoneToken()).rejects.toThrow('登录已失效');
    api.base = 'https://other.test/xiaozhi';
    expect(() => authUrl('idone/login')).toThrow('同一站点');
  });

  it('invalidates the server token before clearing local state', async () => {
    store.commit('setToken', JSON.stringify({ token: 'app-token' }));
    let finish;
    fetch.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const pending = store.dispatch('logout');
    expect(store.getters.getToken).toContain('app-token');
    finish({ ok: true, json: async () => ({ code: 0 }) });
    await pending;
    expect(fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer app-token');
    expect(localStorage.getItem('token')).toBeNull();
    expect(goToPage).toHaveBeenCalledWith('/login', true);
  });

  it('keeps local state if server logout fails', async () => {
    store.commit('setToken', JSON.stringify({ token: 'app-token' }));
    fetch.mockRejectedValue(new Error('network failure'));
    await expect(store.dispatch('logout')).rejects.toThrow('network failure');
    expect(localStorage.getItem('token')).toContain('app-token');
    expect(goToPage).not.toHaveBeenCalled();
  });

  it('clears an already expired server session', async () => {
    store.commit('setToken', JSON.stringify({ token: 'expired-token' }));
    fetch.mockResolvedValue({ ok: true, json: async () => ({ code: 401 }) });
    await store.dispatch('logout');
    expect(localStorage.getItem('token')).toBeNull();
  });
});
