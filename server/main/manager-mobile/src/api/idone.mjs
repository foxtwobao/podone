export function authUrl(baseUrl, origin, path) {
  const url = new URL(`${baseUrl.replace(/\/$/, '')}/user/${path}`, origin)
  if (url.origin !== origin) throw new Error('请通过该服务器的 /mobile/ 页面使用 IDONE 登录')
  return url.href
}

export async function postAuth(baseUrl, origin, path, token = undefined, fetcher = fetch) {
  const response = await fetcher(authUrl(baseUrl, origin, path), {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  const result = await response.json()
  if (path === 'logout' && (response.status === 401 || [401, 10021].includes(result.code))) return
  if (!response.ok || result.code !== 0) throw new Error(result.msg || '登录失败，请重新登录')
  return result.data
}
