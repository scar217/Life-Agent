import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserId } from '@/server/auth/utils'
import { EmailConfigRepository } from '@/server/repositories/email-config.repository'
import { encryptCredential } from '@/server/services/email/crypto'
import * as nodemailer from 'nodemailer'

function isPrivateHost(host: string): boolean {
  // IPv4 private/loopback ranges
  const privatePatterns = [
    /^127\./,
    /^10\./,
    /^172\.(1[6-9]|2\d|3[01])\./,
    /^192\.168\./,
    /^0\./,
    /^169\.254\./,
  ]
  // IPv6 loopback
  if (host === '::1' || host === 'localhost') return true
  return privatePatterns.some((p) => p.test(host))
}

export async function GET() {
  try {
    const userId = await getCurrentUserId()
    const config = await EmailConfigRepository.findByUserId(userId)
    if (!config) return NextResponse.json(null)
    return NextResponse.json({
      ...config,
      imapPassword: '****',
      smtpPassword: '****',
    })
  } catch (e) {
    if (e instanceof Error && e.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    throw e
  }
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
  await getCurrentUserId()
  const body = await req.json()

  if (isPrivateHost(body.imapHost || '') || isPrivateHost(body.smtpHost || '')) {
    return NextResponse.json({ error: '不允许连接到内网地址' }, { status: 400 })
  }

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
