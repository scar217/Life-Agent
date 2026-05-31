import { prisma } from '@/server/db/client'

export const EmailConfigRepository = {
  async findByUserId(userId: string) {
    return prisma.emailConfig.findUnique({ where: { userId } })
  },

  async upsert(
    userId: string,
    data: {
      imapHost: string
      imapPort: number
      imapUser: string
      imapPassword: string
      smtpHost: string
      smtpPort: number
      smtpUser: string
      smtpPassword: string
      emailAddress: string
    }
  ) {
    return prisma.emailConfig.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    })
  },
}
