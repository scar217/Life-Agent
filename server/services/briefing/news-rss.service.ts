import Parser from 'rss-parser'

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('Request timeout')), ms)),
  ])
}

const parser = new Parser()

export interface NewsItem {
  title: string
  link: string
  pubDate?: string
  description?: string
  source: string
}

const RSS_FEEDS = [
  { name: '36氪', url: 'https://36kr.com/feed' },
  { name: '少数派', url: 'https://sspai.com/feed' },
  { name: 'IT之家', url: 'https://www.ithome.com/rss/' },
  { name: '爱范儿', url: 'https://www.ifanr.com/feed' },
  { name: 'InfoQ 中文', url: 'https://www.infoq.cn/feed' },
  { name: '掘金', url: 'https://juejin.cn/rss' },
  { name: '博客园', url: 'https://www.cnblogs.com/rss' },
  { name: '阮一峰的网络日志', url: 'https://www.ruanyifeng.com/blog/atom.xml' },
]

async function fetchRSSFeed(feedUrl: string, sourceName: string): Promise<NewsItem[]> {
  try {
    const feed = await withTimeout(parser.parseURL(feedUrl), 10000)
    return (feed.items || []).slice(0, 5).map((item) => ({
      title: item.title || '',
      link: item.link || '',
      pubDate: item.pubDate || undefined,
      description: item.contentSnippet || item.content || '',
      source: sourceName,
    }))
  } catch (error) {
    console.error(`Error fetching RSS from ${sourceName}:`, error)
    return []
  }
}

export async function fetchAllNews(): Promise<NewsItem[]> {
  const allNewsArrays = await Promise.all(
    RSS_FEEDS.map((feed) => fetchRSSFeed(feed.url, feed.name))
  )
  return allNewsArrays.flat().sort((a, b) => {
    if (!a.pubDate || !b.pubDate) return 0
    return new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime()
  })
}

export function filterNewsByTopics(news: NewsItem[], topics: string): NewsItem[] {
  if (!news) return []
  if (!topics) return news.slice(0, 15)
  const keywords = topics.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean)
  if (keywords.length === 0) return news.slice(0, 15)
  const filtered = news.filter((item) =>
    keywords.some(
      (kw) =>
        item.title.toLowerCase().includes(kw) ||
        (item.description || '').toLowerCase().includes(kw)
    )
  )
  return filtered.length > 0 ? filtered.slice(0, 15) : []
}

export function formatNewsForAI(newsItems: NewsItem[]): string {
  if (!newsItems) return ''
  return newsItems
    .map(
      (item, i) =>
        `${i + 1}. [${item.source}] ${item.title}\n   链接: ${item.link}\n   ${(item.description || '').substring(0, 150)}`
    )
    .join('\n')
}

export function formatNewsHTML(newsItems: NewsItem[]): string {
  if (!newsItems) return ''
  const items = newsItems.slice(0, 15)
  let html = ''
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    const safeLink = /^https?:\/\//i.test(item.link) ? escapeHtml(item.link) : '#'
    const ariaLabel = `阅读 ${item.source} 新闻: ${item.title}`
    const isLast = i === items.length - 1
    html += `
      <div style="padding:18px 24px;border-bottom:${isLast ? 'none' : '1px solid #eeece6'}">
        <div style="margin-bottom:6px">
          <span style="display:inline-block;background-color:#f1f4f9;color:#64748b;font-size:12px;font-weight:500;padding:3px 10px;border-radius:4px;white-space:nowrap;vertical-align:middle">${escapeHtml(item.source)}</span>
        </div>
        <a href="${safeLink}" aria-label="${escapeHtml(ariaLabel)}" class="news-link" style="font-size:16px;color:#1c1c24;font-weight:500;text-decoration:none;line-height:1.5;display:inline-block;margin-bottom:6px">${escapeHtml(item.title)}</a>
        <div>
          <a href="${safeLink}" class="news-link" style="font-size:12px;color:#9ca0ab;text-decoration:none">阅读详情 &rarr;</a>
        </div>
      </div>`
  }
  return html
}
