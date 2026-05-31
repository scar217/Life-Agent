import { NextResponse } from 'next/server'
import { getCurrentUserId } from '@/server/auth/utils'
import { BriefingRepository } from '@/server/repositories/briefing.repository'
import { z } from 'zod'

const configSchema = z.object({
  email: z.string().email('请输入有效的邮箱地址'),
  pushHour: z.number().int().min(0).max(23),
  city: z.string().optional(),
  newsTopics: z.string().optional(),
  isEnabled: z.boolean(),
})

export async function GET() {
  try {
    const userId = await getCurrentUserId()
    const config = await BriefingRepository.findByUserId(userId)
    return NextResponse.json(config)
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
}

export async function PUT(req: Request) {
  try {
    const userId = await getCurrentUserId()
    const body = await req.json()
    const parsed = configSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    }
    const config = await BriefingRepository.upsert(userId, parsed.data)
    return NextResponse.json(config)
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
}
