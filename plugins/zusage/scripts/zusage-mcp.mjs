#!/usr/bin/env node

import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
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

async function readText(filePath) {
  try {
    return await readFile(filePath, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return undefined
    throw error
  }
}

async function readJSON(filePath) {
  const text = await readText(filePath)
  if (text === undefined) return undefined
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`Unable to parse client configuration at ${filePath}.`)
  }
}

function stripTomlComment(value) {
  let quote = ''
  let escaped = false
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]
    if (escaped) {
      escaped = false
      continue
    }
    if (quote === '"' && character === '\\') {
      escaped = true
      continue
    }
    if (quote) {
      if (character === quote) quote = ''
      continue
    }
    if (character === '"' || character === "'") {
      quote = character
      continue
    }
    if (character === '#') return value.slice(0, index).trim()
  }
  return value.trim()
}

function parseTomlValue(value) {
  const raw = stripTomlComment(value)
  if (raw.startsWith('"') && raw.endsWith('"')) {
    try {
      return JSON.parse(raw)
    } catch {
      return undefined
    }
  }
  if (raw.startsWith("'") && raw.endsWith("'")) return raw.slice(1, -1)
  if (raw === 'true') return true
  if (raw === 'false') return false
  return raw
}

function parseCodexProvider(config) {
  let section = ''
  let activeProvider
  const providers = new Map()
  for (const line of config.split(/\r?\n/)) {
    const sectionMatch = line.match(/^\s*\[\s*model_providers\.(?:"([^"]+)"|'([^']+)'|([\w-]+))\s*\]\s*(?:#.*)?$/)
    if (sectionMatch) {
      section = `model_providers.${sectionMatch[1] ?? sectionMatch[2] ?? sectionMatch[3]}`
      continue
    }
    if (/^\s*\[/.test(line)) {
      section = ''
      continue
    }
    const assignment = line.match(/^\s*([\w-]+)\s*=\s*(.+)$/)
    if (!assignment) continue
    const [, key, rawValue] = assignment
    const value = parseTomlValue(rawValue)
    if (!section && key === 'model_provider' && typeof value === 'string') {
      activeProvider = value
      continue
    }
    if (!section.startsWith('model_providers.')) continue
    const providerName = section.slice('model_providers.'.length)
    const provider = providers.get(providerName) ?? {}
    provider[key] = value
    providers.set(providerName, provider)
  }
  return activeProvider ? providers.get(activeProvider) : undefined
}

function completePair(baseURL, apiKey, suffix, source) {
  if (typeof baseURL !== 'string' || typeof apiKey !== 'string') return undefined
  if (!baseURL.trim() || !apiKey.trim()) return undefined
  return { baseURL: baseURL.trim(), apiKey: apiKey.trim(), suffix, source }
}

function firstNonBlank(...values) {
  return values.find((value) => typeof value === 'string' && value.trim())
}

async function pairFromCodex() {
  const codexHome = process.env.CODEX_HOME?.trim() || join(homedir(), '.codex')
  const config = await readText(join(codexHome, 'config.toml'))
  if (!config) return undefined
  const provider = parseCodexProvider(config)
  if (!provider || typeof provider.base_url !== 'string') return undefined

  if (typeof provider.env_key === 'string') {
    const pair = completePair(
      provider.base_url,
      process.env[provider.env_key],
      '/v1',
      'Codex provider environment',
    )
    if (pair) return pair
  }

  if (provider.requires_openai_auth === true) {
    const auth = await readJSON(join(codexHome, 'auth.json'))
    const pair = completePair(
      provider.base_url,
      auth?.OPENAI_API_KEY,
      '/v1',
      'Codex config.toml and auth.json',
    )
    if (pair) return pair
  }
  return undefined
}

function pairFromOpenAIEnvironment() {
  return completePair(
    process.env.OPENAI_BASE_URL,
    process.env.OPENAI_API_KEY,
    '/v1',
    'OpenAI environment',
  )
}

async function pairFromClaude() {
  const environmentPair = completePair(
    process.env.ANTHROPIC_BASE_URL,
    firstNonBlank(process.env.ANTHROPIC_AUTH_TOKEN, process.env.ANTHROPIC_API_KEY),
    '/anthropic',
    'Claude Code environment',
  )
  if (environmentPair) return environmentPair

  const claudeHome = process.env.CLAUDE_CONFIG_DIR?.trim() || join(homedir(), '.claude')
  const settings = await readJSON(join(claudeHome, 'settings.json'))
  const configuredEnvironment = settings?.env && typeof settings.env === 'object' ? settings.env : {}
  return completePair(
    configuredEnvironment.ANTHROPIC_BASE_URL,
    firstNonBlank(
      configuredEnvironment.ANTHROPIC_AUTH_TOKEN,
      configuredEnvironment.ANTHROPIC_API_KEY,
    ),
    '/anthropic',
    'Claude Code settings.json',
  )
}

function clientFromArguments() {
  const clientArguments = process.argv
    .slice(2)
    .filter((argument) => argument.startsWith('--client='))
  if (clientArguments.length !== 1) {
    throw new Error(
      'The MCP launcher must provide exactly one --client=codex or --client=claude argument.',
    )
  }
  const client = clientArguments[0].slice('--client='.length)
  if (client === 'codex' || client === 'claude') return client
  throw new Error(
    'The MCP launcher provided an invalid client. Expected --client=codex or --client=claude.',
  )
}

async function pairFromCurrentClient() {
  // Resolve credentials afresh for every tool call so rotations are picked up without plugin changes.
  const client = clientFromArguments()
  const pair =
    client === 'codex'
      ? (await pairFromCodex()) ?? pairFromOpenAIEnvironment()
      : await pairFromClaude()
  if (pair) return pair
  throw new Error(
    `No complete Zentrola ${client === 'codex' ? 'Codex' : 'Claude Code'} configuration was detected. Update the active client gateway credentials, then retry.`,
  )
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
  const { baseURL, apiKey, suffix } = await pairFromCurrentClient()
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
