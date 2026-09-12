export interface ChatJsonOptions {
  apiKey: string
  model: string
  system: string
  user: string
}

function friendlyOpenAiError(status: number, body: string): string {
  const lower = body.toLowerCase()
  if (status === 401 || lower.includes('invalid_api_key')) {
    return 'Ключ OpenAI не принят. Проверьте его в настройках.'
  }
  if (
    lower.includes('insufficient_quota') ||
    lower.includes('exceeded your current quota') ||
    lower.includes('billing')
  ) {
    return 'У ключа OpenAI нет доступной квоты. В кабинете OpenAI нужны оплата или свободный лимит — без этого облачный анализ и смысловой поиск не собрать.'
  }
  if (status === 429 || lower.includes('rate_limit')) {
    return 'OpenAI временно ограничила частоту запросов. Подождите минуту и нажмите ещё раз.'
  }
  if (status >= 500) return 'Сервис OpenAI сейчас недоступен. Попробуйте позже.'
  return 'Не удалось обратиться к OpenAI. Проверьте интернет и ключ.'
}

export function openAiErrorCode(body: string, status: number): string {
  try {
    const parsed = JSON.parse(body) as { error?: { code?: string; type?: string } }
    return parsed.error?.code || parsed.error?.type || `http_${status}`
  } catch {
    return `http_${status}`
  }
}

export async function testOpenAiKey(apiKey: string): Promise<void> {
  const response = await fetch('https://api.openai.com/v1/models', {
    headers: { Authorization: `Bearer ${apiKey}` }
  })
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(friendlyOpenAiError(response.status, body), {
      cause: openAiErrorCode(body, response.status)
    })
  }
}

export async function chatJson(options: ChatJsonOptions): Promise<string> {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: options.model,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: options.system },
        { role: 'user', content: options.user }
      ]
    })
  })
  const raw = await response.text()
  if (!response.ok) {
    throw new Error(friendlyOpenAiError(response.status, raw), {
      cause: openAiErrorCode(raw, response.status)
    })
  }
  let parsed: { choices?: Array<{ message?: { content?: string } }> }
  try {
    parsed = JSON.parse(raw) as { choices?: Array<{ message?: { content?: string } }> }
  } catch {
    throw new Error('OpenAI вернул непонятный ответ.')
  }
  const content = parsed.choices?.[0]?.message?.content?.trim()
  if (!content) throw new Error('OpenAI не вернул текст конспекта.')
  return content
}

export async function embedTexts(apiKey: string, texts: string[], model = 'text-embedding-3-small'): Promise<number[][]> {
  const vectors: number[][] = []
  const batchSize = 64
  for (let offset = 0; offset < texts.length; offset += batchSize) {
    const batch = texts.slice(offset, offset + batchSize)
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ model, input: batch })
    })
    const raw = await response.text()
    if (!response.ok) {
      throw new Error(friendlyOpenAiError(response.status, raw), {
        cause: openAiErrorCode(raw, response.status)
      })
    }
    let parsed: { data?: Array<{ embedding?: number[]; index?: number }> }
    try {
      parsed = JSON.parse(raw) as { data?: Array<{ embedding?: number[]; index?: number }> }
    } catch {
      throw new Error('OpenAI вернул непонятный ответ эмбеддингов.')
    }
    const rows = [...(parsed.data ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    for (const row of rows) {
      if (!row.embedding?.length) throw new Error('OpenAI не вернул вектор для фрагмента.')
      vectors.push(row.embedding)
    }
  }
  if (vectors.length !== texts.length) {
    throw new Error('Не все фрагменты получили смысловой вектор.')
  }
  return vectors
}
