#!/usr/bin/env node

import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

const protocolVersion = '2025-06-18'
const serverInfo = { name: 'zentrola', version: '0.2.1' }
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
    'Query the current service provider name for a model using the active Zentrola Access Key.',
  inputSchema: {
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
  },
  outputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string' },
    },
    required: ['name'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
}

const imageGenerationTool = {
  name: 'generate_image',
  title: 'Generate an image with Zentrola',
  description:
    'Generate a PNG image through Zentrola. The prompt should fully describe the desired image, including style, composition, dimensions, and background requirements.',
  inputSchema: {
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
  },
  outputSchema: {
    type: 'object',
    properties: {
      model: { type: 'string' },
      mimeType: { type: 'string', const: 'image/png' },
      bytes: { type: 'integer', minimum: 1 },
    },
    required: ['model', 'mimeType', 'bytes'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
}

const tools = [usageTool, providerTool, imageGenerationTool]

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

  if (typeof provider.experimental_bearer_token === 'string') {
    const pair = completePair(
      provider.base_url,
      provider.experimental_bearer_token,
      '/v1',
      'Codex config.toml experimental bearer token',
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

function pairFromZentrolaEnvironment() {
  const apiKey = process.env.ZENTROLA_VIRTUAL_KEY
  if (typeof apiKey !== 'string' || !apiKey.trim()) return undefined
  return completePair(
    process.env.ZENTROLA_BASE_URL?.trim() || 'http://127.0.0.1:9527/v1',
    apiKey,
    '/v1',
    'Zentrola environment',
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
  const directPair = pairFromZentrolaEnvironment()
  if (directPair) return directPair
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

function meEndpoint(baseURL, suffix, resource) {
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
  url.pathname = `${path}/api/v1/me/${resource}`.replace(/\/{2,}/g, '/')
  return url
}

function usageEndpoint(baseURL, suffix, range) {
  const url = meEndpoint(baseURL, suffix, 'usage')
  if (range) {
    url.searchParams.set('from', range.from)
    url.searchParams.set('to', range.to)
  }
  return url
}

function responsesEndpoint(baseURL, suffix) {
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
  url.pathname = `${path}/v1/responses`.replace(/\/{2,}/g, '/')
  return url
}

function normalizeImageArguments(argumentsValue) {
  if (
    argumentsValue === null ||
    typeof argumentsValue !== 'object' ||
    Array.isArray(argumentsValue)
  ) {
    throw new Error('generate_image arguments must be an object.')
  }
  const unknown = Object.keys(argumentsValue).filter(
    (key) => key !== 'prompt' && key !== 'model',
  )
  if (unknown.length > 0) {
    throw new Error('generate_image accepts only prompt and model.')
  }
  if (typeof argumentsValue.prompt !== 'string' || !argumentsValue.prompt.trim()) {
    throw new Error('generate_image prompt must be a non-empty string.')
  }
  if (
    Object.hasOwn(argumentsValue, 'model') &&
    (typeof argumentsValue.model !== 'string' || !argumentsValue.model.trim())
  ) {
    throw new Error('generate_image model must be a non-empty string when provided.')
  }
  return {
    prompt: argumentsValue.prompt.trim(),
    model: argumentsValue.model?.trim() || 'gpt-5.6-sol',
  }
}

function updateImageData(value, state) {
  if (!value || typeof value !== 'object') return
  if (typeof value.partial_image_b64 === 'string' && value.partial_image_b64) {
    state.imageBase64 = value.partial_image_b64
  }
  if (typeof value.result === 'string' && value.result) {
    state.imageBase64 = value.result
  }
  for (const key of ['item', 'response', 'output', 'content']) {
    const nested = value[key]
    if (Array.isArray(nested)) {
      for (const entry of nested) updateImageData(entry, state)
    } else {
      updateImageData(nested, state)
    }
  }
}

function imageDataFromEvent(eventName, eventData, state) {
  if (
    eventName.startsWith('response.image_generation_call.') ||
    eventName === 'response.output_item.done' ||
    eventName === 'response.completed'
  ) {
    updateImageData(eventData, state)
  }
  if (eventName === 'response.failed' || eventName === 'error') {
    const message =
      eventData?.error?.message ?? eventData?.response?.error?.message ?? eventData?.message
    throw new Error(
      typeof message === 'string' && message.trim()
        ? `Zentrola image generation failed: ${message.trim()}`
        : 'Zentrola image generation failed.',
    )
  }
  if (eventName === 'response.completed') {
    state.responseCompleted = true
    return true
  }
  return false
}

function processSseBlock(block, state) {
  let eventName = ''
  const dataLines = []
  for (const line of block.split(/\r?\n/)) {
    if (!line || line.startsWith(':')) continue
    const separator = line.indexOf(':')
    const field = separator < 0 ? line : line.slice(0, separator)
    let value = separator < 0 ? '' : line.slice(separator + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    if (field === 'event') eventName = value
    if (field === 'data') dataLines.push(value)
  }
  if (dataLines.length === 0) return false
  const dataText = dataLines.join('\n')
  if (dataText === '[DONE]') {
    state.responseCompleted = true
    return true
  }
  let eventData
  try {
    eventData = JSON.parse(dataText)
  } catch {
    throw new Error('Zentrola returned an unreadable SSE event.')
  }
  return imageDataFromEvent(eventName || eventData?.type || '', eventData, state)
}

async function readImageSse(response) {
  if (!response.body) throw new Error('Zentrola returned an empty SSE response.')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const state = { imageBase64: '', responseCompleted: false }
  let buffer = ''
  let completed = false

  try {
    while (!completed) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      for (;;) {
        const match = /\r?\n\r?\n/.exec(buffer)
        if (!match) break
        const block = buffer.slice(0, match.index)
        buffer = buffer.slice(match.index + match[0].length)
        if (block && processSseBlock(block, state)) {
          completed = true
          break
        }
      }
    }
    buffer += decoder.decode()
    if (!completed && buffer.trim()) processSseBlock(buffer, state)
  } finally {
    await reader.cancel().catch(() => {})
  }

  if (!state.responseCompleted) {
    throw new Error('The Zentrola SSE stream ended before response.completed.')
  }
  if (!state.imageBase64) {
    throw new Error('Zentrola completed the response without returning image data.')
  }
  return state.imageBase64
}

function decodePng(imageBase64) {
  const withoutDataUrl = imageBase64.replace(/^data:image\/png;base64,/i, '')
  const normalized = withoutDataUrl.replace(/\s/g, '')
  if (
    !normalized ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized) ||
    normalized.length % 4 === 1
  ) {
    throw new Error('Zentrola returned invalid base64 image data.')
  }
  const image = Buffer.from(normalized, 'base64')
  const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  if (image.length <= pngSignature.length || !image.subarray(0, 8).equals(pngSignature)) {
    throw new Error('Zentrola returned image data that is not a PNG.')
  }
  return image
}

function redactSecret(value, secret) {
  if (typeof value !== 'string' || typeof secret !== 'string' || !secret) return value
  return value.split(secret).join('[redacted]')
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
  const keys = Object.keys(argumentsValue)
  if (keys.some((key) => key !== 'model')) {
    throw new Error('get_provider accepts only model.')
  }
  if (typeof argumentsValue.model !== 'string' || !argumentsValue.model.trim()) {
    throw new Error('get_provider model must be a non-empty string.')
  }
  const { baseURL, apiKey, suffix } = await pairFromCurrentClient()
  const endpoint = meEndpoint(baseURL, suffix, 'provider')
  endpoint.searchParams.set('model', argumentsValue.model.trim())
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
    throw new Error(`The Zentrola provider query failed (HTTP ${response.status}${code}).`)
  }
  if (typeof body?.data?.name !== 'string' || !body.data.name.trim()) {
    throw new Error('Zentrola returned invalid provider data.')
  }

  const name = body.data.name.trim()
  return {
    content: [{ type: 'text', text: `Current service provider: ${name}` }],
    structuredContent: { name },
  }
}

async function generateImage(argumentsValue) {
  const { prompt, model } = normalizeImageArguments(argumentsValue)
  const { baseURL, apiKey, suffix } = await pairFromCurrentClient()
  const endpoint = responsesEndpoint(baseURL, suffix)
  let response
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Accept: 'text/event-stream',
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        input: prompt,
        tools: [{ type: 'image_generation' }],
        store: false,
        stream: true,
      }),
      signal: AbortSignal.timeout(5 * 60_000),
    })
  } catch (error) {
    if (error?.name === 'TimeoutError') {
      throw new Error('The Zentrola image generation request timed out.')
    }
    throw new Error('Unable to connect to the Zentrola image generation service.')
  }

  if (!response.ok) {
    const responseText = (await response.text().catch(() => '')).slice(0, 64 * 1024)
    let detail = ''
    try {
      const body = JSON.parse(responseText)
      if (typeof body?.code === 'string') detail = `, error code ${body.code}`
      else if (typeof body?.error?.message === 'string') detail = `: ${body.error.message}`
    } catch {
      if (responseText.trim()) detail = `: ${responseText.trim()}`
    }
    detail = redactSecret(detail, apiKey)
    throw new Error(`The Zentrola image generation request failed (HTTP ${response.status}${detail}).`)
  }

  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.toLowerCase().includes('text/event-stream')) {
    throw new Error('Zentrola returned a non-SSE image generation response.')
  }

  let imageBase64
  try {
    imageBase64 = await readImageSse(response)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Zentrola image generation failed.'
    throw new Error(redactSecret(message, apiKey))
  }
  const image = decodePng(imageBase64)
  return {
    content: [
      { type: 'text', text: `Generated a PNG image with ${model}.` },
      { type: 'image', data: image.toString('base64'), mimeType: 'image/png' },
    ],
    structuredContent: { model, mimeType: 'image/png', bytes: image.length },
  }
}

const toolHandlers = new Map([
  [usageTool.name, getUsage],
  [providerTool.name, getProvider],
  [imageGenerationTool.name, generateImage],
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
            'Use get_usage for token consumption, get_provider with a model identifier for the current service provider name, and generate_image to create a PNG through Zentrola. All tools reuse the active client configuration.',
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
