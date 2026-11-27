import { useCallback, useEffect, useState } from 'react';
import { Download, Plus, RefreshCw, RotateCw, Save, Trash2, Upload } from 'lucide-react';
import {
  api,
  type AdminDeviceItem,
  type AdminRuntime,
  type AdminUserItem,
  type AdminVoiceConfig,
  type CoreParamItem,
  type DictItem,
  type OtaFirmware,
  type PodVoiceOption,
} from '../lib/api';
import { formatDateTime, formatFileSize } from '../lib/format';
import { AppShell } from '../components/AppShell';
import { useToast } from '../components/Toast';
import { LiveBadge } from './MyPodsPage';

type AdminTab = 'overview' | 'voice' | 'ota' | 'fleet' | 'nodes';

export function AdminPage() {
  const { toast } = useToast();
  const [tab, setTab] = useState<AdminTab>('overview');
  const [loading, setLoading] = useState(true);

  const [voiceCfg, setVoiceCfg] = useState<AdminVoiceConfig | null>(null);
  const [runtime, setRuntime] = useState<AdminRuntime | null>(null);
  const [chatModel, setChatModel] = useState('');
  const [ttsModel, setTtsModel] = useState('');
  const [ttsVoice, setTtsVoice] = useState('');
  const [customChatModel, setCustomChatModel] = useState(false);
  const [customTtsModel, setCustomTtsModel] = useState(false);
  const [customTtsVoice, setCustomTtsVoice] = useState(false);
  const [botoneUrl, setBotoneUrl] = useState('');
  const [voiceCatalogSource, setVoiceCatalogSource] = useState<'builtin' | 'custom'>('builtin');
  const [customCatalogMode, setCustomCatalogMode] = useState(false);
  const [voices, setVoices] = useState<PodVoiceOption[]>([]);
  const [coreParams, setCoreParams] = useState<CoreParamItem[]>([]);

  const [wsServers, setWsServers] = useState<string[]>([]);
  const [firmwares, setFirmwares] = useState<OtaFirmware[]>([]);
  const [boardTypes, setBoardTypes] = useState<DictItem[]>([]);
  const [devices, setDevices] = useState<AdminDeviceItem[]>([]);
  const [deviceTotal, setDeviceTotal] = useState(0);
  const [users, setUsers] = useState<AdminUserItem[]>([]);
  const [userTotal, setUserTotal] = useState(0);
  const [fleetMode, setFleetMode] = useState<'devices' | 'users'>('devices');
  const [savingVoice, setSavingVoice] = useState(false);

  // New firmware form
  const [showUploadForm, setShowUploadForm] = useState(false);
  const [fwName, setFwName] = useState('');
  const [fwType, setFwType] = useState('waveshare-1.75c');
  const [fwVersion, setFwVersion] = useState('');
  const [fwRemark, setFwRemark] = useState('');
  const [fwFile, setFwFile] = useState<File | null>(null);
  const [uploadingFw, setUploadingFw] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [vc, rt, ws, fw, types, devPage, userPage] = await Promise.all([
        api.getAdminVoiceConfig(),
        api.getAdminRuntime().catch(() => null),
        api.listWsServers().catch(() => [] as string[]),
        api.listFirmwares(1, 50).catch(() => ({ list: [], total: 0 })),
        api.getFirmwareTypes().catch(() => [] as DictItem[]),
        api.listAdminDevices(1, 50).catch(() => ({ list: [], total: 0 })),
        api.listAdminUsers(1, 50).catch(() => ({ list: [], total: 0 })),
      ]);
      setVoiceCfg(vc);
      setRuntime(rt);
      setChatModel(vc.chatModel || '');
      setTtsModel(vc.ttsModel || '');
      setTtsVoice(vc.ttsVoice || '');
      setCustomChatModel(false);
      setCustomTtsModel(false);
      setCustomTtsVoice(false);
      setBotoneUrl(vc.botoneUrl || '');
      const src = vc.voiceCatalogSource === 'custom' ? 'custom' : 'builtin';
      setVoiceCatalogSource(src);
      setCustomCatalogMode(src === 'custom');
      setVoices(vc.voices || []);
      setCoreParams(vc.coreParams || []);
      setWsServers(ws);
      setFirmwares(fw.list || []);
      setBoardTypes(types);
      if (types.length > 0) setFwType(types[0].key);
      setDevices(devPage.list || []);
      setDeviceTotal(devPage.total || 0);
      setUsers(userPage.list || []);
      setUserTotal(userPage.total || 0);
    } catch (err) {
      toast(err instanceof Error ? err.message : '加载管理数据失败', 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const handleSaveVoice = async () => {
    setSavingVoice(true);
    try {
      await api.saveAdminVoiceConfig({
        chatModel,
        ttsModel,
        ttsVoice,
        botoneUrl,
        voices: customCatalogMode ? voices.filter((v) => v.id.trim() !== '') : [],
      });
      toast('语音与通道配置已保存', 'success');
      await loadAll();
    } catch (err) {
      toast(err instanceof Error ? err.message : '保存失败', 'error');
    } finally {
      setSavingVoice(false);
    }
  };

  const handleAddVoiceRow = () => {
    setVoices((prev) => [...prev, { id: '', name: '', desc: '', enabled: true }]);
  };

  const handleUploadFirmware = async () => {
    if (!fwFile || !fwName.trim() || !fwVersion.trim() || !fwType) {
      toast('请填写固件名称、板型、版本号并选择 .bin 文件', 'error');
      return;
    }
    setUploadingFw(true);
    try {
      const path = await api.uploadFirmwareFile(fwFile);
      await api.createFirmware({
        firmwareName: fwName.trim(),
        type: fwType,
        version: fwVersion.trim(),
        size: fwFile.size,
        remark: fwRemark.trim(),
        firmwarePath: path,
      });
      toast('新固件已发布', 'success');
      setShowUploadForm(false);
      setFwName('');
      setFwVersion('');
      setFwRemark('');
      setFwFile(null);
      await loadAll();
    } catch (err) {
      toast(err instanceof Error ? err.message : '固件发布失败', 'error');
    } finally {
      setUploadingFw(false);
    }
  };

  const handleDownloadFirmware = async (id: string) => {
    try {
      const uuid = await api.getFirmwareDownloadToken(id);
      window.open(api.firmwareDownloadUrl(uuid), '_blank');
    } catch (err) {
      toast(err instanceof Error ? err.message : '获取下载链接失败', 'error');
    }
  };

  const handleDeleteFirmware = async (id: string) => {
    if (!window.confirm('确认删除该固件版本？')) return;
    try {
      await api.deleteFirmware(id);
      toast('固件已删除', 'success');
      await loadAll();
    } catch (err) {
      toast(err instanceof Error ? err.message : '删除失败', 'error');
    }
  };

  const handleForceUnbind = async (id: string) => {
    if (!window.confirm('确认强制解绑该设备？设备下次交互将立即断开。')) return;
    try {
      await api.adminForceUnbind(id);
      toast('设备已强制解绑', 'success');
      await loadAll();
    } catch (err) {
      toast(err instanceof Error ? err.message : '操作失败', 'error');
    }
  };

  const handleToggleUserStatus = async (user: AdminUserItem) => {
    const nextStatus: 0 | 1 = user.status === 1 ? 0 : 1;
    try {
      await api.changeUserStatus(nextStatus, [user.userid]);
      toast(nextStatus === 1 ? '账号已启用' : '账号已停用', 'success');
      await loadAll();
    } catch (err) {
      toast(err instanceof Error ? err.message : '修改状态失败', 'error');
    }
  };

  const handleWsAction = async (targetWs: string, action: 'update_config' | 'restart') => {
    const label = action === 'restart' ? '重启节点' : '重载配置';
    if (!window.confirm(`确认向 ${targetWs} 发送「${label}」指令？`)) return;
    try {
      await api.emitWsAction(targetWs, action);
      toast(`已发送${label}指令`, 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : `${label}失败`, 'error');
    }
  };

  const handleSaveCoreParam = async (param: CoreParamItem) => {
    try {
      await api.updateCoreParam(param);
      toast(`参数 ${param.paramCode} 已更新`, 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : '更新失败', 'error');
    }
  };

  const tabs: Array<[AdminTab, string]> = [
    ['overview', '运行概览'],
    ['voice', '语音与通道'],
    ['ota', '固件 OTA'],
    ['fleet', '用户与设备'],
    ['nodes', '节点与参数'],
  ];

  return (
    <AppShell botoneUrl={botoneUrl}>
      <div className="card p-4 sm:p-5 space-y-5">
        <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] pb-3 flex-wrap">
          <div className="flex items-center gap-1 overflow-x-auto">
            {tabs.map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap cursor-pointer border transition-colors ${
                  tab === key
                    ? 'bg-[var(--surface-subtle)] text-[var(--fg)] border-[var(--border)]'
                    : 'bg-transparent text-[var(--fg-muted)] border-transparent hover:text-[var(--fg)]'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => void loadAll()}
            className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--surface-subtle)] cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>刷新</span>
          </button>
        </div>

        {/* Tab 1: Overview */}
        {tab === 'overview' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <KpiCard
                label="在线 Pod"
                value={`${runtime?.summary.connected ?? 0} / ${deviceTotal}`}
                sub={`待机 ${runtime?.summary.standby ?? 0} · 活跃 ${runtime?.summary.active ?? 0}`}
              />
              <KpiCard
                label="Botone Bridge"
                value={
                  runtime?.bridgeProbe?.bridgeOk
                    ? `${runtime.bridgeProbe.latencyMs ?? 0}ms`
                    : runtime?.botoneConfigured
                      ? '异常'
                      : '未配置'
                }
                sub={
                  runtime?.bridgeProbe?.bridgeOk
                    ? '内网桥接探活正常'
                    : runtime?.voiceServerReachable
                      ? '请检查 Botone 服务'
                      : '语音节点未连通'
                }
              />
              <KpiCard label="IDONE 用户数" value={String(userTotal)} sub={`${wsServers.length} 个 WS 节点`} />
              <KpiCard label="已发布固件" value={String(firmwares.length)} sub={`${boardTypes.length} 种板型`} />
            </div>

            <div className="card-subtle p-4 space-y-3">
              <div className="text-xs font-semibold">平台配置与链路自检</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2.5 text-xs">
                <CheckBox
                  ok={Boolean(runtime?.voiceServerReachable)}
                  title="语音网关节点"
                  detail={runtime?.voiceServerReachable ? '内部状态端口 8003 可达' : '暂不可达（重启中或未联通）'}
                />
                <CheckBox
                  ok={Boolean(runtime?.bridgeProbe?.bridgeOk)}
                  title="Botone 外设网关"
                  detail={
                    runtime?.bridgeProbe?.bridgeOk
                      ? `200 OK · ${runtime.bridgeProbe.latencyMs ?? 0}ms`
                      : runtime?.botoneUrl || '未探测到 Botone'
                  }
                />
                <CheckBox
                  ok={Boolean(voiceCfg?.voiceConfigured)}
                  title="TokenONE 语音模型"
                  detail={
                    voiceCfg?.voiceConfigured
                      ? `${voiceCfg.chatModel} / ${voiceCfg.ttsModel}`
                      : '尚未配置 chatModel / ttsModel / ttsVoice'
                  }
                />
                <CheckBox
                  ok={wsServers.length > 0}
                  title="WebSocket 地址"
                  detail={wsServers[0] || '请检查 server.websocket'}
                />
              </div>
            </div>
          </div>
        )}

        {/* Tab 2: Voice & Channel Config */}
        {tab === 'voice' && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="card-subtle p-4 space-y-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="text-xs font-semibold">TokenONE 语音通道</div>
                  {runtime?.bridgeProbe?.availableModels && (
                    <span className="text-[11px] text-[var(--fg-muted)]">
                      已同步 {runtime.bridgeProbe.availableModels.chatModels.length} 个对话模型 ·{' '}
                      {runtime.bridgeProbe.availableModels.ttsModels.length} 个合成模型
                    </span>
                  )}
                </div>
                {(() => {
                  const availChat = runtime?.bridgeProbe?.availableModels?.chatModels ?? [];
                  const chatOptions = chatModel && !availChat.includes(chatModel)
                    ? [chatModel, ...availChat]
                    : availChat;
                  const availTts = runtime?.bridgeProbe?.availableModels?.ttsModels ?? [];
                  const ttsOptions = ttsModel && !availTts.includes(ttsModel)
                    ? [ttsModel, ...availTts]
                    : availTts;
                  const voiceInList = voices.some((v) => v.id === ttsVoice);
                  return (
                    <>
                      <Field label="默认语音对话模型 (chatModel)">
                        {chatOptions.length > 0 && !customChatModel ? (
                          <select
                            className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-[var(--border)] bg-[var(--surface)]"
                            value={chatModel}
                            onChange={(e) => {
                              if (e.target.value === '__custom__') {
                                setCustomChatModel(true);
                              } else {
                                setChatModel(e.target.value);
                              }
                            }}
                          >
                            {chatOptions.map((id) => (
                              <option key={id} value={id}>
                                {id}
                                {!availChat.includes(id) ? '（当前配置）' : ''}
                              </option>
                            ))}
                            <option value="__custom__">手动输入其他模型...</option>
                          </select>
                        ) : (
                          <div className="flex items-center gap-1.5">
                            <input
                              className="flex-1 px-3 py-2 text-xs font-mono rounded-lg border border-[var(--border)] bg-[var(--surface)]"
                              value={chatModel}
                              onChange={(e) => setChatModel(e.target.value)}
                              placeholder="例如：deepseek-v4.1-flash"
                            />
                            {chatOptions.length > 0 && (
                              <button
                                type="button"
                                onClick={() => setCustomChatModel(false)}
                                className="text-[11px] px-2.5 py-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--surface-subtle)] cursor-pointer whitespace-nowrap"
                              >
                                返回列表
                              </button>
                            )}
                          </div>
                        )}
                      </Field>

                      <Field label="云端流式合成模型 (ttsModel)">
                        {ttsOptions.length > 0 && !customTtsModel ? (
                          <select
                            className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-[var(--border)] bg-[var(--surface)]"
                            value={ttsModel}
                            onChange={(e) => {
                              if (e.target.value === '__custom__') {
                                setCustomTtsModel(true);
                              } else {
                                setTtsModel(e.target.value);
                              }
                            }}
                          >
                            {ttsOptions.map((id) => (
                              <option key={id} value={id}>
                                {id}
                                {!availTts.includes(id) ? '（当前配置）' : ''}
                              </option>
                            ))}
                            <option value="__custom__">手动输入其他模型...</option>
                          </select>
                        ) : (
                          <div className="flex items-center gap-1.5">
                            <input
                              className="flex-1 px-3 py-2 text-xs font-mono rounded-lg border border-[var(--border)] bg-[var(--surface)]"
                              value={ttsModel}
                              onChange={(e) => setTtsModel(e.target.value)}
                              placeholder="例如：speech-01-turbo"
                            />
                            {ttsOptions.length > 0 && (
                              <button
                                type="button"
                                onClick={() => setCustomTtsModel(false)}
                                className="text-[11px] px-2.5 py-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--surface-subtle)] cursor-pointer whitespace-nowrap"
                              >
                                返回列表
                              </button>
                            )}
                          </div>
                        )}
                      </Field>

                      <Field label="系统默认音色 (ttsVoice)">
                        {voices.length > 0 && !customTtsVoice ? (
                          <select
                            className="w-full px-3 py-2 text-xs rounded-lg border border-[var(--border)] bg-[var(--surface)]"
                            value={voiceInList ? ttsVoice : '__current__'}
                            onChange={(e) => {
                              if (e.target.value === '__custom__') {
                                setCustomTtsVoice(true);
                              } else if (e.target.value !== '__current__') {
                                setTtsVoice(e.target.value);
                              }
                            }}
                          >
                            {!voiceInList && (
                              <option value="__current__">{ttsVoice || '(未设置)'}（当前配置）</option>
                            )}
                            {voices.map((v) => (
                              <option key={v.id} value={v.id}>
                                {v.name} ({v.id})
                              </option>
                            ))}
                            <option value="__custom__">手动输入自定义音色编码...</option>
                          </select>
                        ) : (
                          <div className="flex items-center gap-1.5">
                            <input
                              className="flex-1 px-3 py-2 text-xs font-mono rounded-lg border border-[var(--border)] bg-[var(--surface)]"
                              value={ttsVoice}
                              onChange={(e) => setTtsVoice(e.target.value)}
                              placeholder="输入所选 TTS 通道支持的音色编码"
                            />
                            {voices.length > 0 && (
                              <button
                                type="button"
                                onClick={() => setCustomTtsVoice(false)}
                                className="text-[11px] px-2.5 py-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--surface-subtle)] cursor-pointer whitespace-nowrap"
                              >
                                返回列表
                              </button>
                            )}
                          </div>
                        )}
                      </Field>
                    </>
                  );
                })()}
              </div>

              <div className="card-subtle p-4 space-y-3">
                <div className="text-xs font-semibold">生态联动</div>
                <Field label="Botone 网页端地址 (podone.botone.url)">
                  <input
                    className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-[var(--border)] bg-[var(--surface)]"
                    value={botoneUrl}
                    onChange={(e) => setBotoneUrl(e.target.value)}
                    placeholder="https://bot.lab.home.arpa"
                  />
                </Field>
                <p className="text-[11px] text-[var(--fg-muted)] m-0 leading-relaxed">
                  填写后，普通用户在「我的 Pod」顶部可直接跳转 Botone 编辑「波波」指令、查看对话记录、完成 TokenONE 授权或调整审批规则。个人模型 Key 全程由 Botone 通过 Reseller 获取并按轮次透传，此处绝不保存任何 API Key。
                </p>
              </div>
            </div>

            <div className="card-subtle p-4 space-y-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div>
                  <div className="text-xs font-semibold">
                    用户可选音色目录（当前共 {voices.length} 个 · {voiceCatalogSource === 'custom' ? '自定义白名单' : '自动继承内置音色库'}）
                  </div>
                  <div className="text-[11px] text-[var(--fg-muted)]">
                    默认自动加载与当前 ttsModel（{ttsModel || '-'}）匹配的全部内置音色；仅当你需要精简或自定义名称时开启覆盖模式。
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setCustomCatalogMode((m) => {
                        const next = !m;
                        if (next && voices.length > 15) {
                          setVoices((prev) => prev.slice(0, 8));
                        }
                        return next;
                      });
                    }}
                    className="text-xs px-2.5 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] cursor-pointer"
                  >
                    {customCatalogMode ? '恢复自动继承全量内置音色' : '自定义精选白名单'}
                  </button>
                  {customCatalogMode && (
                    <button
                      type="button"
                      onClick={handleAddVoiceRow}
                      className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>添加音色</span>
                    </button>
                  )}
                </div>
              </div>

              {!customCatalogMode ? (
                <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto">
                  {voices.map((v) => (
                    <span
                      key={v.id}
                      className={`text-[11px] px-2.5 py-1 rounded-full border ${
                        v.id === ttsVoice
                          ? 'border-[var(--primary)] bg-[var(--primary)]/10 text-[var(--primary)] font-medium'
                          : 'border-[var(--border)] bg-[var(--surface)] text-[var(--fg-muted)]'
                      }`}
                    >
                      {v.name} <span className="font-mono opacity-75">({v.id})</span>
                    </span>
                  ))}
                </div>
              ) : (
                <div className="space-y-2">
                  {voices.map((v, idx) => (
                    <div key={idx} className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-center">
                      <input
                        className="sm:col-span-4 px-2.5 py-1.5 text-xs font-mono rounded-lg border border-[var(--border)] bg-[var(--surface)]"
                        placeholder="音色编码 (voice id)"
                        value={v.id}
                        onChange={(e) =>
                          setVoices((prev) =>
                            prev.map((item, i) => (i === idx ? { ...item, id: e.target.value } : item)),
                          )
                        }
                      />
                      <input
                        className="sm:col-span-3 px-2.5 py-1.5 text-xs rounded-lg border border-[var(--border)] bg-[var(--surface)]"
                        placeholder="展示名称"
                        value={v.name}
                        onChange={(e) =>
                          setVoices((prev) =>
                            prev.map((item, i) => (i === idx ? { ...item, name: e.target.value } : item)),
                          )
                        }
                      />
                      <input
                        className="sm:col-span-3 px-2.5 py-1.5 text-xs rounded-lg border border-[var(--border)] bg-[var(--surface)]"
                        placeholder="简短描述"
                        value={v.desc}
                        onChange={(e) =>
                          setVoices((prev) =>
                            prev.map((item, i) => (i === idx ? { ...item, desc: e.target.value } : item)),
                          )
                        }
                      />
                      <div className="sm:col-span-2 flex items-center justify-end gap-2">
                        <label className="inline-flex items-center gap-1 text-xs cursor-pointer">
                          <input
                            type="checkbox"
                            checked={v.enabled}
                            onChange={(e) =>
                              setVoices((prev) =>
                                prev.map((item, i) =>
                                  i === idx ? { ...item, enabled: e.target.checked } : item,
                                ),
                              )
                            }
                          />
                          <span>启用</span>
                        </label>
                        <button
                          type="button"
                          onClick={() => setVoices((prev) => prev.filter((_, i) => i !== idx))}
                          className="p-1 text-[var(--fg-muted)] hover:text-red-500 cursor-pointer"
                          aria-label="删除音色"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex justify-end pt-2 border-t border-[var(--border)]">
                <button
                  type="button"
                  disabled={savingVoice}
                  onClick={handleSaveVoice}
                  className="inline-flex items-center gap-1.5 text-xs font-medium px-4 py-2 rounded-lg bg-[var(--primary)] text-[var(--primary-fg)] disabled:opacity-50 cursor-pointer"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>{savingVoice ? '保存中…' : '保存语音配置'}</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Tab 3: Firmware OTA */}
        {tab === 'ota' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="text-xs text-[var(--fg-muted)]">
                共 {firmwares.length} 个已发布固件包，设备按上报板型自动匹配最新版本。
              </div>
              <button
                type="button"
                onClick={() => setShowUploadForm((s) => !s)}
                className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-[var(--primary)] text-[var(--primary-fg)] cursor-pointer"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>{showUploadForm ? '收起上传' : '上传新固件'}</span>
              </button>
            </div>

            {showUploadForm && (
              <div className="card-subtle p-4 space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <Field label="固件名称">
                    <input
                      className="w-full px-3 py-1.5 text-xs rounded-lg border border-[var(--border)] bg-[var(--surface)]"
                      value={fwName}
                      onChange={(e) => setFwName(e.target.value)}
                      placeholder="例如：Pod 1.75C 在线待机版"
                    />
                  </Field>
                  <Field label="硬件板型">
                    <select
                      className="w-full px-3 py-1.5 text-xs rounded-lg border border-[var(--border)] bg-[var(--surface)]"
                      value={fwType}
                      onChange={(e) => setFwType(e.target.value)}
                    >
                      {boardTypes.map((t) => (
                        <option key={t.key} value={t.key}>
                          {t.name} ({t.key})
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="版本号 (SemVer)">
                    <input
                      className="w-full px-3 py-1.5 text-xs font-mono rounded-lg border border-[var(--border)] bg-[var(--surface)]"
                      value={fwVersion}
                      onChange={(e) => setFwVersion(e.target.value)}
                      placeholder="例如：0.2.2"
                    />
                  </Field>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field label="更新说明">
                    <input
                      className="w-full px-3 py-1.5 text-xs rounded-lg border border-[var(--border)] bg-[var(--surface)]"
                      value={fwRemark}
                      onChange={(e) => setFwRemark(e.target.value)}
                      placeholder="简述本次固件变更"
                    />
                  </Field>
                  <Field label="固件文件 (.bin)">
                    <input
                      type="file"
                      accept=".bin,.apk"
                      onChange={(e) => setFwFile(e.target.files?.[0] || null)}
                      className="w-full text-xs"
                    />
                  </Field>
                </div>
                <div className="flex justify-end">
                  <button
                    type="button"
                    disabled={uploadingFw}
                    onClick={handleUploadFirmware}
                    className="text-xs font-medium px-4 py-2 rounded-lg bg-[var(--primary)] text-[var(--primary-fg)] disabled:opacity-50 cursor-pointer"
                  >
                    {uploadingFw ? '上传发布中…' : '发布固件'}
                  </button>
                </div>
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="border-b border-[var(--border)] text-[var(--fg-muted)] text-left">
                    <th className="py-2 pr-3 font-medium">版本</th>
                    <th className="py-2 pr-3 font-medium">板型</th>
                    <th className="py-2 pr-3 font-medium">名称与说明</th>
                    <th className="py-2 pr-3 font-medium">大小</th>
                    <th className="py-2 pr-3 font-medium">发布时间</th>
                    <th className="py-2 text-right font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {firmwares.map((fw) => (
                    <tr key={fw.id} className="border-b border-[var(--border)]/60">
                      <td className="py-2.5 pr-3 font-mono font-semibold">{fw.version}</td>
                      <td className="py-2.5 pr-3 font-mono">{fw.type}</td>
                      <td className="py-2.5 pr-3">
                        <div className="font-medium">{fw.firmwareName}</div>
                        {fw.remark && <div className="text-[11px] text-[var(--fg-muted)]">{fw.remark}</div>}
                      </td>
                      <td className="py-2.5 pr-3 font-mono">{formatFileSize(fw.size)}</td>
                      <td className="py-2.5 pr-3 text-[var(--fg-muted)]">{formatDateTime(fw.createDate)}</td>
                      <td className="py-2.5 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => handleDownloadFirmware(fw.id)}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded hover:bg-[var(--surface-subtle)] cursor-pointer"
                        >
                          <Download className="w-3.5 h-3.5" />
                          <span>下载</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteFirmware(fw.id)}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded text-red-500 hover:bg-red-500/10 cursor-pointer ml-1"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {firmwares.length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-6 text-center text-[var(--fg-muted)]">
                        暂无固件包
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Tab 4: Fleet & Users */}
        {tab === 'fleet' && (
          <div className="space-y-4">
            <div className="inline-flex p-1 rounded-xl bg-[var(--surface-subtle)] border border-[var(--border)]">
              <button
                type="button"
                onClick={() => setFleetMode('devices')}
                className={`px-3 py-1 rounded-lg text-xs font-medium cursor-pointer ${
                  fleetMode === 'devices' ? 'bg-[var(--surface)] shadow-xs' : 'text-[var(--fg-muted)]'
                }`}
              >
                全量 Pod ({deviceTotal})
              </button>
              <button
                type="button"
                onClick={() => setFleetMode('users')}
                className={`px-3 py-1 rounded-lg text-xs font-medium cursor-pointer ${
                  fleetMode === 'users' ? 'bg-[var(--surface)] shadow-xs' : 'text-[var(--fg-muted)]'
                }`}
              >
                IDONE 用户 ({userTotal})
              </button>
            </div>

            {fleetMode === 'devices' ? (
              <div className="overflow-x-auto">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-[var(--border)] text-[var(--fg-muted)] text-left">
                      <th className="py-2 pr-3 font-medium">设备名称</th>
                      <th className="py-2 pr-3 font-medium">MAC</th>
                      <th className="py-2 pr-3 font-medium">实时状态</th>
                      <th className="py-2 pr-3 font-medium">板型 / 固件</th>
                      <th className="py-2 pr-3 font-medium">归属用户</th>
                      <th className="py-2 text-right font-medium">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {devices.map((d) => {
                      const live = runtime?.sessions?.[(d.macAddress || '').toLowerCase()];
                      return (
                        <tr key={d.id} className="border-b border-[var(--border)]/60">
                          <td className="py-2.5 pr-3 font-medium">{d.alias || '-'}</td>
                          <td className="py-2.5 pr-3 font-mono">{d.macAddress}</td>
                          <td className="py-2.5 pr-3">
                            <LiveBadge
                              state={live?.state ?? 'offline'}
                              lastConnectedAt={d.lastConnectedAtTimestamp}
                            />
                          </td>
                          <td className="py-2.5 pr-3 font-mono">
                            {d.board || '-'} · v{d.appVersion || '-'}
                          </td>
                          <td className="py-2.5 pr-3">{d.bindUserName || '-'}</td>
                          <td className="py-2.5 text-right">
                            <button
                              type="button"
                              onClick={() => handleForceUnbind(d.id)}
                              className="text-xs px-2.5 py-1 rounded-lg border border-red-500/35 bg-red-500/10 text-red-600 dark:text-red-400 cursor-pointer"
                            >
                              强制解绑
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-[var(--border)] text-[var(--fg-muted)] text-left">
                      <th className="py-2 pr-3 font-medium">IDONE 账号</th>
                      <th className="py-2 pr-3 font-medium">绑定 Pod</th>
                      <th className="py-2 pr-3 font-medium">状态</th>
                      <th className="py-2 pr-3 font-medium">注册时间</th>
                      <th className="py-2 text-right font-medium">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((u) => (
                      <tr key={u.userid} className="border-b border-[var(--border)]/60">
                        <td className="py-2.5 pr-3 font-medium">{u.mobile}</td>
                        <td className="py-2.5 pr-3">{u.deviceCount} 台</td>
                        <td className="py-2.5 pr-3">
                          <span
                            className={`text-[11px] px-2 py-0.5 rounded-full ${
                              u.status === 1
                                ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                                : 'bg-red-500/15 text-red-600 dark:text-red-400'
                            }`}
                          >
                            {u.status === 1 ? '正常' : '已停用'}
                          </span>
                        </td>
                        <td className="py-2.5 pr-3 text-[var(--fg-muted)]">
                          {formatDateTime(u.createDate)}
                        </td>
                        <td className="py-2.5 text-right">
                          <button
                            type="button"
                            onClick={() => handleToggleUserStatus(u)}
                            className="text-xs px-2.5 py-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--surface-subtle)] cursor-pointer"
                          >
                            {u.status === 1 ? '停用' : '启用'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Tab 5: Nodes & Core Params */}
        {tab === 'nodes' && (
          <div className="space-y-4">
            <div className="card-subtle p-4 space-y-3">
              <div className="text-xs font-semibold">WebSocket 语音节点</div>
              {wsServers.length === 0 ? (
                <p className="text-xs text-[var(--fg-muted)] m-0">未配置 server.websocket</p>
              ) : (
                <div className="space-y-2.5">
                  {wsServers.map((ws) => (
                    <div
                      key={ws}
                      className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-xl border border-[var(--border)] bg-[var(--surface)]"
                    >
                      <span className="text-xs font-mono">{ws}</span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleWsAction(ws, 'update_config')}
                          className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border border-[var(--border)] cursor-pointer"
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                          <span>重载配置</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleWsAction(ws, 'restart')}
                          className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border border-red-500/35 bg-red-500/10 text-red-600 dark:text-red-400 cursor-pointer"
                        >
                          <RotateCw className="w-3.5 h-3.5" />
                          <span>重启节点</span>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="card-subtle p-4 space-y-3">
              <div className="text-xs font-semibold">基础设施核心参数（仅保留 4 项必要配置）</div>
              <div className="space-y-3">
                {coreParams.map((p, idx) => (
                  <div
                    key={p.id}
                    className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-center"
                  >
                    <div className="sm:col-span-4">
                      <div className="text-xs font-mono font-semibold">{p.paramCode}</div>
                      {p.remark && (
                        <div className="text-[11px] text-[var(--fg-muted)] truncate">{p.remark}</div>
                      )}
                    </div>
                    <input
                      className="sm:col-span-6 px-3 py-1.5 text-xs font-mono rounded-lg border border-[var(--border)] bg-[var(--surface)]"
                      value={p.paramValue}
                      onChange={(e) =>
                        setCoreParams((prev) =>
                          prev.map((item, i) =>
                            i === idx ? { ...item, paramValue: e.target.value } : item,
                          ),
                        )
                      }
                    />
                    <div className="sm:col-span-2 flex justify-end">
                      <button
                        type="button"
                        onClick={() => handleSaveCoreParam(p)}
                        className="text-xs font-medium px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--surface-subtle)] cursor-pointer"
                      >
                        保存
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}

function KpiCard({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="card-subtle p-3.5">
      <div className="text-[11.5px] text-[var(--fg-muted)]">{label}</div>
      <div className="text-2xl font-bold mt-1 tabular-nums">{value}</div>
      <div className="text-[11px] text-[var(--fg-muted)] mt-0.5">{sub}</div>
    </div>
  );
}

function CheckBox({ ok, title, detail }: { ok: boolean; title: string; detail: string }) {
  return (
    <div className="p-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] space-y-1">
      <div className="flex items-center gap-2 font-medium">
        <span className={`w-2 h-2 rounded-full ${ok ? 'bg-emerald-500' : 'bg-amber-500'}`} />
        <span>{title}</span>
      </div>
      <div className="text-[11px] text-[var(--fg-muted)] font-mono truncate">{detail}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-[11.5px] text-[var(--fg-muted)] block">{label}</label>
      {children}
    </div>
  );
}
