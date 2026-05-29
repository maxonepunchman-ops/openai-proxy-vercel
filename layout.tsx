export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const DEFAULT_OPENAI_URL = 'https://api.openai.com/v1/chat/completions'

function getUpstreamUrl() {
  return (process.env.OPENAI_UPSTREAM_CHAT_COMPLETIONS_URL || DEFAULT_OPENAI_URL).trim()
}

function getCorsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Proxy-Secret',
    'Access-Control-Max-Age': '86400',
  }
}

function jsonResponse(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      ...getCorsHeaders(),
      'Cache-Control': 'no-store',
    },
  })
}

function getBearerToken(request: Request) {
  const authorization = request.headers.get('authorization') || ''
  const match = authorization.match(/^Bearer\s+(.+)$/i)
  return match?.[1]?.trim() || ''
}

function isAuthorized(request: Request) {
  const proxySecret = process.env.PROXY_SECRET?.trim()

  if (!proxySecret) {
    return false
  }

  const bearerToken = getBearerToken(request)
  const headerToken = request.headers.get('x-proxy-secret')?.trim() || ''

  return bearerToken === proxySecret || headerToken === proxySecret
}

export function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: getCorsHeaders(),
  })
}

export async function POST(request: Request) {
  if (!process.env.PROXY_SECRET?.trim()) {
    return jsonResponse(
      {
        error: 'На Vercel-прокси не задана переменная PROXY_SECRET',
      },
      500,
    )
  }

  if (!process.env.OPENAI_API_KEY?.trim()) {
    return jsonResponse(
      {
        error: 'На Vercel-прокси не задана переменная OPENAI_API_KEY',
      },
      500,
    )
  }

  if (!isAuthorized(request)) {
    return jsonResponse(
      {
        error: 'Нет доступа к прокси. Проверьте, что OPENAI_API_KEY на Timeweb равен PROXY_SECRET на Vercel.',
      },
      401,
    )
  }

  let rawBody = ''

  try {
    rawBody = await request.text()
    JSON.parse(rawBody)
  } catch {
    return jsonResponse(
      {
        error: 'Некорректный JSON в запросе к прокси',
      },
      400,
    )
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 55_000)

  try {
    const upstreamResponse = await fetch(getUpstreamUrl(), {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: rawBody,
    })

    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers: {
        ...getCorsHeaders(),
        'Content-Type': upstreamResponse.headers.get('content-type') || 'application/json',
        'Cache-Control': 'no-store',
      },
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка'
    const isAbort = error instanceof Error && error.name === 'AbortError'

    return jsonResponse(
      {
        error: isAbort ? 'OpenAI не ответил за 55 секунд' : 'Прокси не смог обратиться к OpenAI',
        details: message,
      },
      502,
    )
  } finally {
    clearTimeout(timeout)
  }
}
