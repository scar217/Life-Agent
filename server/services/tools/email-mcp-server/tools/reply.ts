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
