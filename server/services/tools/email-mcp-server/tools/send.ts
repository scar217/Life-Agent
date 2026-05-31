import * as nodemailer from 'nodemailer'

export interface SmtpConfig {
  host: string
  port: number
  user: string
  password: string
}

export async function executeEmailSend(
  smtpConfig: SmtpConfig,
  params: { to: string; subject: string; body: string; cc?: string; from: string }
): Promise<string> {
  const transporter = nodemailer.createTransport({
    host: smtpConfig.host,
    port: smtpConfig.port,
    secure: smtpConfig.port === 465,
    auth: { user: smtpConfig.user, pass: smtpConfig.password },
  })

  const info = await transporter.sendMail({
    from: params.from,
    to: params.to,
    cc: params.cc,
    subject: params.subject,
    html: params.body,
  })

  return JSON.stringify({ success: true, messageId: info.messageId })
}
