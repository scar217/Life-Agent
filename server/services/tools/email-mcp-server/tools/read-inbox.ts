import { createImapConnection, fetchEmails, type ImapConfig } from '../imap-client'

export async function executeEmailReadInbox(
  imapConfig: ImapConfig,
  params: { limit?: number; folder?: string }
): Promise<string> {
  const client = await createImapConnection(imapConfig)
  try {
    const messages = await fetchEmails(client, params.folder || 'INBOX', {}, params.limit || 20)
    return JSON.stringify({ success: true, messages })
  } finally {
    await client.logout()
  }
}
