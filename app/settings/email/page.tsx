'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { toast } from '@/lib/hooks/use-toast'

export default function EmailSettingsPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ imap: string; smtp: string } | null>(null)

  const [emailAddress, setEmailAddress] = useState('')
  const [imapHost, setImapHost] = useState('')
  const [imapPort, setImapPort] = useState(993)
  const [imapUser, setImapUser] = useState('')
  const [imapPassword, setImapPassword] = useState('')
  const [smtpHost, setSmtpHost] = useState('')
  const [smtpPort, setSmtpPort] = useState(465)
  const [smtpUser, setSmtpUser] = useState('')
  const [smtpPassword, setSmtpPassword] = useState('')
  const [useSameAccount, setUseSameAccount] = useState(true)

  useEffect(() => {
    fetch('/api/email/config')
      .then((res) => {
        if (res.status === 401) { router.push('/auth/signin'); return null }
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json()
      })
      .then((data) => {
        if (data) {
          setEmailAddress(data.emailAddress || '')
          setImapHost(data.imapHost || '')
          setImapPort(data.imapPort || 993)
          setImapUser(data.imapUser || '')
          setImapPassword(data.imapPassword || '')
          setSmtpHost(data.smtpHost || '')
          setSmtpPort(data.smtpPort || 465)
          setSmtpUser(data.smtpUser || '')
          setSmtpPassword(data.smtpPassword || '')
        }
      })
      .catch(() => toast({ title: '加载配置失败' }))
      .finally(() => setLoading(false))
  }, [router])

  async function handleTestConnection() {
    setTesting(true)
    setTestResult(null)

    const imapPwd = imapPassword && imapPassword !== '****' ? imapPassword : ''
    const smtpPwd = smtpPassword && smtpPassword !== '****' ? smtpPassword : (useSameAccount ? imapPwd : '')

    const payload: Record<string, unknown> = {
      imapHost, imapPort, imapUser,
      imapPassword: imapPwd,
      smtpHost, smtpPort,
      smtpUser: smtpUser || (useSameAccount ? imapUser : ''),
      smtpPassword: smtpPwd,
    }

    try {
      const res = await fetch('/api/email/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const result = await res.json()
      if (result.error) {
        toast({ title: result.error })
        return
      }
      setTestResult(result)
      if (result.imap === 'ok' && result.smtp === 'ok') {
        toast({ title: '连接测试通过' })
      } else {
        toast({ title: '连接测试失败，请检查配置' })
      }
    } catch {
      toast({ title: '测试请求失败' })
    }
    setTesting(false)
  }

  async function handleSave() {
    setSaving(true)

    const smtpPasswordToSave = useSameAccount ? (imapPassword || '****') : (smtpPassword || '****')
    const smtpUserToSave = useSameAccount ? (smtpUser || imapUser) : smtpUser

    const res = await fetch('/api/email/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        emailAddress,
        imapHost, imapPort, imapUser,
        imapPassword: imapPassword || '****',
        smtpHost, smtpPort,
        smtpUser: smtpUserToSave,
        smtpPassword: smtpPasswordToSave,
      }),
    })
    if (res.ok) {
      toast({ title: '保存成功' })
    } else {
      const data = await res.json()
      toast({ title: data.error || '保存失败' })
    }
    setSaving(false)
  }

  if (loading) return <div className="flex justify-center p-10">加载中...</div>

  return (
    <div className="max-w-lg mx-auto p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => router.back()} className="h-8 w-8">
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-2xl font-bold">邮箱配置</h1>
      </div>

      <div className="space-y-2">
        <Label htmlFor="emailAddress">邮箱地址 *</Label>
        <Input id="emailAddress" type="email" value={emailAddress} onChange={(e) => setEmailAddress(e.target.value)} placeholder="your@email.com" />
      </div>

      <h2 className="text-lg font-semibold pt-2">IMAP（收件）</h2>
      <div className="grid grid-cols-3 gap-2">
        <div className="col-span-2 space-y-2">
          <Label htmlFor="imapHost">服务器地址</Label>
          <Input id="imapHost" value={imapHost} onChange={(e) => setImapHost(e.target.value)} placeholder="imap.example.com" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="imapPort">端口</Label>
          <Input id="imapPort" type="number" value={imapPort} onChange={(e) => setImapPort(Number(e.target.value))} />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="imapUser">账号</Label>
        <Input id="imapUser" value={imapUser} onChange={(e) => setImapUser(e.target.value)} placeholder="your@email.com" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="imapPassword">密码 / 授权码</Label>
        <Input id="imapPassword" type="password" value={imapPassword} onChange={(e) => setImapPassword(e.target.value)} placeholder="****" />
      </div>

      <h2 className="text-lg font-semibold pt-2">SMTP（发件）</h2>
      <div className="flex items-center justify-between">
        <Label>与 IMAP 使用相同账号密码</Label>
        <Switch checked={useSameAccount} onCheckedChange={setUseSameAccount} />
      </div>
      {!useSameAccount && (
        <>
          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-2 space-y-2">
              <Label htmlFor="smtpHost">服务器地址</Label>
              <Input id="smtpHost" value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} placeholder="smtp.example.com" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="smtpPort">端口</Label>
              <Input id="smtpPort" type="number" value={smtpPort} onChange={(e) => setSmtpPort(Number(e.target.value))} />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="smtpUser">账号</Label>
            <Input id="smtpUser" value={smtpUser} onChange={(e) => setSmtpUser(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="smtpPassword">密码 / 授权码</Label>
            <Input id="smtpPassword" type="password" value={smtpPassword} onChange={(e) => setSmtpPassword(e.target.value)} placeholder="****" />
          </div>
        </>
      )}

      {testResult && (
        <div className="p-3 rounded-md border space-y-1">
          <div className={`text-sm ${testResult.imap === 'ok' ? 'text-green-600' : 'text-red-600'}`}>
            IMAP: {testResult.imap === 'ok' ? '连接成功' : testResult.imap}
          </div>
          <div className={`text-sm ${testResult.smtp === 'ok' ? 'text-green-600' : 'text-red-600'}`}>
            SMTP: {testResult.smtp === 'ok' ? '连接成功' : testResult.smtp}
          </div>
        </div>
      )}

      <div className="flex gap-3">
        <Button onClick={handleTestConnection} disabled={testing} variant="outline" className="flex-1">
          {testing ? '测试中...' : '测试连接'}
        </Button>
        <Button onClick={handleSave} disabled={saving} className="flex-1">
          {saving ? '保存中...' : '保存'}
        </Button>
      </div>
    </div>
  )
}
