import { createWeatherTool } from '@/server/services/tools/get-weather'
import {
  fetchAllNews,
  filterNewsByTopics,
  formatNewsHTML,
  escapeHtml,
} from './news-rss.service'
import { sendBriefingEmail } from './email.service'
import { prisma } from '@/server/db/client'
import { fetchStockQuotes, type StockQuoteItem } from '@/server/services/tools/stock-api'

const SILICONFLOW_API_URL = 'https://api.siliconflow.cn/v1/chat/completions'

function getTimeOfDay(hour: number): string {
  if (hour >= 5 && hour < 11) return '早晨'
  if (hour >= 11 && hour < 13) return '中午'
  if (hour >= 13 && hour < 18) return '下午'
  if (hour >= 18 && hour < 22) return '晚上'
  return '深夜'
}

// AI writes only a personalized greeting, not full HTML
async function generateGreeting(
  apiKey: string,
  weatherData: string | null,
  newsCount: number,
  newsTopics: string | null,
  pushHour: number
): Promise<string> {
  const timeOfDay = getTimeOfDay(pushHour)
  let prompt = `你是一个AI生活管家。请用2-3句话写一段亲切的${timeOfDay}问候语（中文），内容包括：`

  if (weatherData) {
    prompt += `\n- 提及今日天气概况（${weatherData}），给一句出行或穿衣小建议`
  }

  prompt += `\n- 提及今日为你精选了${newsCount}条${newsTopics ? `与"${newsTopics}"相关的` : ''}新闻`
  prompt += `\n\n只输出问候语本身，不要任何标记、标题或格式。`

  try {
    const response = await fetch(SILICONFLOW_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'deepseek-ai/DeepSeek-V3.2',
        messages: [{ role: 'user', content: prompt }],
        stream: false,
        max_tokens: 256,
        temperature: 0.7,
      }),
    })
    if (!response.ok) return ''
    const data = await response.json()
    return data?.choices?.[0]?.message?.content || ''
  } catch {
    return ''
  }
}

function formatStocksHTML(quotes: StockQuoteItem[]): string {
  if (quotes.length === 0) return ''

  const rows = quotes
    .map((q, i) => {
      const name = escapeHtml(q.name || q.symbol)
      const code = escapeHtml(q.symbol.replace(/^(sh|sz|hk)/, ''))
      const price = q.price?.toFixed(2) ?? '--'

      const changeVal = q.change ?? 0
      const changeStr =
        q.change != null
          ? `${changeVal > 0 ? '+' : ''}${changeVal.toFixed(2)}`
          : '--'
      const changeColor =
        changeVal > 0 ? '#dc2626' : changeVal < 0 ? '#059669' : '#9ca0ab'

      const pctVal = q.changePct ?? 0
      const pctStr =
        q.changePct != null
          ? `${pctVal > 0 ? '+' : ''}${pctVal.toFixed(2)}%`
          : '--'
      const pctColor =
        pctVal > 0 ? '#dc2626' : pctVal < 0 ? '#059669' : '#9ca0ab'

      const stripeBg = i % 2 === 1 ? 'background-color:#fafaf7;' : ''

      return `<tr style="border-bottom:1px solid #eeece6;${stripeBg}">
        <td style="padding:10px 12px;font-size:14px;font-weight:500;color:#1c1c24">${name}</td>
        <td style="padding:10px 12px;font-size:12px;color:#9ca0ab">${code}</td>
        <td style="padding:10px 12px;font-size:14px;font-weight:500;text-align:right;color:#1c1c24">${price}</td>
        <td style="padding:10px 12px;font-size:13px;text-align:right;font-weight:500;color:${changeColor}">${changeStr}</td>
        <td style="padding:10px 12px;font-size:13px;text-align:right;font-weight:500;color:${pctColor}">${pctStr}</td>
      </tr>`
    })
    .join('')

  return `<div style="background:#ffffff;border:1px solid #e8e5df;border-radius:8px;margin-bottom:12px">
    <div style="padding:20px 24px 0">
      <h2 style="margin:0;font-size:15px;font-weight:600;color:#5c6ac4">&#x1F4C8; 今日自选股行情</h2>
    </div>
    <table style="width:100%;border-collapse:collapse;margin-top:16px">
      <thead>
        <tr style="border-bottom:2px solid #eeece6">
          <th style="padding:10px 12px;text-align:left;font-size:11px;font-weight:500;color:#9ca0ab;letter-spacing:0.5px">股票名称</th>
          <th style="padding:10px 12px;text-align:left;font-size:11px;font-weight:500;color:#9ca0ab;letter-spacing:0.5px">代码</th>
          <th style="padding:10px 12px;text-align:right;font-size:11px;font-weight:500;color:#9ca0ab;letter-spacing:0.5px">最新价</th>
          <th style="padding:10px 12px;text-align:right;font-size:11px;font-weight:500;color:#9ca0ab;letter-spacing:0.5px">涨跌额</th>
          <th style="padding:10px 12px;text-align:right;font-size:11px;font-weight:500;color:#9ca0ab;letter-spacing:0.5px">涨跌幅</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`
}

export interface BriefingConfig {
  id: string
  userId: string
  email: string
  pushHour: number
  city: string | null
  newsTopics: string | null
  user: { apiKey: string | null }
}

export async function generateAndSendBriefing(
  config: BriefingConfig,
  apiKey: string
): Promise<{ success: boolean; error?: string }> {
  // 1. Concurrent: weather + RSS news
  const [newsItems, weatherResult] = await Promise.all([
    fetchAllNews(),
    config.city
      ? createWeatherTool(process.env.WEATHER_API_KEY || '').execute({
          location: config.city,
        })
      : Promise.resolve(null),
  ])

  // 2. Filter news by user preferences
  const filteredNews = filterNewsByTopics(newsItems, config.newsTopics || '')

  // 3. Parse weather
  let weatherData: string | null = null
  if (weatherResult) {
    try {
      const parsed = JSON.parse(weatherResult)
      if (parsed.success) {
        const parts: string[] = []
        if (parsed.city) parts.push(parsed.city)
        if (parsed.condition) parts.push(parsed.condition)
        if (parsed.temp !== null && parsed.temp !== undefined)
          parts.push(`${parsed.temp}°C`)
        if (parsed.humidity !== undefined && parsed.humidity !== null)
          parts.push(`湿度${parsed.humidity}%`)
        if (parsed.wind) parts.push(parsed.wind)
        if (parsed.reportTime) parts.push(`更新于${parsed.reportTime}`)
        weatherData = parts.join('，')
      }
    } catch {
      /* ignore parse errors */
    }
  }

  // 3.5. 获取用户自选股行情
  let stocksHTML = ''
  try {
    const watchlistItems = await prisma.stockWatchlist.findMany({
      where: { userId: config.userId },
      orderBy: { addedAt: 'asc' },
    })
    console.log('[Briefing] Watchlist items for user', config.userId, ':', watchlistItems.length)
    if (watchlistItems.length > 0) {
      const symbols = watchlistItems.map((w) => w.symbol)
      console.log('[Briefing] Fetching quotes for symbols:', symbols)
      const quotes = await fetchStockQuotes(symbols)
      console.log('[Briefing] Got quotes:', quotes.length)
      stocksHTML = formatStocksHTML(quotes)
      console.log('[Briefing] Stocks HTML length:', stocksHTML.length)
    }
  } catch (err) {
    console.error('[Briefing] Failed to fetch stock data:', err instanceof Error ? err.message : err)
  }

  // 4. Assemble full HTML email (code controls structure, AI only writes greeting)
  const dateStr = new Date().toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  })

  const greeting = await generateGreeting(apiKey, weatherData, filteredNews.length, config.newsTopics, config.pushHour)
  const newsHTML = formatNewsHTML(filteredNews)

  const weatherHTML = weatherData
    ? `<div style="background:#ffffff;border:1px solid #e8e5df;border-top:3px solid #5c6ac4;border-radius:8px;padding:20px 24px;margin-bottom:12px">
        <h2 style="margin:0 0 12px;font-size:15px;font-weight:600;color:#5c6ac4">&#x2600; 今日天气</h2>
        <p style="margin:0;font-size:18px;font-weight:500;color:#1c1c24;line-height:1.6">${escapeHtml(weatherData)}</p>
      </div>`
    : ''

  const emptyNewsHTML = '<p style="color:#9ca0ab;font-size:14px;text-align:center;padding:40px 24px 30px;margin:0">暂无新闻，请稍后查看</p>'

  const fullHTML = `<div lang="zh-CN" style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,'Noto Sans SC','Hiragino Sans GB','Microsoft YaHei',sans-serif;max-width:600px;margin:0 auto;background-color:#f5f3ef;padding:20px 12px 30px">
    <style>
      .news-link:hover { color: #5c6ac4 !important; text-decoration: underline !important; }
    </style>

    <!-- Header -->
    <div style="background:#ffffff;border:1px solid #e8e5df;border-radius:8px;padding:28px 30px 22px;text-align:center;margin-bottom:12px">
      <h1 style="margin:0;font-size:26px;font-weight:700;color:#1c1c24;letter-spacing:0.5px">&#x1F4F0; 每日简报</h1>
      <p style="margin:10px 0 0;font-size:13px;color:#9ca0ab;letter-spacing:0.3px">${dateStr}</p>
    </div>

    <!-- Greeting -->
    ${greeting ? `<div style="background:#eef0ff;border:1px solid #dde0f8;border-left:4px solid #5c6ac4;border-radius:6px;padding:20px 24px;margin-bottom:12px">
      <p style="margin:0;font-size:15px;line-height:1.9;color:#433a5e">${escapeHtml(greeting)}</p>
    </div>` : ''}

    ${weatherHTML}
    ${stocksHTML}

    <!-- News -->
    <div style="background:#ffffff;border:1px solid #e8e5df;border-top:3px solid #5c6ac4;border-radius:8px;margin-bottom:12px">
      <div style="padding:20px 24px 0">
        <h2 style="margin:0;font-size:15px;font-weight:600;color:#5c6ac4">&#x1F4F0; 精选新闻</h2>
        <p style="margin:4px 0 0;font-size:12px;color:#9ca0ab">来自多个优质科技媒体</p>
      </div>
      ${newsHTML || emptyNewsHTML}
    </div>

    <!-- Footer -->
    <div style="text-align:center;padding:20px 12px 0">
      <p style="margin:0;font-size:12px;color:#bcb8b0">本简报由 AI Life Agent 自动生成 &middot; 仅供参考</p>
    </div>
  </div>`

  // 5. Send
  const subject = `每日简报 — ${dateStr}`
  return sendBriefingEmail(config.email, subject, fullHTML)
}
