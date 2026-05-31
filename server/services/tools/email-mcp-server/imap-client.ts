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
  if (!uids || uids.length === 0) return []

  const targetUids = uids.slice(-Math.min(limit, uids.length))

  const messages: EmailSummary[] = []
  for await (const msg of client.fetch(
    targetUids,
    { uid: true, envelope: true, bodyStructure: true, flags: true },
    { uid: true }
  )) {
    const env = msg.envelope
    const preview = await fetchPreview(client, msg.uid)
    messages.push({
      uid: msg.uid,
      subject: env?.subject || '',
      from: env?.from?.[0] ? `${env.from[0].name || ''} <${env.from[0].address}>` : '',
      date: env?.date ? env.date.toISOString() : '',
      flags: [...(msg.flags || [])].map((f) => String(f)),
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
