/**
 * NextAuth.js v4 配置：https://next-auth.js.org/configuration/options
 * 
 * 统一的认证配置文件，包含所有 providers 和 callbacks
 */

import type { NextAuthOptions } from 'next-auth'
import NextAuth from 'next-auth'
import { PrismaAdapter } from '@next-auth/prisma-adapter'
import GoogleProvider from 'next-auth/providers/google'
import GitHubProvider from 'next-auth/providers/github'
import CredentialsProvider from 'next-auth/providers/credentials'
import bcrypt from 'bcryptjs'
import { prisma } from '@/server/db/client'

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma),
  
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: {
        params: {
          prompt: 'select_account',
          access_type: 'offline',
          response_type: 'code',
        },
      },
    }),
    
    GitHubProvider({
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
      authorization: {
        params: {
          prompt: 'consent',
        },
      },
    }),
    
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      // Authjs要求：返回一个对象登录成功，返回null登录失败
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null
        }

        const user = await prisma.user.findUnique({
          where: { email: credentials.email },
        })

        if (!user || !user.password) {
          return null
        }

        const isPasswordValid = await bcrypt.compare(
          credentials.password,
          user.password
        )

        if (!isPasswordValid) {
          return null
        }

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
        }
      },
    }),
  ],
  
  pages: {
    signIn: '/auth/signin',
    error: '/auth/error',
  },
  
  session: {
    strategy: 'jwt', // 使用 JWT 来存储会话信息
    maxAge: 7 * 24 * 60 * 60, // 会话过期时间(s) 7 days
  },
  // 控制当执行某个操作时会发生什么
  callbacks: {
    async signIn({ user, account }) {
      if (!user.email) return true

      const existingUser = await prisma.user.findUnique({
        where: { email: user.email },
        include: { accounts: true },
      })

      if (!existingUser) return true

      // 检查账号是否已关联
      const accountAlreadyLinked = existingUser.accounts.some(
        (acc: { provider: string }) => acc.provider === account?.provider
      )
      if (accountAlreadyLinked) return true

      // Credentials 登录
      if (account?.provider === 'credentials') {
        user.id = existingUser.id // 把id设置为数据库记录的id
        return true
      }

      // OAuth 自动关联
      const canAutoLink =
        existingUser.emailVerified ||
        account?.provider === 'google' ||
        account?.provider === 'github'

      if (canAutoLink && account) {
        try {
          await prisma.account.create({
            data: {
              userId: existingUser.id,
              type: account.type,
              provider: account.provider,
              providerAccountId: account.providerAccountId,
              access_token: account.access_token,
              refresh_token: account.refresh_token,
              expires_at: account.expires_at,
              token_type: account.token_type,
              scope: account.scope,
              id_token: account.id_token,
              session_state: account.session_state,
            },
          })

          user.id = existingUser.id

          if (!existingUser.emailVerified) {
            await prisma.user.update({
              where: { id: existingUser.id },
              data: { emailVerified: new Date() },
            })
          }

          return true
        } catch (error) {
          console.error('[Auth] Failed to link account:', error)
          return false
        }
      }

      return false
    },

    /**
     * 触发条件：
     *  /api/auth/signin、/api/auth/session 的请求
     *  getSession()、getServerSession()、useSession() 方法调用
     * 
     * @param param0 
     * @returns 
     */
    async jwt({ token, user }) {
      // user仅在用户登录后，首次调用此回调函数时传递
      if (user) {
        token.id = user.id
      }
      return token
    },
    
    /**
     * 触发条件：
     * getSession()，useSession()，/api/auth/session 的请求
     * @param param0 
     * @returns 
     */
    async session({ session, token }) {
      if (token.sub && session.user) {
        session.user.id = token.sub
      }
      return session
    },
  },
  
  debug: process.env.NODE_ENV === 'development',
}

// NextAuth() 的返回值里有一个 handlers 属性
export default NextAuth(authOptions)
