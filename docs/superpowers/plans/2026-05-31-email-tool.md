# Email Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add personal email read/send/search/reply/forward/mark-read capabilities via an MCP Server, configurable through a settings page.

**Architecture:** Email operations are encapsulated in a standalone MCP Server process (stdio transport). Credentials are stored AES-256-GCM encrypted in the database. A wrapper layer in the main app decrypts credentials and injects them into MCP tool calls. The stream handler injects `_userId` following the existing `get_stock_info` pattern.

**Tech Stack:** `imapflow` (IMAP), `nodemailer` (SMTP, already a dependency), `@modelcontextprotocol/sdk` (MCP Server), Node.js crypto (AES-256-GCM)

---

### Task 1: Prisma Schema — EmailConfig Model

**Files:**
- Modify: `prisma/schema.prisma` — add EmailConfig model after BriefingConfig
- Modify: `.env` — add ENCRYPTION_KEY

- [ ] **Step 1: Add EmailConfig model to Prisma schema**

In `prisma/schema.prisma`, add after the `BriefingConfig` model:

```prisma
/// 邮箱配置表（用户 IMAP/SMTP 配置）
model EmailConfig {
  id            String   @id @default(cuid())
  /// 所属用户 ID
  userId        String   @unique
  /// 所属用户（级联删除）
  user          User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  /// IMAP 服务器地址
  imapHost      String
  /// IMAP 端口，默认 993
  imapPort      Int      @default(993)
  /// IMAP 账号
  imapUser      String
  /// IMAP 密码（AES-256-GCM 加密后存储）
  imapPassword  String
  /// SMTP 服务器地址
  smtpHost      String
  /// SMTP 端口，默认 465
  smtpPort      Int      @default(465)
  /// SMTP 账号
  smtpUser      String
  /// SMTP 密码（AES-256-GCM 加密后存储）
  smtpPassword  String
  /// 用户邮箱地址
  emailAddress  String
  /// 创建时间
  createdAt     DateTime @default(now())
  /// 更新时间
  updatedAt     DateTime @updatedAt
}
```

- [ ] **Step 2: Add ENCRYPTION_KEY to .env**

Add to `.env`:

```bash
ENCRYPTION_KEY=your-32-byte-hex-key-replace-me-in-production
```

- [ ] **Step 3: Generate Prisma migration**

Run: `pnpm db:generate && pnpm db:migrate --name add_email_config`
Expected: Migration file created and applied.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations .env
git commit -m "feat: add EmailConfig model for email IMAP/SMTP storage"
```

---

### Task 2: Encryption Utility

**Files:**
- Create: `server/services/email/crypto.ts`

- [ ] **Step 1: Create crypto.ts**

```typescript
import crypto from 'crypto'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 16
const AUTH_TAG_LENGTH = 16

function getKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY
  if (!key) {
    console.warn('[EmailCrypto] ENCRYPTION_KEY not set, using fallback — credentials stored as plaintext')
    return crypto.scryptSync('email-tool-fallback-key-do-not-use-in-production', 'salt', 32)
  }
  if (key.length === 64) return Buffer.from(key, 'hex')
  return crypto.scryptSync(key, 'salt', 32)
}

export function encryptCredential(plaintext: string): string {
  const key = getKey()
  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)
  let encrypted = cipher.update(plaintext, 'utf8', 'hex')
  encrypted += cipher.final('hex')
  const authTag = cipher.getAuthTag().toString('hex')
  return iv.toString('hex') + ':' + authTag + ':' + encrypted
}

export function decryptCredential(ciphertext: string): string {
  const key = getKey()
  const parts = ciphertext.split(':')
  if (parts.length !== 3) throw new Error('Invalid encrypted credential format')
  const iv = Buffer.from(parts[0], 'hex')
  const authTag = Buffer.from(parts[1], 'hex')
  const encrypted = parts[2]
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)
  let decrypted = decipher.update(encrypted, 'hex', 'utf8')
  decrypted += decipher.final('utf8')
  return decrypted
}
```

- [ ] **Step 2: Commit**

```bash
git add server/services/email/crypto.ts
git commit -m "feat: add AES-256-GCM credential encryption utility"
```

---

### Task 3: EmailConfig Repository

**Files:**
- Create: `server/repositories/email-config.repository.ts`

- [ ] **Step 1: Create repository**

```typescript
import { prisma } from '@/server/db/client'

export const EmailConfigRepository = {
  async findByUserId(userId: string) {
    return prisma.emailConfig.findUnique({ where: { userId } })
  },

  async upsert(
    userId: string,
    data: {
      imapHost: string
      imapPort: number
      imapUser: string
      imapPassword: string
      smtpHost: string
      smtpPort: number
      smtpUser: string
      smtpPassword: string
      emailAddress: string
    }
  ) {
    return prisma.emailConfig.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    })
  },
}
```

- [ ] **Step 2: Commit**

```bash
git add server/repositories/email-config.repository.ts
git commit -m "feat: add EmailConfig repository"
```

---

### Task 4: API Route — Email Config CRUD + Test Connection

**Files:**
- Create: `app/api/email/config/route.ts`

- [ ] **Step 1: Create API route**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserId } from '@/server/auth/utils'
import { EmailConfigRepository } from '@/server/repositories/email-config.repository'
import { encryptCredential, decryptCredential } from '@/server/services/email/crypto'
import * as nodemailer from 'nodemailer'

export async function GET() {
  const userId = await getCurrentUserId()
  const config = await EmailConfigRepository.findByUserId(userId)
  if (!config) return NextResponse.json(null)
  return NextResponse.json({
    ...config,
    imapPassword: '****',
    smtpPassword: '****',
  })
}

export async function PUT(req: NextRequest) {
  const userId = await getCurrentUserId()
  const body = await req.json()

  const existing = await EmailConfigRepository.findByUserId(userId)

  const data = {
    imapHost: body.imapHost || '',
    imapPort: body.imapPort || 993,
    imapUser: body.imapUser || '',
    imapPassword:
      body.imapPassword && body.imapPassword !== '****'
        ? encryptCredential(body.imapPassword)
        : existing?.imapPassword || '',
    smtpHost: body.smtpHost || '',
    smtpPort: body.smtpPort || 465,
    smtpUser: body.smtpUser || '',
    smtpPassword:
      body.smtpPassword && body.smtpPassword !== '****'
        ? encryptCredential(body.smtpPassword)
        : existing?.smtpPassword || '',
    emailAddress: body.emailAddress || '',
  }

  const config = await EmailConfigRepository.upsert(userId, data)
  return NextResponse.json({
    ...config,
    imapPassword: '****',
    smtpPassword: '****',
  })
}

export async function POST(req: NextRequest) {
  const userId = await getCurrentUserId()
  const body = await req.json()

  const results: { imap: string; smtp: string } = { imap: 'fail', smtp: 'fail' }

  // Test SMTP
  if (body.smtpHost && body.smtpUser && body.smtpPassword) {
    try {
      const transporter = nodemailer.createTransport({
        host: body.smtpHost,
        port: body.smtpPort || 465,
        secure: (body.smtpPort || 465) === 465,
        auth: { user: body.smtpUser, pass: body.smtpPassword },
        connectionTimeout: 10000,
      })
      await transporter.verify()
      results.smtp = 'ok'
    } catch (e) {
      results.smtp = e instanceof Error ? e.message : 'fail'
    }
  }

  // Test IMAP
  if (body.imapHost && body.imapUser && body.imapPassword) {
    try {
      const { ImapFlow } = await import('imapflow')
      const client = new ImapFlow({
        host: body.imapHost,
        port: body.imapPort || 993,
        secure: true,
        auth: { user: body.imapUser, pass: body.imapPassword },
      })
      await client.connect()
      await client.list()
      await client.logout()
      results.imap = 'ok'
    } catch (e) {
      results.imap = e instanceof Error ? e.message : 'fail'
    }
  }

  return NextResponse.json(results)
}
```

- [ ] **Step 2: Commit**

```bash
git add app/api/email/config/route.ts
git commit -m "feat: add email config API route with test connection endpoint"
```

---

### Task 5: MCP Server — imap-client.ts (Connection Factory)

**Files:**
- Create: `server/services/tools/email-mcp-server/imap-client.ts`

- [ ] **Step 1: Create IMAP client factory**

```typescript
import { ImapFlow } from 'imapflow'

export interface ImapConfig {
  host: string
  port: number
  user: string
  password: string
}

export async function createImapConnection(config: ImapConfig): Promise<ImapFlow> {
  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: true,
    auth: { user: config.user, pass: config.password },
  })
  await client.connect()
  return client
}

export interface EmailSummary {
  uid: number
  subject: string
  from: string
  date: string
  flags: string[]
  preview: string
}

export async function fetchEmails(
  client: ImapFlow,
  folder: string,
  searchCriteria: Record<string, unknown>,
  limit: number
): Promise<EmailSummary[]> {
  const mailbox = await client.mailboxOpen(folder)
  if (mailbox.exists === 0) return []

  const uids = await client.search(searchCriteria)
  if (uids.length === 0) return []

  const targetUids = uids.slice(-Math.min(limit, uids.length))

  const messages: EmailSummary[] = []
  for await (const msg of client.fetch(
    targetUids,
    { uid: true, envelope: true, bodyStructure: true, flags: true },
    { uid: true }
  )) {
    const preview = await fetchPreview(client, msg.uid)
    messages.push({
      uid: msg.uid,
      subject: msg.envelope.subject,
      from: msg.envelope.from?.[0] ? `${msg.envelope.from[0].name || ''} <${msg.envelope.from[0].address}>` : '',
      date: msg.envelope.date?.toISOString() || '',
      flags: msg.flags.map((f) => String(f)),
      preview,
    })
  }

  return messages
}

async function fetchPreview(client: ImapFlow, uid: number): Promise<string> {
  try {
    for await (const msg of client.fetch(
      `${uid}`,
      { bodyParts: ['HEADER.FIELDS (SUBJECT FROM DATE)', '1'] },
      { uid: true }
    )) {
      if (msg.bodyParts?.get('1')) {
        const buf = msg.bodyParts.get('1')
        if (buf) {
          const text = buf.toString().substring(0, 200)
          return text
        }
      }
    }
  } catch { /* ignore */ }
  return ''
}
```

- [ ] **Step 2: Commit**

```bash
git add server/services/tools/email-mcp-server/imap-client.ts
git commit -m "feat: add IMAP connection factory for email MCP server"
```

---

### Task 6: MCP Server — 6 Tool Implementations

**Files:**
- Create: `server/services/tools/email-mcp-server/tools/send.ts`
- Create: `server/services/tools/email-mcp-server/tools/read-inbox.ts`
- Create: `server/services/tools/email-mcp-server/tools/search.ts`
- Create: `server/services/tools/email-mcp-server/tools/reply.ts`
- Create: `server/services/tools/email-mcp-server/tools/forward.ts`
- Create: `server/services/tools/email-mcp-server/tools/mark-read.ts`

- [ ] **Step 1: Create send.ts**

```typescript
import * as nodemailer from 'nodemailer'

export interface SmtpConfig {
  host: string
  port: number
  user: string
  password: string
}

export async function executeEmailSend(
  smtpConfig: SmtpConfig,
  params: { to: string; subject: string; body: string; cc?: string; from: string }
): Promise<string> {
  const transporter = nodemailer.createTransport({
    host: smtpConfig.host,
    port: smtpConfig.port,
    secure: smtpConfig.port === 465,
    auth: { user: smtpConfig.user, pass: smtpConfig.password },
  })

  const info = await transporter.sendMail({
    from: params.from,
    to: params.to,
    cc: params.cc,
    subject: params.subject,
    html: params.body,
  })

  return JSON.stringify({ success: true, messageId: info.messageId })
}
```

- [ ] **Step 2: Create read-inbox.ts**

```typescript
import { createImapConnection, fetchEmails, type ImapConfig } from '../imap-client'

export async function executeEmailReadInbox(
  imapConfig: ImapConfig,
  params: { limit?: number; folder?: string }
): Promise<string> {
  const client = await createImapConnection(imapConfig)
  try {
    const messages = await fetchEmails(client, params.folder || 'INBOX', { seen: false }, params.limit || 20)
    return JSON.stringify({ success: true, messages })
  } finally {
    await client.logout()
  }
}
```

- [ ] **Step 3: Create search.ts**

```typescript
import { createImapConnection, fetchEmails, type ImapConfig } from '../imap-client'

export async function executeEmailSearch(
  imapConfig: ImapConfig,
  params: { from?: string; subject?: string; since?: string; before?: string; keyword?: string; folder?: string; limit?: number }
): Promise<string> {
  const client = await createImapConnection(imapConfig)
  try {
    const criteria: Array<{ header: string } | { key: string } | { since: string } | { before: string } | { body: string }> = []

    if (params.from) criteria.push({ header: `FROM "${params.from}"` as never })
    if (params.subject) criteria.push({ header: `SUBJECT "${params.subject}"` as never })
    if (params.since) criteria.push({ since: params.since } as never)
    if (params.before) criteria.push({ before: params.before } as never)
    if (params.keyword) criteria.push({ body: params.keyword } as never)

    const messages = await fetchEmails(
      client,
      params.folder || 'INBOX',
      criteria.length > 0 ? { or: criteria } : {},
      params.limit || 50
    )
    return JSON.stringify({ success: true, messages })
  } finally {
    await client.logout()
  }
}
```

- [ ] **Step 4: Create reply.ts**

```typescript
import { createImapConnection, type ImapConfig } from '../imap-client'
import { executeEmailSend, type SmtpConfig } from './send'

export async function executeEmailReply(
  imapConfig: ImapConfig,
  smtpConfig: SmtpConfig,
  params: { messageId: string; body: string; replyAll?: boolean; from: string }
): Promise<string> {
  const client = await createImapConnection(imapConfig)
  try {
    await client.mailboxOpen('INBOX')
    const fetched = await client.fetchOne(`${params.messageId}`, { envelope: true }, { uid: true })

    if (!fetched) return JSON.stringify({ success: false, error: '原始邮件未找到' })

    const originalSubject = fetched.envelope.subject
    const replySubject = originalSubject.startsWith('Re:') ? originalSubject : `Re: ${originalSubject}`

    const toRecipients = [fetched.envelope.from?.[0]?.address].filter(Boolean) as string[]
    const ccRecipients = params.replyAll
      ? (fetched.envelope.to || []).map((a: { address?: string }) => a.address).filter((a?: string) => a && a !== params.from)
      : []

    const result = await executeEmailSend(smtpConfig, {
      from: params.from,
      to: toRecipients.join(', '),
      cc: ccRecipients.join(', '),
      subject: replySubject,
      body: params.body,
    })

    return result
  } finally {
    await client.logout()
  }
}
```

- [ ] **Step 5: Create forward.ts**

```typescript
import { createImapConnection, type ImapConfig } from '../imap-client'
import { executeEmailSend, type SmtpConfig } from './send'

export async function executeEmailForward(
  imapConfig: ImapConfig,
  smtpConfig: SmtpConfig,
  params: { messageId: string; to: string; from: string }
): Promise<string> {
  const client = await createImapConnection(imapConfig)
  try {
    await client.mailboxOpen('INBOX')
    const fetched = await client.fetchOne(`${params.messageId}`, { envelope: true, source: true }, { uid: true })

    if (!fetched) return JSON.stringify({ success: false, error: '原始邮件未找到' })

    const subject = fetched.envelope.subject.startsWith('Fwd:')
      ? fetched.envelope.subject
      : `Fwd: ${fetched.envelope.subject}`

    const body = `<p>---------- 转发的邮件 ----------</p>
<p>发件人: ${fetched.envelope.from?.[0]?.name || ''} &lt;${fetched.envelope.from?.[0]?.address || ''}&gt;</p>
<p>日期: ${fetched.envelope.date?.toISOString() || ''}</p>
<p>主题: ${fetched.envelope.subject}</p>
<hr />
<pre>${fetched.source?.toString().substring(0, 10000) || ''}</pre>`

    const result = await executeEmailSend(smtpConfig, {
      from: params.from,
      to: params.to,
      subject,
      body,
    })

    return result
  } finally {
    await client.logout()
  }
}
```

- [ ] **Step 6: Create mark-read.ts**

```typescript
import { createImapConnection, type ImapConfig } from '../imap-client'

export async function executeEmailMarkRead(
  imapConfig: ImapConfig,
  params: { messageId: string }
): Promise<string> {
  const client = await createImapConnection(imapConfig)
  try {
    await client.mailboxOpen('INBOX')
    await client.messageFlagsAdd(`${params.messageId}`, ['\\Seen'], { uid: true })
    return JSON.stringify({ success: true })
  } finally {
    await client.logout()
  }
}
```

- [ ] **Step 7: Commit**

```bash
git add server/services/tools/email-mcp-server/tools/
git commit -m "feat: add email MCP server tool implementations (send, read, search, reply, forward, mark-read)"
```

---

### Task 7: MCP Server — Entry Point

**Files:**
- Create: `server/services/tools/email-mcp-server/index.ts`

- [ ] **Step 1: Create MCP Server entry point**

```typescript
#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { executeEmailSend } from './tools/send'
import { executeEmailReadInbox } from './tools/read-inbox'
import { executeEmailSearch } from './tools/search'
import { executeEmailReply } from './tools/reply'
import { executeEmailForward } from './tools/forward'
import { executeEmailMarkRead } from './tools/mark-read'

const server = new McpServer({ name: 'email-mcp-server', version: '0.1.0' })

const smtpConfigSchema = z.object({
  host: z.string(),
  port: z.number(),
  user: z.string(),
  password: z.string(),
})

const imapConfigSchema = z.object({
  host: z.string(),
  port: z.number(),
  user: z.string(),
  password: z.string(),
})

server.registerTool(
  'email_send',
  {
    description: '发送邮件。使用 SMTP 协议发送一封邮件。',
    inputSchema: {
      smtpConfig: smtpConfigSchema,
      to: z.string().describe('收件人邮箱地址'),
      subject: z.string().describe('邮件主题'),
      body: z.string().describe('邮件正文（支持 HTML）'),
      cc: z.string().optional().describe('抄送'),
      from: z.string().describe('发件人邮箱地址'),
    },
  },
  async ({ smtpConfig, to, subject, body, cc, from }) => {
    try {
      return { content: [{ type: 'text' as const, text: await executeEmailSend(smtpConfig, { to, subject, body, cc, from }) }] }
    } catch (e) {
      return { content: [{ type: 'text' as const, text: JSON.stringify({ error: e instanceof Error ? e.message : '发送失败' }) }], isError: true }
    }
  }
)

server.registerTool(
  'email_read_inbox',
  {
    description: '读取收件箱中的最近邮件。当用户询问"我的邮件"、"查收件箱"、"最新邮件"时使用。',
    inputSchema: {
      imapConfig: imapConfigSchema,
      limit: z.number().optional().default(20).describe('读取数量，默认 20'),
      folder: z.string().optional().default('INBOX').describe('文件夹，默认 INBOX'),
    },
  },
  async ({ imapConfig, limit, folder }) => {
    try {
      return { content: [{ type: 'text' as const, text: await executeEmailReadInbox(imapConfig, { limit, folder }) }] }
    } catch (e) {
      return { content: [{ type: 'text' as const, text: JSON.stringify({ error: e instanceof Error ? e.message : '读取失败' }) }], isError: true }
    }
  }
)

server.registerTool(
  'email_search',
  {
    description: '搜索邮件。支持按发件人、主题、日期范围、关键词筛选。',
    inputSchema: {
      imapConfig: imapConfigSchema,
      from: z.string().optional().describe('发件人关键词'),
      subject: z.string().optional().describe('主题关键词'),
      since: z.string().optional().describe('开始日期，ISO 格式如 2026-05-01'),
      before: z.string().optional().describe('结束日期，ISO 格式如 2026-05-31'),
      keyword: z.string().optional().describe('正文关键词'),
      folder: z.string().optional().default('INBOX'),
      limit: z.number().optional().default(50).describe('返回数量上限'),
    },
  },
  async ({ imapConfig, from, subject, since, before, keyword, folder, limit }) => {
    try {
      return { content: [{ type: 'text' as const, text: await executeEmailSearch(imapConfig, { from, subject, since, before, keyword, folder, limit }) }] }
    } catch (e) {
      return { content: [{ type: 'text' as const, text: JSON.stringify({ error: e instanceof Error ? e.message : '搜索失败' }) }], isError: true }
    }
  }
)

server.registerTool(
  'email_reply',
  {
    description: '回复指定邮件。需要提供原邮件的 messageId (UID)。',
    inputSchema: {
      imapConfig: imapConfigSchema,
      smtpConfig: smtpConfigSchema,
      messageId: z.string().describe('要回复的邮件 UID'),
      body: z.string().describe('回复正文（支持 HTML）'),
      replyAll: z.boolean().optional().default(false).describe('是否回复全部'),
      from: z.string().describe('发件人邮箱地址'),
    },
  },
  async ({ imapConfig, smtpConfig, messageId, body, replyAll, from }) => {
    try {
      return { content: [{ type: 'text' as const, text: await executeEmailReply(imapConfig, smtpConfig, { messageId, body, replyAll, from }) }] }
    } catch (e) {
      return { content: [{ type: 'text' as const, text: JSON.stringify({ error: e instanceof Error ? e.message : '回复失败' }) }], isError: true }
    }
  }
)

server.registerTool(
  'email_forward',
  {
    description: '转发指定邮件。',
    inputSchema: {
      imapConfig: imapConfigSchema,
      smtpConfig: smtpConfigSchema,
      messageId: z.string().describe('要转发的邮件 UID'),
      to: z.string().describe('转发目标邮箱'),
      from: z.string().describe('发件人邮箱地址'),
    },
  },
  async ({ imapConfig, smtpConfig, messageId, to, from }) => {
    try {
      return { content: [{ type: 'text' as const, text: await executeEmailForward(imapConfig, smtpConfig, { messageId, to, from }) }] }
    } catch (e) {
      return { content: [{ type: 'text' as const, text: JSON.stringify({ error: e instanceof Error ? e.message : '转发失败' }) }], isError: true }
    }
  }
)

server.registerTool(
  'email_mark_read',
  {
    description: '将指定邮件标记为已读。',
    inputSchema: {
      imapConfig: imapConfigSchema,
      messageId: z.string().describe('邮件 UID'),
    },
  },
  async ({ imapConfig, messageId }) => {
    try {
      return { content: [{ type: 'text' as const, text: await executeEmailMarkRead(imapConfig, { messageId }) }] }
    } catch (e) {
      return { content: [{ type: 'text' as const, text: JSON.stringify({ error: e instanceof Error ? e.message : '标记失败' }) }], isError: true }
    }
  }
)

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error('[EmailMCP] Server started')
}

main().catch((e) => {
  console.error('[EmailMCP] Fatal:', e)
  process.exit(1)
})
```

- [ ] **Step 2: Commit**

```bash
git add server/services/tools/email-mcp-server/index.ts
git commit -m "feat: add email MCP server entry point with 6 registered tools"
```

---

### Task 8: Register Email MCP Server + Credential Wrapper

**Files:**
- Modify: `mcp-servers.json` — add email server entry
- Create: `server/services/tools/email-tools-wrapper.ts`
- Modify: `server/services/tools/index.ts` — integrate wrapper
- Modify: `server/services/chat/stream.handler.ts` — inject `_userId` for email tools

- [ ] **Step 1: Add email server to mcp-servers.json**

```json
{
  "mcpServers": {
    "amap-maps": {
      "command": "npx",
      "args": ["-y", "@amap/amap-maps-mcp-server"],
      "env": {
        "AMAP_MAPS_API_KEY": "252b595b9c2f7d1a68656c661bf9bc09"
      }
    },
    "email": {
      "command": "npx",
      "args": ["-y", "tsx", "server/services/tools/email-mcp-server/index.ts"]
    }
  }
}
```

- [ ] **Step 2: Create email-tools-wrapper.ts**

```typescript
/**
 * Email Tools Wrapper
 *
 * 拦截 MCP email 工具，注入解密后的 IMAP/SMTP 凭据。
 * MCP Server 注册的工具 execute 需要 imapConfig/smtpConfig 参数，
 * 此 wrapper 从 DB 解密凭据并注入。
 */
import { EmailConfigRepository } from '@/server/repositories/email-config.repository'
import { decryptCredential } from '@/server/services/email/crypto'
import type { Tool } from './types'
import { toolRegistry } from './index'

const EMAIL_TOOLS = [
  'email_send',
  'email_read_inbox',
  'email_search',
  'email_reply',
  'email_forward',
  'email_mark_read',
]

export function wrapEmailTools(): void {
  for (const name of EMAIL_TOOLS) {
    const tool = toolRegistry.get(name)
    if (!tool) {
      console.warn(`[EmailWrapper] Tool "${name}" not found in registry, skipping`)
      continue
    }

    const originalExecute = tool.execute

    tool.execute = async (args: Record<string, unknown>) => {
      const userId = args._userId as string
      if (!userId) {
        return JSON.stringify({ error: '未登录' })
      }

      const config = await EmailConfigRepository.findByUserId(userId)
      if (!config) {
        return JSON.stringify({ error: '未配置邮箱，请在设置页配置 IMAP/SMTP 信息' })
      }

      try {
        const imapPassword = decryptCredential(config.imapPassword)
        const smtpPassword = decryptCredential(config.smtpPassword)

        const imapConfig = {
          host: config.imapHost,
          port: config.imapPort,
          user: config.imapUser,
          password: imapPassword,
        }

        const smtpConfig = {
          host: config.smtpHost,
          port: config.smtpPort,
          user: config.smtpUser,
          password: smtpPassword,
        }

        const newArgs = {
          ...args,
          imapConfig,
          smtpConfig,
          from: config.emailAddress,
        }

        delete newArgs._userId

        // 安全日志：剥离密码
        const safeArgs = JSON.stringify({
          ...newArgs,
          imapConfig: { ...imapConfig, password: '***' },
          smtpConfig: { ...smtpConfig, password: '***' },
        })
        console.log(`[EmailWrapper] Calling "${name}" with args: ${safeArgs.substring(0, 200)}`)

        return await originalExecute(newArgs)
      } catch (e) {
        const msg = e instanceof Error ? e.message : '凭据解密失败'
        return JSON.stringify({ error: msg })
      }
    }
  }
}
```

- [ ] **Step 3: Integrate wrapper into index.ts**

In `server/services/tools/index.ts`, after the MCP connection block, add the wrapper call.

Current end of `initTools()`:
```typescript
  // === MCP Server 集成（增量） ===
  const mcpManager = new MCPClientManager('mcp-servers.json')
  mcpManager.loadConfig()
  if (mcpManager.hasConfig()) {
    const existingNames = new Set(toolRegistry.getAll().map((t) => t.name))
    await mcpManager.connectAndRegister(toolRegistry, existingNames)
  }
```

Replace with:
```typescript
  // === MCP Server 集成（增量） ===
  const mcpManager = new MCPClientManager('mcp-servers.json')
  mcpManager.loadConfig()
  if (mcpManager.hasConfig()) {
    const existingNames = new Set(toolRegistry.getAll().map((t) => t.name))
    await mcpManager.connectAndRegister(toolRegistry, existingNames)
  }

  // 包装 email 工具：注入解密后的凭据
  // MCP Server 注册的工具需要 imapConfig/smtpConfig 参数，
  // 这些凭据从 DB 解密后通过 wrapper 注入
  try {
    const { wrapEmailTools } = await import('./email-tools-wrapper')
    wrapEmailTools()
  } catch (err) {
    console.warn('[Tools] Email wrapper not available:', err instanceof Error ? err.message : String(err))
  }
```

- [ ] **Step 4: Inject _userId in stream.handler.ts for email tools**

In `server/services/chat/stream.handler.ts`, in the `startToolExecution` function, add after the existing `get_stock_info` injection (line 277):

```typescript
  // Existing:
  if (name === 'get_stock_info') {
    args._userId = args._userId || userId
  }

  // Add after:
  if (name.startsWith('email_')) {
    args._userId = args._userId || userId
  }
```

- [ ] **Step 5: Commit**

```bash
git add mcp-servers.json server/services/tools/email-tools-wrapper.ts server/services/tools/index.ts server/services/chat/stream.handler.ts
git commit -m "feat: integrate email MCP server with credential wrapper and userId injection"
```

---

### Task 9: Frontend — Email Settings Page

**Files:**
- Create: `app/settings/email/page.tsx`

- [ ] **Step 1: Create email settings page**

```typescript
'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { toast } from '@/lib/hooks/use-toast'

export default function EmailSettingsPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ imap: string; smtp: string } | null>(null)

  const [emailAddress, setEmailAddress] = useState('')
  const [imapHost, setImapHost] = useState('')
  const [imapPort, setImapPort] = useState(993)
  const [imapUser, setImapUser] = useState('')
  const [imapPassword, setImapPassword] = useState('')
  const [smtpHost, setSmtpHost] = useState('')
  const [smtpPort, setSmtpPort] = useState(465)
  const [smtpUser, setSmtpUser] = useState('')
  const [smtpPassword, setSmtpPassword] = useState('')
  const [useSameAccount, setUseSameAccount] = useState(true)

  useEffect(() => {
    fetch('/api/email/config')
      .then((res) => {
        if (res.status === 401) { router.push('/auth/signin'); return null }
        return res.json()
      })
      .then((data) => {
        if (data) {
          setEmailAddress(data.emailAddress || '')
          setImapHost(data.imapHost || '')
          setImapPort(data.imapPort || 993)
          setImapUser(data.imapUser || '')
          setImapPassword(data.imapPassword || '')
          setSmtpHost(data.smtpHost || '')
          setSmtpPort(data.smtpPort || 465)
          setSmtpUser(data.smtpUser || '')
          setSmtpPassword(data.smtpPassword || '')
        }
      })
      .catch(() => toast({ title: '加载配置失败' }))
      .finally(() => setLoading(false))
  }, [router])

  async function handleTestConnection() {
    setTesting(true)
    setTestResult(null)

    const payload: Record<string, unknown> = {
      imapHost, imapPort, imapUser,
      smtpHost, smtpPort,
    }

    if (imapPassword && imapPassword !== '****') {
      payload.imapPassword = imapPassword
    }
    if (smtpPassword && smtpPassword !== '****') {
      payload.smtpPassword = smtpPassword
    } else if (useSameAccount && imapPassword && imapPassword !== '****') {
      payload.smtpPassword = imapPassword
      payload.smtpUser = smtpUser || imapUser
    }

    try {
      const res = await fetch('/api/email/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const result = await res.json()
      setTestResult(result)
      if (result.imap === 'ok' && result.smtp === 'ok') {
        toast({ title: '连接测试通过' })
      } else {
        toast({ title: '连接测试失败，请检查配置' })
      }
    } catch {
      toast({ title: '测试请求失败' })
    }
    setTesting(false)
  }

  async function handleSave() {
    setSaving(true)

    const smtpPasswordToSave = useSameAccount ? (imapPassword || '****') : (smtpPassword || '****')
    const smtpUserToSave = useSameAccount ? (smtpUser || imapUser) : smtpUser

    const res = await fetch('/api/email/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        emailAddress,
        imapHost, imapPort, imapUser,
        imapPassword: imapPassword || '****',
        smtpHost, smtpPort,
        smtpUser: smtpUserToSave,
        smtpPassword: smtpPasswordToSave,
      }),
    })
    if (res.ok) {
      toast({ title: '保存成功' })
    } else {
      const data = await res.json()
      toast({ title: data.error || '保存失败' })
    }
    setSaving(false)
  }

  if (loading) return <div className="flex justify-center p-10">加载中...</div>

  return (
    <div className="max-w-lg mx-auto p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => router.back()} className="h-8 w-8">
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-2xl font-bold">邮箱配置</h1>
      </div>

      <div className="space-y-2">
        <Label htmlFor="emailAddress">邮箱地址 *</Label>
        <Input id="emailAddress" type="email" value={emailAddress} onChange={(e) => setEmailAddress(e.target.value)} placeholder="your@email.com" />
      </div>

      <h2 className="text-lg font-semibold pt-2">IMAP（收件）</h2>
      <div className="grid grid-cols-3 gap-2">
        <div className="col-span-2 space-y-2">
          <Label htmlFor="imapHost">服务器地址</Label>
          <Input id="imapHost" value={imapHost} onChange={(e) => setImapHost(e.target.value)} placeholder="imap.example.com" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="imapPort">端口</Label>
          <Input id="imapPort" type="number" value={imapPort} onChange={(e) => setImapPort(Number(e.target.value))} />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="imapUser">账号</Label>
        <Input id="imapUser" value={imapUser} onChange={(e) => setImapUser(e.target.value)} placeholder="your@email.com" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="imapPassword">密码 / 授权码</Label>
        <Input id="imapPassword" type="password" value={imapPassword} onChange={(e) => setImapPassword(e.target.value)} placeholder="****" />
      </div>

      <h2 className="text-lg font-semibold pt-2">SMTP（发件）</h2>
      <div className="flex items-center justify-between">
        <Label>与 IMAP 使用相同账号密码</Label>
        <Switch checked={useSameAccount} onCheckedChange={setUseSameAccount} />
      </div>
      {!useSameAccount && (
        <>
          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-2 space-y-2">
              <Label htmlFor="smtpHost">服务器地址</Label>
              <Input id="smtpHost" value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} placeholder="smtp.example.com" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="smtpPort">端口</Label>
              <Input id="smtpPort" type="number" value={smtpPort} onChange={(e) => setSmtpPort(Number(e.target.value))} />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="smtpUser">账号</Label>
            <Input id="smtpUser" value={smtpUser} onChange={(e) => setSmtpUser(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="smtpPassword">密码 / 授权码</Label>
            <Input id="smtpPassword" type="password" value={smtpPassword} onChange={(e) => setSmtpPassword(e.target.value)} placeholder="****" />
          </div>
        </>
      )}

      {/* Test result */}
      {testResult && (
        <div className="p-3 rounded-md border space-y-1">
          <div className={`text-sm ${testResult.imap === 'ok' ? 'text-green-600' : 'text-red-600'}`}>
            IMAP: {testResult.imap === 'ok' ? '连接成功' : testResult.imap}
          </div>
          <div className={`text-sm ${testResult.smtp === 'ok' ? 'text-green-600' : 'text-red-600'}`}>
            SMTP: {testResult.smtp === 'ok' ? '连接成功' : testResult.smtp}
          </div>
        </div>
      )}

      <div className="flex gap-3">
        <Button onClick={handleTestConnection} disabled={testing} variant="outline" className="flex-1">
          {testing ? '测试中...' : '测试连接'}
        </Button>
        <Button onClick={handleSave} disabled={saving} className="flex-1">
          {saving ? '保存中...' : '保存'}
        </Button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add app/settings/email/page.tsx
git commit -m "feat: add email configuration settings page"
```

---

### Task 10: Install imapflow Dependency

**Files:**
- Modify: `package.json` (via pnpm add)

- [ ] **Step 1: Install imapflow**

Run: `pnpm add imapflow`
Expected: Package added to package.json and pnpm-lock.yaml.

- [ ] **Step 2: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: add imapflow dependency for email IMAP support"
```

---

### Task 11: End-to-End Verification

- [ ] **Step 1: Verify build**

Run: `pnpm build`
Expected: Build succeeds.

- [ ] **Step 2: Verify email config API**

Start dev server (`pnpm dev`), then test:
```bash
# Test PUT (save config)
curl -X PUT http://localhost:3000/api/email/config \
  -H "Content-Type: application/json" \
  -H "Cookie: <your-auth-cookie>" \
  -d '{"emailAddress":"test@qq.com","imapHost":"imap.qq.com","imapPort":993,"imapUser":"test@qq.com","imapPassword":"your-code","smtpHost":"smtp.qq.com","smtpPort":465,"smtpUser":"test@qq.com","smtpPassword":"your-code"}'

# Test GET (read config back, passwords masked)
curl http://localhost:3000/api/email/config -H "Cookie: <your-auth-cookie>"
```
Expected: GET returns config with passwords as `****`.

- [ ] **Step 3: Verify email tools appear in tool list**

Check server logs after startup:
Expected: `[MCP] Server "email" connected, 6/6 tools registered`

- [ ] **Step 4: Test AI email interaction**

Start a chat and ask: "帮我查一下最新的5封邮件"
Expected: AI calls `email_read_inbox` tool, tool executes, returns results.
