/**
 * Email Tools Wrapper
 *
 * 拦截 MCP email 工具，注入解密后的 IMAP/SMTP 凭据。
 */
import { EmailConfigRepository } from '@/server/repositories/email-config.repository'
import { decryptCredential } from '@/server/services/email/crypto'
import type { IToolRegistry } from './types'

const EMAIL_TOOLS = [
  'email_send',
  'email_read_inbox',
  'email_search',
  'email_reply',
  'email_forward',
  'email_mark_read',
]

export function wrapEmailTools(registry: IToolRegistry): void {
  for (const name of EMAIL_TOOLS) {
    const tool = registry.get(name)
    if (!tool) {
      console.warn(`[EmailWrapper] Tool "${name}" not found in registry, skipping`)
      continue
    }

    const originalExecute = tool.execute

    // Bypass readonly constraint on Tool.execute
    const mutableTool = tool as { execute: (args: Record<string, unknown>) => Promise<string> }

    mutableTool.execute = async (args: Record<string, unknown>) => {
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

        const newArgs: Record<string, unknown> = {
          ...args,
          imapConfig,
          smtpConfig,
          from: config.emailAddress,
        }

        delete newArgs._userId

        const safeLog = JSON.stringify({
          tool: name,
          imapConfig: { ...imapConfig, password: '***' },
          smtpConfig: { ...smtpConfig, password: '***' },
        })
        console.log(`[EmailWrapper] Calling "${name}": ${safeLog.substring(0, 300)}`)

        return await originalExecute(newArgs)
      } catch (e) {
        const msg = e instanceof Error ? e.message : '凭据解密失败'
        return JSON.stringify({ error: msg })
      }
    }
  }
}
