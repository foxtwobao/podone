const API_BASE = '/xiaozhi';
const TOKEN_KEY = 'podone_token';

export interface ApiEnvelope<T> {
  code: number;
  msg?: string;
  data: T;
}

export interface PubConfig {
  idoneEnabled: boolean;
  name?: string;
  version?: string;
  year?: string;
  beianIcpNum?: string;
  beianGaNum?: string;
}

export interface UserInfo {
  id: number;
  username: string;
  superAdmin: number;
  status: number;
}

export interface PodVoiceOption {
  id: string;
  name: string;
  desc: string;
  enabled: boolean;
}

export type PodLiveState = 'standby' | 'speaking' | 'calling' | 'online' | 'offline';

export interface PodReadiness {
  bridgeOk: boolean;
  latencyMs?: number;
  botoneUrl?: string;
  accountReady: boolean;
  boboReady: boolean;
  boboBotId?: string | null;
  authStatus:
    | 'ready'
    | 'account_required'
    | 'authorization_required'
    | 'quota_exhausted'
    | 'model_connection_required'
    | 'bridge_unconfigured'
    | 'unavailable';
  modelReady: boolean;
  availableModels?: {
    chatModels: string[];
    ttsModels: string[];
  };
}

export interface PodDevice {
  id: string;
  alias: string;
  board: string;
  macAddress: string;
  appVersion: string;
  latestVersion: string;
  hasUpdate: boolean;
  ttsVoice: string;
  autoUpdate: boolean;
  allowIncomingCall: boolean;
  allowAsyncNotice: boolean;
  dndEnabled: boolean;
  dndStart: string;
  dndEnd: string;
  needsReenrollment: boolean;
  online: boolean;
  liveState: PodLiveState;
  inCall: boolean;
  createDateTimestamp: number | null;
  lastConnectedAtTimestamp: number | null;
}

export interface PodOverview {
  voiceConfigured: boolean;
  voiceConfig: {
    chatModel: string;
    ttsModel: string;
    defaultVoice: string;
  };
  voices: PodVoiceOption[];
  botoneUrl: string;
  voiceServerReachable?: boolean;
  onlineCount?: number;
  readiness?: PodReadiness | null;
  devices: PodDevice[];
}

export interface AdminRuntime {
  voiceServerReachable: boolean;
  botoneConfigured: boolean;
  botoneUrl: string;
  summary: {
    connected: number;
    standby: number;
    active: number;
    calling: number;
  };
  sessions: Record<string, { state: PodLiveState; inCall?: boolean }>;
  bridgeProbe?: PodReadiness | null;
}

export interface BindPreview {
  valid: boolean;
  board?: string;
  appVersion?: string;
  macMasked?: string;
  reason?: string;
}

export interface CoreParamItem {
  id: number;
  paramCode: string;
  paramValue: string;
  valueType: string;
  remark?: string;
}

export interface AdminVoiceConfig {
  chatModel: string;
  ttsModel: string;
  ttsVoice: string;
  voiceConfigured: boolean;
  botoneUrl: string;
  voiceCatalogSource?: 'builtin' | 'custom';
  voices: PodVoiceOption[];
  coreParams: CoreParamItem[];
}

export interface OtaFirmware {
  id: string;
  firmwareName: string;
  type: string;
  version: string;
  size: number;
  remark?: string;
  firmwarePath: string;
  createDate?: string;
  updateDate?: string;
}

export interface DictItem {
  key: string;
  name: string;
}

export interface AdminUserItem {
  userid: string;
  mobile: string;
  deviceCount: string;
  status: number;
  createDate?: string;
}

export interface AdminDeviceItem {
  id: string;
  alias?: string;
  board?: string;
  macAddress?: string;
  appVersion?: string;
  bindUserName?: string;
  autoUpdate?: number;
  createDateTimestamp?: number;
  lastConnectedAtTimestamp?: number;
}

export interface PageResult<T> {
  list: T[];
  total: number;
}

export class ApiError extends Error {
  code: number;
  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null) {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_KEY);
  }
}

export function idoneLoginUrl(): string {
  return `${API_BASE}/user/idone/login`;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const token = getToken();
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
  });

  if (res.status === 401) {
    setToken(null);
    throw new ApiError(401, '登录状态已过期，请重新登录');
  }

  let json: ApiEnvelope<T>;
  try {
    json = (await res.json()) as ApiEnvelope<T>;
  } catch {
    throw new ApiError(res.status, `请求失败 (${res.status})`);
  }

  if (json.code === 401) {
    setToken(null);
    throw new ApiError(401, json.msg || '登录状态已过期，请重新登录');
  }
  if (json.code !== 0) {
    throw new ApiError(json.code, json.msg || '操作失败');
  }
  return json.data;
}

export const api = {
  // Auth
  getPubConfig: () => request<PubConfig>('/user/pub-config'),
  exchangeIdone: () =>
    request<{ token: string; expire?: number }>('/user/idone/exchange', {
      method: 'POST',
      credentials: 'include',
    }),
  getUserInfo: () => request<UserInfo>('/user/info'),
  logout: () => request<void>('/user/logout', { method: 'POST' }),

  // User Pod Companion
  getPodOverview: () => request<PodOverview>('/pod/overview'),
  previewBindCode: (code: string) =>
    request<BindPreview>(`/pod/bind/preview?code=${encodeURIComponent(code)}`),
  bindPod: (payload: { code: string; alias?: string; ttsVoice?: string }) =>
    request<PodDevice>('/pod/bind', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updatePod: (
    id: string,
    payload: Partial<{
      alias: string;
      ttsVoice: string;
      autoUpdate: boolean;
      allowIncomingCall: boolean;
      allowAsyncNotice: boolean;
      dndEnabled: boolean;
      dndStart: string;
      dndEnd: string;
    }>,
  ) =>
    request<PodDevice>(`/pod/devices/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  unbindPod: (id: string) =>
    request<void>(`/pod/devices/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  // Admin Ops
  getAdminVoiceConfig: () => request<AdminVoiceConfig>('/admin/pod/voice-config'),
  getAdminRuntime: () => request<AdminRuntime>('/admin/pod/runtime'),
  saveAdminVoiceConfig: (payload: {
    chatModel: string;
    ttsModel: string;
    ttsVoice: string;
    botoneUrl: string;
    voices?: PodVoiceOption[];
  }) =>
    request<void>('/admin/pod/voice-config', {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  adminForceUnbind: (id: string) =>
    request<void>(`/admin/pod/devices/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  // Existing Admin Endpoints
  getFirmwareTypes: () => request<DictItem[]>('/admin/dict/data/type/FIRMWARE_TYPE'),
  listFirmwares: (page = 1, limit = 50, firmwareName = '') => {
    const q = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (firmwareName) q.set('firmwareName', firmwareName);
    return request<PageResult<OtaFirmware>>(`/otaMag?${q.toString()}`);
  },
  uploadFirmwareFile: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return request<string>('/otaMag/upload', { method: 'POST', body: form });
  },
  createFirmware: (payload: Omit<OtaFirmware, 'id' | 'createDate' | 'updateDate'>) =>
    request<void>('/otaMag', { method: 'POST', body: JSON.stringify(payload) }),
  deleteFirmware: (id: string) =>
    request<void>(`/otaMag/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  getFirmwareDownloadToken: (id: string) =>
    request<string>(`/otaMag/getDownloadUrl/${encodeURIComponent(id)}`),
  firmwareDownloadUrl: (uuid: string) => `${API_BASE}/otaMag/download/${encodeURIComponent(uuid)}`,

  listAdminDevices: (page = 1, limit = 50, keywords = '') => {
    const q = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (keywords) q.set('keywords', keywords);
    return request<PageResult<AdminDeviceItem>>(`/admin/device/all?${q.toString()}`);
  },
  listAdminUsers: (page = 1, limit = 50, mobile = '') => {
    const q = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (mobile) q.set('mobile', mobile);
    return request<PageResult<AdminUserItem>>(`/admin/users?${q.toString()}`);
  },
  changeUserStatus: (status: 0 | 1, userIds: string[]) =>
    request<void>(`/admin/users/changeStatus/${status}`, {
      method: 'PUT',
      body: JSON.stringify(userIds),
    }),
  deleteUser: (id: string) =>
    request<void>(`/admin/users/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  listWsServers: () => request<string[]>('/admin/server/server-list'),
  emitWsAction: (targetWs: string, action: 'update_config' | 'restart') =>
    request<boolean>('/admin/server/emit-action', {
      method: 'POST',
      body: JSON.stringify({ targetWs, action }),
    }),
  updateCoreParam: (param: CoreParamItem) =>
    request<void>('/admin/params', {
      method: 'PUT',
      body: JSON.stringify(param),
    }),
};
