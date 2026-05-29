export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const DEFAULT_OPENAI_URL = 'https://api.openai.com/v1/chat/completions'

function getTokenFromRequest(request: Request) {
  const url = new URL(request.url)
  const queryToken = url.searchParams.get('token')?.trim() || ''
  const headerToken = request.headers.get('x-proxy-secret')?.trim() || ''
  const authorization = request.headers.get('authorization') || ''
  const bearerToken = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || ''

  return queryToken || headerToken || bearerToken
}

export async function GET(request: Request) {
  const proxySecret = process.env.PROXY_SECRET?.trim()
  const requestToken = getTokenFromRequest(request)

  if (!proxySecret) {
    return Response.json({ ok: false, error: 'Не задан PROXY_SECRET' }, { status: 500 })
  }

  if (requestToken !== proxySecret) {
    return Response.json({ ok: false, error: 'Неверный token' }, { status: 401 })
  }

  if (!process.env.OPENAI_API_KEY?.trim()) {
    return Response.json({ ok: false, error: 'Не задан OPENAI_API_KEY' }, { status: 500 })
  }

  try {
    const response = await fetch(process.env.OPENAI_UPSTREAM_CHAT_COMPLETIONS_URL || DEFAULT_OPENAI_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.2,
        messages: [
          {
            role: 'system',
            content: 'Отвечай коротко на русском языке.',
          },
          {
            role: 'user',
            content: 'Проверка прокси. Напиши ровно: API работает.',
          },
        ],
      }),
    })

    const text = await response.text()

    if (!response.ok) {
      return Response.json(
        {
          ok: false,
          error: 'OpenAI вернул ошибку',
          status: response.status,
          details: text.slice(0, 2000),
        },
        { status: 500 },
      )
    }

    const data = JSON.parse(text)

    return Response.json({
      ok: true,
      answer: data?.choices?.[0]?.message?.content || null,
    })
  } catch (error: unknown) {
    return Response.json(
      {
        ok: false,
        error: 'Не удалось обратиться к OpenAI',
        details: error instanceof Error ? error.message : 'unknown',
      },
      { status: 502 },
    )
  }
}
