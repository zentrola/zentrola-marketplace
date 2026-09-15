import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import http from 'node:http'
import readline from 'node:readline'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const script = fileURLToPath(new URL('../scripts/zusage-mcp.mjs', import.meta.url))
const protocolVersion = '2025-06-18'
const emptyClientEnvironment = {
  OPENAI_BASE_URL: '',
  OPENAI_API_KEY: '',
  ANTHROPIC_BASE_URL: '',
  ANTHROPIC_API_KEY: '',
}

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
}

function close(server) {
  return new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  )
}

async function startApi(t, handler) {
  const server = http.createServer(handler)
  await listen(server)
  t.after(() => close(server))
  return server
}

function respondJson(response, body, statusCode = 200) {
  response.statusCode = statusCode
  response.setHeader('Content-Type', 'application/json')
  response.end(JSON.stringify(body))
}

function successBody() {
  return {
    code: 'OK',
    data: {
      tokens: 156000,
      from: '2026-09-01T00:00:00Z',
      to: '2026-09-15T03:20:00Z',
    },
  }
}

function startMcp(t, clientEnvironment = {}) {
  const child = spawn(process.execPath, [script], {
    env: {
      ...process.env,
      ...emptyClientEnvironment,
      ...clientEnvironment,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  t.after(() => child.kill())

  let stderr = ''
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk) => {
    stderr += chunk
  })

  const pending = new Map()
  const lines = readline.createInterface({ input: child.stdout })
  lines.on('line', (line) => {
    const message = JSON.parse(line)
    const entry = pending.get(message.id)
    if (entry) {
      pending.delete(message.id)
      entry.resolve(message)
    }
  })

  const rpc = (id, method, params = {}) =>
    new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(id)
        reject(new Error(`MCP response ${id} timed out${stderr ? `: ${stderr.trim()}` : ''}`))
      }, 5000)
      pending.set(id, {
        resolve: (message) => {
          clearTimeout(timeout)
          resolve(message)
        },
      })
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
    })

  return { rpc }
}

async function initialize(rpc, requestedVersion = protocolVersion) {
  return rpc(1, 'initialize', { protocolVersion: requestedVersion })
}

async function callUsage(rpc) {
  return rpc(3, 'tools/call', { name: 'get_usage', arguments: {} })
}

async function testEnvironment(t, clientEnvironment) {
  let authorization = ''
  const api = await startApi(t, (request, response) => {
    authorization = request.headers.authorization ?? ''
    assert.equal(request.method, 'GET')
    assert.equal(request.url, '/api/v1/me/usage')
    respondJson(response, successBody())
  })
  const { port } = api.address()
  const { rpc } = startMcp(t, clientEnvironment(port))

  const initialized = await initialize(rpc)
  assert.equal(initialized.result.protocolVersion, protocolVersion)
  assert.equal(initialized.result.serverInfo.name, 'zentrola-usage')

  const listed = await rpc(2, 'tools/list')
  assert.deepEqual(listed.result.tools.map(({ name }) => name), ['get_usage'])
  assert.deepEqual(listed.result.tools[0].outputSchema, {
    type: 'object',
    properties: {
      tokens: { type: 'integer', minimum: 0 },
      from: { type: 'string' },
      to: { type: 'string' },
    },
    required: ['tokens', 'from', 'to'],
    additionalProperties: false,
  })

  const called = await callUsage(rpc)
  assert.deepEqual(called.result.structuredContent, successBody().data)
  assert.match(called.result.content[0].text, /Current-month token usage: 156,000/)
  assert.equal(authorization, 'Bearer vk-test-key')
}

test('get_usage reuses the existing OpenAI-compatible environment', async (t) => {
  await testEnvironment(t, (port) => ({
    OPENAI_BASE_URL: `http://127.0.0.1:${port}/v1`,
    OPENAI_API_KEY: 'vk-test-key',
  }))
})

test('get_usage reuses the existing Anthropic-compatible environment', async (t) => {
  await testEnvironment(t, (port) => ({
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}/anthropic`,
    ANTHROPIC_API_KEY: 'vk-test-key',
  }))
})

test('initialize reports the supported protocol version instead of echoing an unknown version', async (t) => {
  const { rpc } = startMcp(t)
  const initialized = await initialize(rpc, '2099-01-01')
  assert.equal(initialized.result.protocolVersion, protocolVersion)
})

test('get_usage reports a missing client environment', async (t) => {
  const { rpc } = startMcp(t)
  await initialize(rpc)
  const called = await callUsage(rpc)
  assert.equal(called.result.isError, true)
  assert.match(called.result.content[0].text, /No complete Zentrola client environment/)
})

test('get_usage rejects an invalid base URL without exposing the key', async (t) => {
  const { rpc } = startMcp(t, {
    OPENAI_BASE_URL: 'not-a-url',
    OPENAI_API_KEY: 'vk-secret-value',
  })
  await initialize(rpc)
  const called = await callUsage(rpc)
  assert.equal(called.result.isError, true)
  assert.match(called.result.content[0].text, /Base URL is invalid/)
  assert.doesNotMatch(called.result.content[0].text, /vk-secret-value/)
})

test('get_usage reports HTTP status and service error code', async (t) => {
  const api = await startApi(t, (_request, response) => {
    respondJson(response, { code: 'INVALID_ACCESS_KEY' }, 401)
  })
  const { port } = api.address()
  const { rpc } = startMcp(t, {
    OPENAI_BASE_URL: `http://127.0.0.1:${port}/v1`,
    OPENAI_API_KEY: 'vk-test-key',
  })
  await initialize(rpc)
  const called = await callUsage(rpc)
  assert.equal(called.result.isError, true)
  assert.match(called.result.content[0].text, /HTTP 401, error code INVALID_ACCESS_KEY/)
})

test('get_usage rejects an unreadable response', async (t) => {
  const api = await startApi(t, (_request, response) => {
    response.setHeader('Content-Type', 'text/plain')
    response.end('not-json')
  })
  const { port } = api.address()
  const { rpc } = startMcp(t, {
    OPENAI_BASE_URL: `http://127.0.0.1:${port}/v1`,
    OPENAI_API_KEY: 'vk-test-key',
  })
  await initialize(rpc)
  const called = await callUsage(rpc)
  assert.equal(called.result.isError, true)
  assert.match(called.result.content[0].text, /unreadable response \(HTTP 200\)/)
})

test('get_usage rejects invalid usage data', async (t) => {
  const api = await startApi(t, (_request, response) => {
    respondJson(response, {
      code: 'OK',
      data: { tokens: '156000', from: '2026-09-01T00:00:00Z', to: 'invalid' },
    })
  })
  const { port } = api.address()
  const { rpc } = startMcp(t, {
    OPENAI_BASE_URL: `http://127.0.0.1:${port}/v1`,
    OPENAI_API_KEY: 'vk-test-key',
  })
  await initialize(rpc)
  const called = await callUsage(rpc)
  assert.equal(called.result.isError, true)
  assert.match(called.result.content[0].text, /invalid usage data/)
})

test('get_usage prefers the OpenAI-compatible pair when both pairs are complete', async (t) => {
  let openAiCalls = 0
  let anthropicCalls = 0
  const openAiApi = await startApi(t, (_request, response) => {
    openAiCalls += 1
    respondJson(response, successBody())
  })
  const anthropicApi = await startApi(t, (_request, response) => {
    anthropicCalls += 1
    respondJson(response, successBody())
  })
  const { rpc } = startMcp(t, {
    OPENAI_BASE_URL: `http://127.0.0.1:${openAiApi.address().port}/v1`,
    OPENAI_API_KEY: 'vk-test-key',
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${anthropicApi.address().port}/anthropic`,
    ANTHROPIC_API_KEY: 'vk-other-key',
  })
  await initialize(rpc)
  const called = await callUsage(rpc)
  assert.equal(called.result.isError, undefined)
  assert.equal(openAiCalls, 1)
  assert.equal(anthropicCalls, 0)
})
