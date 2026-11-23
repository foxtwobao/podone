// 跳转 IDONE 登录会离开本站，登录前要去的页面暂存在 sessionStorage，回调后取回。
const KEY = 'loginRedirect';

// 只接受站内路由路径，防止被拼成跳到其他站点的地址。
const isSafe = path => typeof path === 'string' && path.startsWith('/') && !path.startsWith('//') && !path.includes('\\');

export function saveLoginRedirect(path) {
  if (isSafe(path)) sessionStorage.setItem(KEY, path);
  else sessionStorage.removeItem(KEY);
}

export function takeLoginRedirect(fallback) {
  const path = sessionStorage.getItem(KEY);
  sessionStorage.removeItem(KEY);
  return isSafe(path) ? path : fallback;
}
