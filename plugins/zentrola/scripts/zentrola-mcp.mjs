#!/usr/bin/env node

import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

const protocolVersion = '2025-06-18'
const serverInfo = { name: 'zentrola', version: '0.1.0' }
const usageTool = {
  name: 'get_usage',
  title: 'Get Zentrola usage',
  description:
    'Query token usage for the user associated with the active Zentrola Access Key. Omit both inputs for the current UTC month through now, or provide both UTC RFC3339 timestamps ending in Z for a custom half-open range [from, to).',
  inputSchema: {
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
  },
  outputSchema: {
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
  },
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
}

const providerTool = {
  name: 'get_provider',
  title: 'Get Zentrola provider',
  description:
    'Return the current service provider name from the active client configuration without contacting the Zentrola backend.',
  inputSchema: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    properties: {
      providerName: { type: 'string' },
    },
    required: ['providerName'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
}

const tools = [usageTool, providerTool]

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
  const provider = activeProvider ? providers.get(activeProvider) : undefined
  return provider ? { id: activeProvider, config: provider } : undefined
}

function completePair(baseURL, apiKey, suffix, source, providerName = 'Zentrola') {
  if (typeof baseURL !== 'string' || typeof apiKey !== 'string') return undefined
  if (!baseURL.trim() || !apiKey.trim()) return undefined
  return { baseURL: baseURL.trim(), apiKey: apiKey.trim(), suffix, source, providerName }
}

function firstNonBlank(...values) {
  return values.find((value) => typeof value === 'string' && value.trim())
}

async function pairFromCodex() {
  const codexHome = process.env.CODEX_HOME?.trim() || join(homedir(), '.codex')
  const config = await readText(join(codexHome, 'config.toml'))
  if (!config) return undefined
  const resolvedProvider = parseCodexProvider(config)
  if (!resolvedProvider || typeof resolvedProvider.config.base_url !== 'string') return undefined
  const { id: providerId, config: provider } = resolvedProvider
  const providerName = firstNonBlank(provider.name, providerId)

  if (typeof provider.env_key === 'string') {
    const pair = completePair(
      provider.base_url,
      process.env[provider.env_key],
      '/v1',
      'Codex provider environment',
      providerName,
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
      providerName,
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

function parseUsageTimestamp(value, field) {
  if (typeof value !== 'string') {
    throw new Error(`get_usage ${field} must be an RFC3339 timestamp string.`)
  }
  const timestamp = value.trim()
  const match = timestamp.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?Z$/,
  )
  if (!match) {
    throw new Error(`get_usage ${field} must be a UTC RFC3339 timestamp ending in Z.`)
  }
  const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  const hour = Number(hourText)
  const minute = Number(minuteText)
  const second = Number(secondText)
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  if (
    year === 0 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth[month - 1] ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    throw new Error(`get_usage ${field} is not a valid RFC3339 timestamp.`)
  }
  const epochMilliseconds = Date.parse(timestamp)
  if (!Number.isFinite(epochMilliseconds)) {
    throw new Error(`get_usage ${field} is not a valid RFC3339 timestamp.`)
  }
  return { timestamp, epochMilliseconds }
}

function formatDeviceTimestamp(value, timeZone) {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) {
    throw new Error('Zentrola returned invalid usage data.')
  }
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    timeZoneName: 'longOffset',
  })
  const parts = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter(({ type }) => type !== 'literal')
      .map(({ type, value: partValue }) => [type, partValue]),
  )
  const offsetMatch = parts.timeZoneName?.match(/^(?:GMT|UTC)(?:([+-])(\d{1,2})(?::?(\d{2}))?)?$/)
  if (!offsetMatch) {
    throw new Error('Unable to format the Zentrola reporting period in the device time zone.')
  }
  const offset = offsetMatch[1]
    ? `${offsetMatch[1]}${offsetMatch[2].padStart(2, '0')}:${offsetMatch[3] ?? '00'}`
    : 'Z'
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${offset}`
}

function normalizeUsageRange(argumentsValue) {
  if (
    argumentsValue === null ||
    typeof argumentsValue !== 'object' ||
    Array.isArray(argumentsValue)
  ) {
    throw new Error('get_usage arguments must be an object.')
  }
  const unknown = Object.keys(argumentsValue).filter((key) => key !== 'from' && key !== 'to')
  if (unknown.length > 0) {
    throw new Error('get_usage accepts only from and to.')
  }
  const hasFrom = Object.hasOwn(argumentsValue, 'from')
  const hasTo = Object.hasOwn(argumentsValue, 'to')
  if (!hasFrom && !hasTo) return undefined
  if (!hasFrom || !hasTo) {
    throw new Error('get_usage from and to must be provided together.')
  }
  const from = parseUsageTimestamp(argumentsValue.from, 'from')
  const to = parseUsageTimestamp(argumentsValue.to, 'to')
  if (to.epochMilliseconds <= from.epochMilliseconds) {
    throw new Error('get_usage to must be later than from.')
  }
  if (to.epochMilliseconds - from.epochMilliseconds > 366 * 24 * 60 * 60 * 1000) {
    throw new Error('get_usage range must not exceed 366 days.')
  }
  return { from: from.timestamp, to: to.timestamp }
}

function usageEndpoint(baseURL, suffix, range) {
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
  if (range) {
    url.searchParams.set('from', range.from)
    url.searchParams.set('to', range.to)
  }
  return url
}

async function getUsage(argumentsValue) {
  const range = normalizeUsageRange(argumentsValue)
  const { baseURL, apiKey, suffix } = await pairFromCurrentClient()
  const endpoint = usageEndpoint(baseURL, suffix, range)
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

  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  const fromLocal = formatDeviceTimestamp(data.from, timezone)
  const toLocal = formatDeviceTimestamp(data.to, timezone)

  const text = [
    `${range ? 'Token usage' : 'Current-month token usage'}: ${data.tokens.toLocaleString('en-US')}`,
    `Reporting period start: ${fromLocal} (${timezone})`,
    `Reporting cutoff: ${toLocal} (${timezone})`,
  ].join('\n')
  return {
    content: [{ type: 'text', text }],
    structuredContent: {
      tokens: data.tokens,
      from: data.from,
      to: data.to,
      timezone,
      fromLocal,
      toLocal,
    },
  }
}

async function getProvider(argumentsValue) {
  if (
    argumentsValue === null ||
    typeof argumentsValue !== 'object' ||
    Array.isArray(argumentsValue)
  ) {
    throw new Error('get_provider arguments must be an object.')
  }
  if (Object.keys(argumentsValue).length > 0) {
    throw new Error('get_provider does not accept arguments.')
  }
  const { providerName } = await pairFromCurrentClient()
  return {
    content: [{ type: 'text', text: `Current service provider: ${providerName}` }],
    structuredContent: { providerName },
  }
}

const toolHandlers = new Map([
  [usageTool.name, getUsage],
  [providerTool.name, getProvider],
])

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
          instructions:
            'Use get_usage for token consumption and get_provider for the configured service provider name. Both tools are read-only and reuse the active client configuration.',
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
      send({ jsonrpc: '2.0', id, result: { tools } })
      return
    case 'tools/call':
      const toolHandler = toolHandlers.get(request.params?.name)
      if (!toolHandler) {
        send({
          jsonrpc: '2.0',
          id,
          error: { code: -32602, message: 'Unknown tool.' },
        })
        return
      }
      try {
        const argumentsValue =
          request.params?.arguments === undefined ? {} : request.params.arguments
        send({ jsonrpc: '2.0', id, result: await toolHandler(argumentsValue) })
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
