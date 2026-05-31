# Email Tool — MCP Server Design

**Date:** 2026-05-31
**Status:** draft

## Overview

给 AI Chat 系统添加个人邮箱操作能力（读取、发送、搜索、回复、转发）。通过 MCP Server 封装邮件操作，用户在设置页配置自己的通用 IMAP/SMTP 邮箱后，即可在对话中让 AI 操作邮件。

## Architecture

```
┌─ Next.js 主应用 ─────────────────────────────────────────┐
│                                                           │
│  /settings → EmailConfig 表单 → PUT /api/email/config    │
│                  ↓ 加密后存入                              │
│  EmailConfig 表 (密文)                                    │
│                                                           │
│  AI 聊天 → ToolRegistry                                   │
│    ↓                                                      │
│  MCPClientManager (已有, stdio transport)                  │
│    ↓                                                      │
│  ┌─── email-mcp-server (独立 Node.js 进程) ────────────┐  │
│  │  email_send        → nodemailer SMTP                │  │
│  │  email_read_inbox  → imapflow IMAP                  │  │
│  │  email_search      → imapflow SEARCH                │  │
│  │  email_reply       → IMAP fetch + SMTP send         │  │
│  │  email_forward     → IMAP fetch + SMTP send         │  │
│  │  email_mark_read   → IMAP FLAGS                     │  │
│  └─────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────┘
```

## MCP Server — email-mcp-server

### Tech Stack

- Node.js + TypeScript（与主项目一致）
- `@modelcontextprotocol/sdk` — MCP Server 框架
- `imapflow` — 现代 Promise-based IMAP 客户端
- `nodemailer` — SMTP 发送（主项目已有依赖）

### Tools

全部 6 个工具都需要接收凭据参数，不持久化任何状态。

#### email_send

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `smtpConfig` | object | yes | `{ host, port, user, password }` |
| `to` | string | yes | 收件人 |
| `subject` | string | yes | 主题 |
| `body` | string | yes | HTML 或纯文本正文 |
| `cc` | string | no | 抄送 |
| `from` | string | yes | 发件人地址 |

Returns: `{ success, messageId }` or `{ error }`

#### email_read_inbox

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `imapConfig` | object | yes | `{ host, port, user, password }` |
| `limit` | number | no | 默认 20 |
| `folder` | string | no | 默认 INBOX |

Returns: `{ success, messages: [{ uid, subject, from, date, flags, preview }] }`

#### email_search

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `imapConfig` | object | yes | |
| `from` | string | no | 发件人关键词 |
| `subject` | string | no | 主题关键词 |
| `since` | string | no | ISO date，如 2026-05-01 |
| `before` | string | no | ISO date |
| `keyword` | string | no | 正文关键词 |
| `folder` | string | no | 默认 INBOX |

Returns: `{ success, messages: [...] }`

#### email_reply

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `imapConfig` | object | yes | |
| `smtpConfig` | object | yes | |
| `messageId` | string | yes | 被回复邮件的 UID |
| `body` | string | yes | 回复正文 |
| `replyAll` | boolean | no | 默认 false |
| `from` | string | yes | |

Returns: `{ success, messageId }`

#### email_forward

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `imapConfig` | object | yes | |
| `smtpConfig` | object | yes | |
| `messageId` | string | yes | 被转发邮件的 UID |
| `to` | string | yes | 转发目标 |
| `from` | string | yes | |

Returns: `{ success, messageId }`

#### email_mark_read

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `imapConfig` | object | yes | |
| `messageId` | string | yes | 邮件 UID |

Returns: `{ success }`

### 目录结构

```
server/services/tools/email-mcp-server/
  ├── index.ts            # MCP Server 入口，注册 6 个工具
  ├── tools/
  │   ├── send.ts         # email_send
  │   ├── read-inbox.ts   # email_read_inbox
  │   ├── search.ts       # email_search
  │   ├── reply.ts        # email_reply
  │   ├── forward.ts      # email_forward
  │   └── mark-read.ts    # email_mark_read
  └── imap-client.ts      # imapflow 连接工厂（每次调用新建+断开）
```

## 主应用改动

### Database — EmailConfig

新增 `EmailConfig` 模型（Prisma schema）：

```prisma
model EmailConfig {
  id            String   @id @default(cuid())
  userId        String   @unique
  user          User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  imapHost      String
  imapPort      Int      @default(993)
  imapUser      String
  imapPassword  String   // AES-256-GCM 加密后存储
  smtpHost      String
  smtpPort      Int      @default(465)
  smtpUser      String
  smtpPassword  String   // AES-256-GCM 加密后存储
  emailAddress  String
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
}
```

### Encryption — server/services/email/crypto.ts

```
encryptCredential(plaintext: string): string  // AES-256-GCM
decryptCredential(ciphertext: string): string
```

- 密钥来源：`process.env.ENCRYPTION_KEY`（32 字节 hex）
- 首次运行时若未设置则 warn + 明文存储（降级处理，不阻塞启动）

### API Route — app/api/email/config/route.ts

| Method | Auth | Behavior |
|--------|------|----------|
| `GET` | `getCurrentUserId()` | 返回当前用户配置，密码字段返回 `"****"` |
| `PUT` | `getCurrentUserId()` | upsert 配置，密码不传则保留原值，传了则覆盖 |
| `POST` | `getCurrentUserId()` | 测试连接：用传入的 config 连一次 IMAP + SMTP，返回 `{ imap: ok/fail, smtp: ok/fail }` |

### Tool Wrapper — server/services/tools/email-tools-wrapper.ts

MCPClientManager 会自动注册 MCP Server 暴露的工具，但那些工具需要凭据参数。这个 wrapper 负责：

1. 在 `initTools()` 中，找到来自 email MCP server 的 6 个工具
2. 对每个工具的 `execute` 做包装（替换原 execute）：
   - 从 args 读取 `_userId`（由 stream.handler.ts 注入，同现有 `get_stock_info` 模式）
   - 从 `EmailConfig` 表查询配置
   - `decryptCredential()` 解密密码
   - 拼接 `imapConfig` / `smtpConfig` 注入 args
   - 删除 `_userId`，过滤密码字段后再记录日志
   - 调用原始 MCP 工具的 `execute`

### Stream Handler 改动 — server/services/chat/stream.handler.ts

在 `executeToolCalls` 调用前，对 email 系列工具注入 `_userId`（参考现有 `get_stock_info` 的注入点，第 276-278 行）。

### MCP Config — mcp-servers.json

```json
{
  "email": {
    "command": "node",
    "args": ["server/services/tools/email-mcp-server/index.ts"]
  }
}
```

## 前端 — 设置页

在现有 `/settings` 页面新增"邮箱配置"卡片（与简报配置同级）：

- 表单字段：邮箱地址、IMAP 服务器/端口/账号/密码、SMTP 服务器/端口/账号/密码
- SMTP 账号密码可一键复用 IMAP 的（大多数邮箱如此）
- 密码字段不回显（值始终为 `****`，修改时覆盖）
- "测试连接"按钮：POST `/api/email/config` 验证，显示每个服务端的连接状态
- "保存"按钮：PUT `/api/email/config`
- 状态提示：已配置 / 未配置 / 连接失败

## 数据流

### 用户发邮件

```
用户: "帮我把以下内容发给 boss@company.com：..."
  ↓
AI → tool_call: email_send { to: "boss@company.com", subject: "...", body: "..." }
  ↓
wrapper: 查 DB → 解密 → 注入 smtpConfig
  ↓
MCP Server email_send: nodemailer.createTransport(smtpConfig) → sendMail()
  ↓
返回 { success: true, messageId: "..." }
```

### 用户查邮件

```
用户: "最近有没有来自 foo@bar.com 的邮件？"
  ↓
AI → tool_call: email_search { from: "foo@bar.com" }
  ↓
wrapper: 查 DB → 解密 → 注入 imapConfig
  ↓
MCP Server email_search: imapflow connect → search() → fetch() → disconnect
  ↓
返回邮件列表
```

## 安全

- `ENCRYPTION_KEY` 仅存服务端环境变量，永不暴露给客户端
- 密码加密后入 DB，解密仅发生在服务端工具调用瞬间
- MCP Server 走 stdio transport，数据不跨网络
- MCP Server 无状态：不写文件、不缓存凭据，进程退出后内存释放
- 日志安全：wrapper 层在传参前剥离密码字段

## Implementation Order

1. Prisma schema — EmailConfig 模型 → migrate
2. `server/services/email/crypto.ts` — 加密/解密工具
3. `app/api/email/config/route.ts` — GET/PUT/POST API
4. `server/services/tools/email-mcp-server/` — MCP Server 全套
5. `mcp-servers.json` — 注册 email server
6. `server/services/tools/email-tools-wrapper.ts` — 凭据注入包装
7. `server/services/tools/index.ts` — 集成到 initTools
8. 前端设置页 — EmailConfig 表单 + 测试连接
9. 端到端验证
