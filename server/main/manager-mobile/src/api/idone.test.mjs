import assert from 'node:assert/strict'
import test from 'node:test'
import { authUrl, postAuth } from './idone.mjs'

test('mobile uses the same-origin callback and exchanges the cookie exactly once', async () => {
  const calls = []
  const fetcher = async (...args) => {
    calls.push(args)
    return { ok: true, json: async () => ({ code: 0, data: { token: 'application-token' } }) }
  }
  assert.equal(authUrl('/xiaozhi', 'https://xiaozhi.test', 'idone/login'), 'https://xiaozhi.test/xiaozhi/user/idone/login')
  assert.deepEqual(await postAuth('/xiaozhi', 'https://xiaozhi.test', 'idone/exchange', undefined, fetcher), { token: 'application-token' })
  assert.equal(calls.length, 1)
  assert.equal(calls[0][1].credentials, 'same-origin')
  assert.equal(calls[0][1].cache, 'no-store')
  assert.deepEqual(calls[0][1].headers, {})
})

test('mobile rejects cross-origin API configuration', () => {
  assert.throws(() => authUrl('https://other.test/xiaozhi', 'https://xiaozhi.test', 'idone/login'), /该服务器/)
})

test('mobile does not replay a consumed or lost exchange', async () => {
  let calls = 0
  const fetcher = async () => { calls++; throw new Error('lost response') }
  await assert.rejects(postAuth('/xiaozhi', 'https://xiaozhi.test', 'idone/exchange', undefined, fetcher), /lost response/)
  assert.equal(calls, 1)
  await assert.rejects(postAuth('/xiaozhi', 'https://xiaozhi.test', 'idone/exchange', undefined, async () => ({
    ok: true, json: async () => ({ code: 400, msg: '登录已失效' }),
  })), /登录已失效/)
})

test('mobile logout authenticates with the application token and accepts an expired session', async () => {
  await postAuth('/xiaozhi', 'https://xiaozhi.test', 'logout', 'application-token', async (url, options) => {
    assert.equal(options.headers.Authorization, 'Bearer application-token')
    assert.equal(url, 'https://xiaozhi.test/xiaozhi/user/logout')
    return { ok: true, json: async () => ({ code: 401 }) }
  })
})
