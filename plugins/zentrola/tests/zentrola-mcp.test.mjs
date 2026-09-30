import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import http from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import readline from 'node:readline'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const script = fileURLToPath(new URL('../scripts/zentrola-mcp.mjs', import.meta.url))
const pluginRoot = fileURLToPath(new URL('..', import.meta.url))
const protocolVersion = '2025-06-18'
const emptyClientEnvironment = {
  CODEX_HOME: join(tmpdir(), 'zentrola-mcp-test-no-codex'),
  CLAUDE_CONFIG_DIR: join(tmpdir(), 'zentrola-mcp-test-no-claude'),
  OPENAI_BASE_URL: '',
  OPENAI_API_KEY: '',
  ANTHROPIC_BASE_URL: '',
  ANTHROPIC_AUTH_TOKEN: '',
  ANTHROPIC_API_KEY: '',
  ZENTROLA_BASE_URL: '',
  ZENTROLA_VIRTUAL_KEY: '',
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

async function callProvider(rpc, argumentsValue = { model: 'gpt-5.6-sol' }) {
  return rpc(4, 'tools/call', { name: 'get_provider', arguments: argumentsValue })
}

async function callImage(rpc, argumentsValue = { prompt: 'Draw an otter.' }) {
  return rpc(5, 'tools/call', { name: 'generate_image', arguments: argumentsValue })
}

async function readRequestBody(request) {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8')
}

async function testEnvironment(t, client, clientEnvironment, expectedKey = 'vk-test-key') {
  const requests = []
  const api = await startApi(t, (request, response) => {
    requests.push({
      method: request.method,
      url: request.url,
      authorization: request.headers.authorization ?? '',
    })
    assert.equal(request.method, 'GET')
    if (request.url === '/api/v1/me/usage') {
      respondJson(response, successBody())
      return
    }
    if (request.url === '/api/v1/me/provider?model=gpt-5.6-sol') {
      respondJson(response, { code: 'OK', data: { name: 'Zentrola' }, requestId: 'request-1' })
      return
    }
    respondJson(response, { code: 'NOT_FOUND' }, 404)
  })
  const { port } = api.address()
  const { rpc } = startMcp(t, client, { TZ: 'Asia/Shanghai', ...clientEnvironment(port) })

  const initialized = await initialize(rpc)
  assert.equal(initialized.result.protocolVersion, protocolVersion)
  assert.equal(initialized.result.serverInfo.name, 'zentrola')
  assert.match(initialized.result.instructions, /get_usage/)
  assert.match(initialized.result.instructions, /get_provider/)
  assert.match(initialized.result.instructions, /generate_image/)

  const listed = await rpc(2, 'tools/list')
  assert.deepEqual(listed.result.tools.map(({ name }) => name), [
    'get_usage',
    'get_provider',
    'generate_image',
  ])
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
  assert.deepEqual(listed.result.tools[1].inputSchema, {
    type: 'object',
    properties: {
      model: {
        type: 'string',
        minLength: 1,
        description: 'Model identifier to resolve, for example gpt-5.6-sol.',
      },
    },
    required: ['model'],
    additionalProperties: false,
  })
  assert.deepEqual(listed.result.tools[1].outputSchema, {
    type: 'object',
    properties: {
      name: { type: 'string' },
    },
    required: ['name'],
    additionalProperties: false,
  })
  assert.deepEqual(listed.result.tools[2].inputSchema, {
    type: 'object',
    properties: {
      prompt: {
        type: 'string',
        minLength: 1,
        description: 'A complete natural-language description of the image to generate.',
      },
      model: {
        type: 'string',
        minLength: 1,
        default: 'gpt-5.6-sol',
        description: 'Zentrola model identifier. Defaults to gpt-5.6-sol.',
      },
    },
    required: ['prompt'],
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
  const provider = await callProvider(rpc)
  assert.deepEqual(provider.result.structuredContent, { name: 'Zentrola' })
  assert.match(provider.result.content[0].text, /Current service provider: Zentrola/)
  assert.deepEqual(requests, [
    {
      method: 'GET',
      url: '/api/v1/me/usage',
      authorization: `Bearer ${expectedKey}`,
    },
    {
      method: 'GET',
      url: '/api/v1/me/provider?model=gpt-5.6-sol',
      authorization: `Bearer ${expectedKey}`,
    },
  ])
}

test('Zentrola tools reuse the existing OpenAI-compatible environment', async (t) => {
  await testEnvironment(t, 'codex', (port) => ({
    OPENAI_BASE_URL: `http://127.0.0.1:${port}/v1`,
    OPENAI_API_KEY: 'vk-test-key',
  }))
})

test('Zentrola tools reuse the existing Anthropic-compatible environment', async (t) => {
  await testEnvironment(t, 'claude', (port) => ({
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}/anthropic`,
    ANTHROPIC_API_KEY: 'vk-test-key',
  }))
})

test('Zentrola tools support the dedicated virtual key environment', async (t) => {
  await testEnvironment(t, 'codex', (port) => ({
    ZENTROLA_BASE_URL: `http://127.0.0.1:${port}/v1`,
    ZENTROLA_VIRTUAL_KEY: 'vk-dedicated-key',
  }), 'vk-dedicated-key')
})

test('generate_image streams a multi-megabyte SSE image from Zentrola', async (t) => {
  const png = Buffer.alloc(3 * 1024 * 1024 + 8, 0x5a)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png)
  const imageBase64 = png.toString('base64')
  const requests = []
  const api = await startApi(t, (request, response) => {
    void readRequestBody(request).then((body) => {
      requests.push({
        method: request.method,
        url: request.url,
        authorization: request.headers.authorization,
        accept: request.headers.accept,
        contentType: request.headers['content-type'],
        body: JSON.parse(body),
      })
      response.writeHead(200, { 'Content-Type': 'text/event-stream' })
      response.write(
        `event: response.image_generation_call.partial_image\ndata: ${JSON.stringify({ partial_image_b64: imageBase64 })}\n\n`,
      )
      response.write(
        `event: response.image_generation_call.completed\ndata: ${JSON.stringify({ type: 'response.image_generation_call.completed' })}\n\n`,
      )
      response.end('event: response.completed\ndata: {"type":"response.completed"}\n\n')
    })
  })
  const { rpc } = startMcp(t, 'codex', {
    OPENAI_BASE_URL: `http://127.0.0.1:${api.address().port}/v1`,
    OPENAI_API_KEY: 'vk-image-key',
  })
  await initialize(rpc)

  const called = await callImage(rpc, {
    prompt: '生成一张戴宇航员头盔的水獭插画，透明背景，1024×1024',
  })

  assert.equal(called.result.isError, undefined)
  assert.deepEqual(called.result.structuredContent, {
    model: 'gpt-5.6-sol',
    mimeType: 'image/png',
    bytes: png.length,
  })
  assert.match(called.result.content[0].text, /gpt-5\.6-sol/)
  assert.deepEqual(called.result.content[1], {
    type: 'image',
    data: imageBase64,
    mimeType: 'image/png',
  })
  assert.deepEqual(requests, [
    {
      method: 'POST',
      url: '/v1/responses',
      authorization: 'Bearer vk-image-key',
      accept: 'text/event-stream',
      contentType: 'application/json',
      body: {
        model: 'gpt-5.6-sol',
        input: '生成一张戴宇航员头盔的水獭插画，透明背景，1024×1024',
        tools: [{ type: 'image_generation' }],
        store: false,
        stream: true,
      },
    },
  ])
})

test('generate_image uses a completed result and normalizes the Claude base path', async (t) => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB', 'base64')
  let requestedURL = ''
  const api = await startApi(t, (request, response) => {
    requestedURL = request.url ?? ''
    request.resume()
    request.on('end', () => {
      response.writeHead(200, { 'Content-Type': 'text/event-stream' })
      response.end(
        'event: response.image_generation_call.completed\ndata: {}\n\n' +
          `event: response.completed\ndata: ${JSON.stringify({ response: { output: [{ type: 'image_generation_call', result: png.toString('base64') }] } })}\n\n`,
      )
    })
  })
  const { rpc } = startMcp(t, 'claude', {
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${api.address().port}/anthropic`,
    ANTHROPIC_API_KEY: 'vk-claude-image-key',
  })
  await initialize(rpc)

  const called = await callImage(rpc, { prompt: 'Draw a moon.', model: 'custom-image-model' })

  assert.equal(called.result.isError, undefined)
  assert.equal(called.result.structuredContent.model, 'custom-image-model')
  assert.equal(requestedURL, '/v1/responses')
})

test('generate_image validates arguments before contacting Zentrola', async (t) => {
  let requestCount = 0
  const api = await startApi(t, (_request, response) => {
    requestCount += 1
    respondJson(response, {}, 500)
  })
  const { rpc } = startMcp(t, 'codex', {
    OPENAI_BASE_URL: `http://127.0.0.1:${api.address().port}/v1`,
    OPENAI_API_KEY: 'vk-image-key',
  })
  await initialize(rpc)

  const cases = [
    [{}, /prompt must be a non-empty string/],
    [{ prompt: '  ' }, /prompt must be a non-empty string/],
    [{ prompt: 'image', model: '' }, /model must be a non-empty string/],
    [{ prompt: 'image', unexpected: true }, /accepts only prompt and model/],
  ]
  for (const [argumentsValue, expectedError] of cases) {
    const called = await callImage(rpc, argumentsValue)
    assert.equal(called.result.isError, true)
    assert.match(called.result.content[0].text, expectedError)
  }
  assert.equal(requestCount, 0)
})

test('generate_image reports Zentrola HTTP and SSE errors without exposing the key', async (t) => {
  const httpErrorApi = await startApi(t, (_request, response) => {
    respondJson(response, { code: 'IMAGE_GENERATION_DENIED' }, 403)
  })
  const { rpc: httpErrorRpc } = startMcp(t, 'codex', {
    OPENAI_BASE_URL: `http://127.0.0.1:${httpErrorApi.address().port}/v1`,
    OPENAI_API_KEY: 'vk-secret-image-key',
  })
  await initialize(httpErrorRpc)
  const httpError = await callImage(httpErrorRpc)
  assert.equal(httpError.result.isError, true)
  assert.match(httpError.result.content[0].text, /HTTP 403, error code IMAGE_GENERATION_DENIED/)
  assert.doesNotMatch(httpError.result.content[0].text, /vk-secret-image-key/)

  const sseErrorApi = await startApi(t, (request, response) => {
    request.resume()
    request.on('end', () => {
      response.writeHead(200, { 'Content-Type': 'text/event-stream' })
      response.end(
        'event: response.failed\ndata: {"error":{"message":"generation unavailable for vk-image-key"}}\n\n',
      )
    })
  })
  const { rpc: sseErrorRpc } = startMcp(t, 'codex', {
    OPENAI_BASE_URL: `http://127.0.0.1:${sseErrorApi.address().port}/v1`,
    OPENAI_API_KEY: 'vk-image-key',
  })
  await initialize(sseErrorRpc)
  const sseError = await callImage(sseErrorRpc)
  assert.equal(sseError.result.isError, true)
  assert.match(sseError.result.content[0].text, /generation unavailable/)
  assert.match(sseError.result.content[0].text, /\[redacted\]/)
  assert.doesNotMatch(sseError.result.content[0].text, /vk-image-key/)
})

test('generate_image rejects non-PNG image data', async (t) => {
  const api = await startApi(t, (request, response) => {
    request.resume()
    request.on('end', () => {
      response.writeHead(200, { 'Content-Type': 'text/event-stream' })
      response.end(
        `event: response.image_generation_call.completed\ndata: ${JSON.stringify({ result: Buffer.from('not a png').toString('base64') })}\n\n` +
          'event: response.completed\ndata: {}\n\n',
      )
    })
  })
  const { rpc } = startMcp(t, 'codex', {
    OPENAI_BASE_URL: `http://127.0.0.1:${api.address().port}/v1`,
    OPENAI_API_KEY: 'vk-image-key',
  })
  await initialize(rpc)
  const called = await callImage(rpc)
  assert.equal(called.result.isError, true)
  assert.match(called.result.content[0].text, /not a PNG/)
})

test('generate_image rejects an incomplete SSE stream', async (t) => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB', 'base64')
  const api = await startApi(t, (request, response) => {
    request.resume()
    request.on('end', () => {
      response.writeHead(200, { 'Content-Type': 'text/event-stream' })
      response.end(
        `event: response.image_generation_call.partial_image\ndata: ${JSON.stringify({ partial_image_b64: png.toString('base64') })}\n\n`,
      )
    })
  })
  const { rpc } = startMcp(t, 'codex', {
    OPENAI_BASE_URL: `http://127.0.0.1:${api.address().port}/v1`,
    OPENAI_API_KEY: 'vk-image-key',
  })
  await initialize(rpc)
  const called = await callImage(rpc)
  assert.equal(called.result.isError, true)
  assert.match(called.result.content[0].text, /ended before response\.completed/)
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

test('get_provider passes model and returns data.name from /api/v1/me/provider', async (t) => {
  const requests = []
  const api = await startApi(t, (request, response) => {
    requests.push({ url: request.url, authorization: request.headers.authorization })
    respondJson(response, {
      code: 'OK',
      data: { name: 'Zentrola China' },
      requestId: 'request-1',
    })
  })
  const { rpc } = startMcp(t, 'codex', {
    OPENAI_BASE_URL: `http://127.0.0.1:${api.address().port}/v1`,
    OPENAI_API_KEY: 'vk-test-key',
  })
  await initialize(rpc)

  const called = await callProvider(rpc, { model: 'gpt-5.6-sol' })

  assert.deepEqual(called.result.structuredContent, { name: 'Zentrola China' })
  assert.match(called.result.content[0].text, /Current service provider: Zentrola China/)
  assert.deepEqual(requests, [
    {
      url: '/api/v1/me/provider?model=gpt-5.6-sol',
      authorization: 'Bearer vk-test-key',
    },
  ])
})

test('get_provider reports HTTP status and service error code', async (t) => {
  const api = await startApi(t, (_request, response) => {
    respondJson(response, { code: 'INVALID_ACCESS_KEY', requestId: 'request-1' }, 401)
  })
  const { rpc } = startMcp(t, 'codex', {
    OPENAI_BASE_URL: `http://127.0.0.1:${api.address().port}/v1`,
    OPENAI_API_KEY: 'vk-test-key',
  })
  await initialize(rpc)

  const called = await callProvider(rpc)

  assert.equal(called.result.isError, true)
  assert.match(called.result.content[0].text, /HTTP 401, error code INVALID_ACCESS_KEY/)
})

test('get_provider rejects invalid provider data', async (t) => {
  const api = await startApi(t, (_request, response) => {
    respondJson(response, { code: 'OK', data: { name: '   ' }, requestId: 'request-1' })
  })
  const { rpc } = startMcp(t, 'codex', {
    OPENAI_BASE_URL: `http://127.0.0.1:${api.address().port}/v1`,
    OPENAI_API_KEY: 'vk-test-key',
  })
  await initialize(rpc)

  const called = await callProvider(rpc)

  assert.equal(called.result.isError, true)
  assert.match(called.result.content[0].text, /invalid provider data/)
})

test('get_provider validates model before contacting Zentrola', async (t) => {
  const { rpc } = startMcp(t, 'codex', {
    OPENAI_BASE_URL: 'https://unused.invalid/v1',
    OPENAI_API_KEY: 'vk-test-key',
  })
  await initialize(rpc)

  const cases = [
    [{}, /model must be a non-empty string/],
    [{ model: '' }, /model must be a non-empty string/],
    [{ model: 123 }, /model must be a non-empty string/],
    [{ model: 'gpt-5.6-sol', unexpected: true }, /accepts only model/],
  ]
  for (const [argumentsValue, expectedError] of cases) {
    const called = await callProvider(rpc, argumentsValue)
    assert.equal(called.result.isError, true)
    assert.match(called.result.content[0].text, expectedError)
  }
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
  assert.deepEqual(codexCompatibilityPlugin.mcpServers.zentrola, {
    type: 'stdio',
    command: 'node',
    args: ['./scripts/zentrola-mcp.mjs', '--client=codex'],
    cwd: './',
  })
  assert.equal(
    portablePlugin.$schema,
    'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json',
  )
  assert.deepEqual(codexManifest.mcpServers.zentrola, {
    type: 'stdio',
    command: 'node',
    args: ['./scripts/zentrola-mcp.mjs', '--client=codex'],
    cwd: './',
  })
  assert.deepEqual(claudeManifest.mcpServers.zentrola.args, [
    '${CLAUDE_PLUGIN_ROOT}/scripts/zentrola-mcp.mjs',
    '--client=claude',
  ])
})
