import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import http from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import readline from 'node:readline'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const script = fileURLToPath(new URL('../scripts/zusage-mcp.mjs', import.meta.url))
const pluginRoot = fileURLToPath(new URL('..', import.meta.url))
const protocolVersion = '2025-06-18'
const emptyClientEnvironment = {
  CODEX_HOME: join(tmpdir(), 'zusage-mcp-test-no-codex'),
  CLAUDE_CONFIG_DIR: join(tmpdir(), 'zusage-mcp-test-no-claude'),
  OPENAI_BASE_URL: '',
  OPENAI_API_KEY: '',
  ANTHROPIC_BASE_URL: '',
  ANTHROPIC_AUTH_TOKEN: '',
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

function startMcp(t, client, clientEnvironment = {}) {
  const args = [script]
  if (client) args.push(`--client=${client}`)
  const child = spawn(process.execPath, args, {
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

async function callUsage(rpc, argumentsValue = {}) {
  return rpc(3, 'tools/call', { name: 'get_usage', arguments: argumentsValue })
}

async function testEnvironment(t, client, clientEnvironment) {
  let authorization = ''
  const api = await startApi(t, (request, response) => {
    authorization = request.headers.authorization ?? ''
    assert.equal(request.method, 'GET')
    assert.equal(request.url, '/api/v1/me/usage')
    respondJson(response, successBody())
  })
  const { port } = api.address()
  const { rpc } = startMcp(t, client, { TZ: 'Asia/Shanghai', ...clientEnvironment(port) })

  const initialized = await initialize(rpc)
  assert.equal(initialized.result.protocolVersion, protocolVersion)
  assert.equal(initialized.result.serverInfo.name, 'zentrola-usage')

  const listed = await rpc(2, 'tools/list')
  assert.deepEqual(listed.result.tools.map(({ name }) => name), ['get_usage'])
  assert.deepEqual(listed.result.tools[0].inputSchema, {
    type: 'object',
    properties: {
      from: {
        type: 'string',
        format: 'date-time',
        description:
          'Inclusive range start as a UTC RFC3339 timestamp ending in Z. Must be provided together with to.',
      },
      to: {
        type: 'string',
        format: 'date-time',
        description:
          'Exclusive range end as a UTC RFC3339 timestamp ending in Z. Must be provided together with from.',
      },
    },
    additionalProperties: false,
  })
  assert.deepEqual(listed.result.tools[0].outputSchema, {
    type: 'object',
    properties: {
      tokens: { type: 'integer', minimum: 0 },
      from: { type: 'string' },
      to: { type: 'string' },
      timezone: { type: 'string' },
      fromLocal: { type: 'string' },
      toLocal: { type: 'string' },
    },
    required: ['tokens', 'from', 'to', 'timezone', 'fromLocal', 'toLocal'],
    additionalProperties: false,
  })

  const called = await callUsage(rpc)
  assert.deepEqual(called.result.structuredContent, {
    ...successBody().data,
    timezone: 'Asia/Shanghai',
    fromLocal: '2026-09-01T08:00:00+08:00',
    toLocal: '2026-09-15T11:20:00+08:00',
  })
  assert.match(called.result.content[0].text, /Current-month token usage: 156,000/)
  assert.match(
    called.result.content[0].text,
    /Reporting period start: 2026-09-01T08:00:00\+08:00 \(Asia\/Shanghai\)/,
  )
  assert.equal(authorization, 'Bearer vk-test-key')
}

test('get_usage reuses the existing OpenAI-compatible environment', async (t) => {
  await testEnvironment(t, 'codex', (port) => ({
    OPENAI_BASE_URL: `http://127.0.0.1:${port}/v1`,
    OPENAI_API_KEY: 'vk-test-key',
  }))
})

test('get_usage reuses the existing Anthropic-compatible environment', async (t) => {
  await testEnvironment(t, 'claude', (port) => ({
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}/anthropic`,
    ANTHROPIC_API_KEY: 'vk-test-key',
  }))
})

test('get_usage passes an explicit RFC3339 range to Zentrola', async (t) => {
  const from = '2026-09-01T00:00:00Z'
  const to = '2026-09-15T00:00:00Z'
  let requestedURL
  const api = await startApi(t, (request, response) => {
    requestedURL = new URL(request.url, 'http://127.0.0.1')
    respondJson(response, {
      code: 'OK',
      data: { tokens: 42000, from, to },
    })
  })
  const { rpc } = startMcp(t, 'codex', {
    TZ: 'Asia/Shanghai',
    OPENAI_BASE_URL: `http://127.0.0.1:${api.address().port}/v1`,
    OPENAI_API_KEY: 'vk-test-key',
  })
  await initialize(rpc)

  const called = await callUsage(rpc, { from, to })

  assert.equal(requestedURL.pathname, '/api/v1/me/usage')
  assert.equal(requestedURL.searchParams.get('from'), from)
  assert.equal(requestedURL.searchParams.get('to'), to)
  assert.deepEqual(called.result.structuredContent, {
    tokens: 42000,
    from,
    to,
    timezone: 'Asia/Shanghai',
    fromLocal: '2026-09-01T08:00:00+08:00',
    toLocal: '2026-09-15T08:00:00+08:00',
  })
  assert.match(called.result.content[0].text, /^Token usage: 42,000/m)
})

test('get_usage validates custom ranges before contacting Zentrola', async (t) => {
  let requestCount = 0
  const api = await startApi(t, (_request, response) => {
    requestCount += 1
    respondJson(response, successBody())
  })
  const { rpc } = startMcp(t, 'codex', {
    OPENAI_BASE_URL: `http://127.0.0.1:${api.address().port}/v1`,
    OPENAI_API_KEY: 'vk-test-key',
  })
  await initialize(rpc)

  const cases = [
    [{ from: '2026-09-01T00:00:00Z' }, /must be provided together/],
    [{ from: '2026-09-01', to: '2026-09-02' }, /UTC RFC3339 timestamp ending in Z/],
    [
      { from: '2026-09-01T08:00:00+08:00', to: '2026-09-02T08:00:00+08:00' },
      /UTC RFC3339 timestamp ending in Z/,
    ],
    [
      { from: '2026-09-02T00:00:00Z', to: '2026-09-01T00:00:00Z' },
      /to must be later than from/,
    ],
    [
      { from: '2025-01-01T00:00:00Z', to: '2026-09-01T00:00:00Z' },
      /must not exceed 366 days/,
    ],
    [
      { from: '2026-09-01T00:00:00Z', to: '2026-09-02T00:00:00Z', timezone: 'UTC' },
      /accepts only from and to/,
    ],
  ]
  for (const [argumentsValue, expectedError] of cases) {
    const called = await callUsage(rpc, argumentsValue)
    assert.equal(called.result.isError, true)
    assert.match(called.result.content[0].text, expectedError)
  }
  assert.equal(requestCount, 0)
})

test('get_usage dynamically rereads Codex config.toml and auth.json for every call', async (t) => {
  const codexHome = await mkdtemp(join(tmpdir(), 'zusage-codex-'))
  t.after(() => rm(codexHome, { recursive: true, force: true }))

  const requests = []
  const firstApi = await startApi(t, (request, response) => {
    requests.push({ server: 'first', authorization: request.headers.authorization })
    respondJson(response, successBody())
  })
  const secondApi = await startApi(t, (request, response) => {
    requests.push({ server: 'second', authorization: request.headers.authorization })
    respondJson(response, successBody())
  })

  const writeCodexCredentials = async (port, apiKey) => {
    await writeFile(
      join(codexHome, 'config.toml'),
      `model_provider = "custom"\n\n[model_providers.custom]\nrequires_openai_auth = true\nbase_url = "http://127.0.0.1:${port}/v1"\n`,
    )
    await writeFile(join(codexHome, 'auth.json'), JSON.stringify({ OPENAI_API_KEY: apiKey }))
  }

  await writeCodexCredentials(firstApi.address().port, 'vk-first-key')
  const { rpc } = startMcp(t, 'codex', { CODEX_HOME: codexHome })
  await initialize(rpc)
  assert.equal((await callUsage(rpc)).result.isError, undefined)

  await writeCodexCredentials(secondApi.address().port, 'vk-second-key')
  assert.equal((await callUsage(rpc)).result.isError, undefined)
  assert.deepEqual(requests, [
    { server: 'first', authorization: 'Bearer vk-first-key' },
    { server: 'second', authorization: 'Bearer vk-second-key' },
  ])
})

test('get_usage reads the existing Claude Code settings.json', async (t) => {
  const claudeHome = await mkdtemp(join(tmpdir(), 'zusage-claude-'))
  t.after(() => rm(claudeHome, { recursive: true, force: true }))
  let authorization = ''
  const api = await startApi(t, (request, response) => {
    authorization = request.headers.authorization ?? ''
    respondJson(response, successBody())
  })
  await writeFile(
    join(claudeHome, 'settings.json'),
    JSON.stringify({
      env: {
        ANTHROPIC_BASE_URL: `http://127.0.0.1:${api.address().port}/anthropic`,
        ANTHROPIC_AUTH_TOKEN: 'vk-claude-key',
      },
    }),
  )
  const { rpc } = startMcp(t, 'claude', {
    CLAUDE_CONFIG_DIR: claudeHome,
  })
  await initialize(rpc)
  assert.equal((await callUsage(rpc)).result.isError, undefined)
  assert.equal(authorization, 'Bearer vk-claude-key')
})

test('initialize reports the supported protocol version instead of echoing an unknown version', async (t) => {
  const { rpc } = startMcp(t)
  const initialized = await initialize(rpc, '2099-01-01')
  assert.equal(initialized.result.protocolVersion, protocolVersion)
})

test('get_usage reports a missing client configuration', async (t) => {
  const { rpc } = startMcp(t, 'codex')
  await initialize(rpc)
  const called = await callUsage(rpc)
  assert.equal(called.result.isError, true)
  assert.match(called.result.content[0].text, /No complete Zentrola Codex configuration/)
})

test('get_usage rejects an invalid base URL without exposing the key', async (t) => {
  const { rpc } = startMcp(t, 'codex', {
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
  const { rpc } = startMcp(t, 'codex', {
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
  const { rpc } = startMcp(t, 'codex', {
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
  const { rpc } = startMcp(t, 'codex', {
    OPENAI_BASE_URL: `http://127.0.0.1:${port}/v1`,
    OPENAI_API_KEY: 'vk-test-key',
  })
  await initialize(rpc)
  const called = await callUsage(rpc)
  assert.equal(called.result.isError, true)
  assert.match(called.result.content[0].text, /invalid usage data/)
})

test('get_usage keeps Codex and Claude Code credentials isolated', async (t) => {
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
  const sharedEnvironment = {
    OPENAI_BASE_URL: `http://127.0.0.1:${openAiApi.address().port}/v1`,
    OPENAI_API_KEY: 'vk-test-key',
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${anthropicApi.address().port}/anthropic`,
    ANTHROPIC_API_KEY: 'vk-other-key',
  }

  const { rpc: codexRpc } = startMcp(t, 'codex', {
    ...sharedEnvironment,
  })
  await initialize(codexRpc)
  assert.equal((await callUsage(codexRpc)).result.isError, undefined)
  assert.equal(openAiCalls, 1)
  assert.equal(anthropicCalls, 0)

  const { rpc: claudeRpc } = startMcp(t, 'claude', {
    ...sharedEnvironment,
  })
  await initialize(claudeRpc)
  assert.equal((await callUsage(claudeRpc)).result.isError, undefined)
  assert.equal(openAiCalls, 1)
  assert.equal(anthropicCalls, 1)
})

test('get_usage requires an explicit client argument', async (t) => {
  const { rpc } = startMcp(t, undefined, {
    OPENAI_BASE_URL: 'https://example.invalid/v1',
    OPENAI_API_KEY: 'vk-test-key',
  })
  await initialize(rpc)
  const called = await callUsage(rpc)
  assert.equal(called.result.isError, true)
  assert.match(called.result.content[0].text, /must provide exactly one --client/)
})

test('client-specific MCP manifests pass explicit launch arguments', async () => {
  const portablePlugin = JSON.parse(await readFile(join(pluginRoot, 'plugin.json'), 'utf8'))
  const codexCompatibilityPlugin = JSON.parse(
    await readFile(join(pluginRoot, '.codex-plugin', 'plugin.json'), 'utf8'),
  )
  const claudePlugin = JSON.parse(
    await readFile(join(pluginRoot, '.claude-plugin', 'plugin.json'), 'utf8'),
  )
  const codexManifest = JSON.parse(await readFile(join(pluginRoot, 'mcp.json'), 'utf8'))
  const claudeManifest = JSON.parse(await readFile(join(pluginRoot, '.mcp.json'), 'utf8'))

  assert.equal(
    portablePlugin.version,
    codexCompatibilityPlugin.version,
    'Codex portable and compatibility manifest versions must stay in sync',
  )
  assert.equal(portablePlugin.name, 'zentrola')
  assert.equal(codexCompatibilityPlugin.name, 'zentrola')
  assert.equal(claudePlugin.name, 'zentrola')
  assert.deepEqual(codexCompatibilityPlugin.mcpServers.zentrola_usage, {
    type: 'stdio',
    command: 'node',
    args: ['./scripts/zusage-mcp.mjs', '--client=codex'],
    cwd: './',
  })
  assert.equal(
    portablePlugin.$schema,
    'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json',
  )
  assert.deepEqual(codexManifest.mcpServers.zentrola_usage, {
    type: 'stdio',
    command: 'node',
    args: ['./scripts/zusage-mcp.mjs', '--client=codex'],
    cwd: './',
  })
  assert.deepEqual(claudeManifest.mcpServers.zentrola_usage.args, [
    '${CLAUDE_PLUGIN_ROOT}/scripts/zusage-mcp.mjs',
    '--client=claude',
  ])
})
