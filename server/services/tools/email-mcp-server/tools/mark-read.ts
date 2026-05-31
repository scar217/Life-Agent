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
