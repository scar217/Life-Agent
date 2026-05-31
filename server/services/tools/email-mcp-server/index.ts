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
