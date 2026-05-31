import { createImapConnection, fetchEmails, type ImapConfig } from '../imap-client'

export async function executeEmailSearch(
  imapConfig: ImapConfig,
  params: { from?: string; subject?: string; since?: string; before?: string; keyword?: string; folder?: string; limit?: number }
): Promise<string> {
  const client = await createImapConnection(imapConfig)
  try {
    const criteria: Record<string, unknown> = {}
    if (params.from) criteria.from = params.from
    if (params.subject) criteria.subject = params.subject
    if (params.since) criteria.since = params.since
    if (params.before) criteria.before = params.before
    if (params.keyword) criteria.body = params.keyword

    const messages = await fetchEmails(client, params.folder || 'INBOX', criteria, params.limit || 50)
    return JSON.stringify({ success: true, messages })
  } finally {
    await client.logout()
  }
}
