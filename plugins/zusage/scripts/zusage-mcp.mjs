#!/usr/bin/env node

import process from 'node:process'

const protocolVersion = '2025-06-18'
const serverInfo = { name: 'zentrola-usage', version: '0.1.0' }
const tool = {
  name: 'get_usage',
  title: 'Get Zentrola usage',
  description:
    "Query the current-month token usage and reporting period for the user associated with the active Zentrola Access Key.",
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  outputSchema: {
    type: 'object',
    properties: {
      tokens: { type: 'integer', minimum: 0 },
      from: { type: 'string' },
      to: { type: 'string' },
    },
    required: ['tokens', 'from', 'to'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

function pairFromEnvironment() {
  const pairs = [
    {
      baseURL: process.env.OPENAI_BASE_URL,
      apiKey: process.env.OPENAI_API_KEY,
      suffix: '/v1',
    },
    {
      baseURL: process.env.ANTHROPIC_BASE_URL,
      apiKey: process.env.ANTHROPIC_API_KEY,
      suffix: '/anthropic',
    },
  ]
  const pair = pairs.find(({ baseURL, apiKey }) => baseURL?.trim() && apiKey?.trim())
  if (!pair) {
    throw new Error(
      'No complete Zentrola client environment was detected. Ensure the client process inherits OPENAI_* or ANTHROPIC_* variables that point to Zentrola, then restart the client.',
    )
  }
  return { ...pair, baseURL: pair.baseURL.trim(), apiKey: pair.apiKey.trim() }
}

function usageEndpoint(baseURL, suffix) {
  let url
  try {
    url = new URL(baseURL)
  } catch {
    throw new Error('The Zentrola Base URL is invalid.')
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('The Zentrola Base URL must be an HTTP(S) URL without embedded credentials.')
  }
  url.search = ''
  url.hash = ''
  let path = url.pathname.replace(/\/+$/, '')
  if (path.toLowerCase().endsWith(suffix)) {
    path = path.slice(0, -suffix.length)
  }
  url.pathname = `${path}/api/v1/me/usage`.replace(/\/{2,}/g, '/')
  return url
}

async function getUsage() {
  const { baseURL, apiKey, suffix } = pairFromEnvironment()
  const endpoint = usageEndpoint(baseURL, suffix)
  let response
  try {
    response = await fetch(endpoint, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10_000),
    })
  } catch (error) {
    if (error?.name === 'TimeoutError') {
      throw new Error('The connection to Zentrola timed out.')
    }
    throw new Error('Unable to connect to the Zentrola service.')
  }

  let body
  try {
    body = await response.json()
  } catch {
    throw new Error(`Zentrola returned an unreadable response (HTTP ${response.status}).`)
  }
  if (!response.ok) {
    const code = typeof body?.code === 'string' ? `, error code ${body.code}` : ''
    throw new Error(`The Zentrola query failed (HTTP ${response.status}${code}).`)
  }
  const data = body?.data
  if (
    !Number.isSafeInteger(data?.tokens) ||
    data.tokens < 0 ||
    typeof data?.from !== 'string' ||
    typeof data?.to !== 'string'
  ) {
    throw new Error('Zentrola returned invalid usage data.')
  }

  const text = [
    `Current-month token usage: ${data.tokens.toLocaleString('en-US')}`,
    `Reporting period start: ${data.from}`,
    `Reporting cutoff: ${data.to}`,
  ].join('\n')
  return {
    content: [{ type: 'text', text }],
    structuredContent: { tokens: data.tokens, from: data.from, to: data.to },
  }
}

async function handle(request) {
  const id = request?.id
  switch (request?.method) {
    case 'initialize':
      send({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion,
          capabilities: { tools: { listChanged: false } },
          serverInfo,
        },
      })
      return
    case 'notifications/initialized':
    case 'notifications/cancelled':
      return
    case 'ping':
      send({ jsonrpc: '2.0', id, result: {} })
      return
    case 'tools/list':
      send({ jsonrpc: '2.0', id, result: { tools: [tool] } })
      return
    case 'tools/call':
      if (request.params?.name !== tool.name) {
        send({
          jsonrpc: '2.0',
          id,
          error: { code: -32602, message: 'Unknown tool.' },
        })
        return
      }
      try {
        send({ jsonrpc: '2.0', id, result: await getUsage() })
      } catch (error) {
        send({
          jsonrpc: '2.0',
          id,
          result: {
            isError: true,
            content: [{ type: 'text', text: error instanceof Error ? error.message : 'Query failed.' }],
          },
        })
      }
      return
    default:
      if (id !== undefined) {
        send({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found.' } })
      }
  }
}

let buffer = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  buffer += chunk
  for (;;) {
    const newline = buffer.indexOf('\n')
    if (newline < 0) break
    const line = buffer.slice(0, newline).trim()
    buffer = buffer.slice(newline + 1)
    if (!line) continue
    let request
    try {
      request = JSON.parse(line)
    } catch {
      send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error.' } })
      continue
    }
    void handle(request)
  }
})
