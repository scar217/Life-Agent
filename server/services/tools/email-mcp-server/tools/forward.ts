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

    if (!fetched || !fetched.envelope) return JSON.stringify({ success: false, error: '原始邮件未找到' })

    const envelope = fetched.envelope
    const subject = (envelope.subject || '').startsWith('Fwd:')
      ? envelope.subject!
      : `Fwd: ${envelope.subject || ''}`

    const body = `<p>---------- 转发的邮件 ----------</p>
<p>发件人: ${envelope.from?.[0]?.name || ''} &lt;${envelope.from?.[0]?.address || ''}&gt;</p>
<p>日期: ${envelope.date?.toISOString() || ''}</p>
<p>主题: ${envelope.subject || ''}</p>
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
