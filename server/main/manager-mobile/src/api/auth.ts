import { http } from '@/http/request/alova'
import { getEnvBaseUrl } from '@/utils'
import { authUrl, postAuth } from './idone.mjs'

// 登录响应数据类型
export interface LoginResponse {
  token: string
  expire: number
  clientHash: string
}

// 用户信息响应数据类型
export interface UserInfo {
  id: number
  username: string
  realName: string
  email: string
  mobile: string
  status: number
  superAdmin: number
}

// 公共配置响应数据类型
export interface PublicConfig {
  loginMethod: 'idone'
  idoneEnabled: boolean
  enableMobileRegister: boolean
  version: string
  year: string
  allowUserRegister: boolean
  beianIcpNum: string
  beianGaNum: string
  name: string
}

// 获取用户信息
export function getUserInfo() {
  return http.Get<UserInfo>('/user/info', {
    meta: {
      ignoreAuth: false,
      toast: false,
    },
  })
}

// 获取公共配置
export function getPublicConfig() {
  return http.Get<PublicConfig>('/user/pub-config', {
    meta: {
      ignoreAuth: true,
      toast: false,
    },
  })
}

// 浏览器端共用服务端 OIDC 回调，通过 Cookie 一次性交换应用 Token。
export function startIdoneLogin() {
  // #ifdef H5
  window.location.assign(`${authUrl(getEnvBaseUrl(), window.location.origin, 'idone/login')}?client=mobile`)
  return
  // #endif
  // #ifndef H5
  throw new Error('请使用移动网页完成 IDONE 登录')
  // #endif
}

export async function exchangeIdoneToken(): Promise<LoginResponse> {
  // #ifdef H5
  return postAuth(getEnvBaseUrl(), window.location.origin, 'idone/exchange')
  // #endif
  // #ifndef H5
  throw new Error('请使用移动网页完成 IDONE 登录')
  // #endif
}

export async function logout() {
  // #ifdef H5
  const token = JSON.parse(uni.getStorageSync('xiaozhi-mobile-token') || '{}').token
  await postAuth(getEnvBaseUrl(), window.location.origin, 'logout', token)
  return
  // #endif
  // #ifndef H5
  return http.Post('/user/logout', {}, { meta: { toast: false } })
  // #endif
}
