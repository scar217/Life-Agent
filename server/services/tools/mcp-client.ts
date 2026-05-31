/**
 * MCP Client Manager
 *
 * 负责连接外部 MCP Server，发现工具，并包装为 Tool 接口注册到 ToolRegistry。
 * 现有原生工具不动，MCP 工具纯增量接入。
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { existsSync, readFileSync } from 'fs'
import { resolve } from 'path'
import type { Tool, IToolRegistry, ToolParameterSchema } from './types'

interface MCPServerRawConfig {
  command: string
  args?: string[]
  env?: Record<string, string>
}

interface MCPConfig {
  mcpServers: Record<string, MCPServerRawConfig>
}

interface MCPToolDef {
  name: string
  description?: string
  inputSchema: {
    type: 'object'
    properties?: Record<string, object>
    required?: string[]
  }
}

interface ServerConnection {
  client: Client
  transport: StdioClientTransport
  connectedAt: number
}

/** 用 process.env 替换 ${VAR_NAME} 占位符 */
function interpolateEnv(value: string): string {
  return value.replace(/\$\{(\w+)\}/g, (_, name: string) => process.env[name] ?? '')
}

function resolveServerEnv(raw: MCPServerRawConfig): {
  command: string
  args: string[]
  env?: Record<string, string>
} {
  return {
    command: raw.command,
    args: (raw.args ?? []).map(interpolateEnv),
    env: raw.env
      ? Object.fromEntries(Object.entries(raw.env).map(([k, v]) => [k, interpolateEnv(v)]))
      : undefined,
  }
}

export class MCPClientManager {
  private connections = new Map<string, ServerConnection>()
  private config: MCPConfig | null = null

  constructor(private configPath: string) {}

  /** 加载 JSON 配置文件。文件不存在或格式错误返回 false。 */
  loadConfig(): boolean {
    const fullPath = resolve(process.cwd(), this.configPath)
    if (!existsSync(fullPath)) {
      console.log('[MCP] No mcp-servers.json found, MCP disabled')
      return false
    }
    try {
      const raw = readFileSync(fullPath, 'utf-8')
      this.config = JSON.parse(raw)
      return true
    } catch (err) {
      console.warn('[MCP] Failed to parse mcp-servers.json:', err)
      return false
    }
  }

  /** 是否有可用配置 */
  hasConfig(): boolean {
    return this.config !== null && Object.keys(this.config.mcpServers).length > 0
  }

  /** 连接所有 MCP Server 并注册工具到 Registry */
  async connectAndRegister(registry: IToolRegistry, existingToolNames: Set<string>): Promise<void> {
    if (!this.config) return

    for (const [serverName, rawConfig] of Object.entries(this.config.mcpServers)) {
      try {
        const config = resolveServerEnv(rawConfig)
        console.log(`[MCP] Connecting to "${serverName}" (${config.command} ${config.args.join(' ')})...`)

        const transport = new StdioClientTransport({
          command: config.command,
          args: config.args,
          env: config.env,
          stderr: 'pipe',
        })

        // 转发 stderr 到控制台，方便调试
        const stderrStream = transport.stderr
        if (stderrStream) {
          stderrStream.on('data', (data: Buffer) => {
            console.log(`[MCP:${serverName}] ${data.toString().trim()}`)
          })
        }

        const client = new Client({ name: 'sky-chat-app', version: '0.1.0' })
        await client.connect(transport)

        const { tools } = await client.listTools()

        if (!tools || tools.length === 0) {
          console.log(`[MCP] Server "${serverName}" has no tools, skipping`)
          await client.close()
          continue
        }

        // 缓存连接
        this.connections.set(serverName, {
          client,
          transport,
          connectedAt: Date.now(),
        })

        // 注册工具（跳过与原生工具同名的）
        let registered = 0
        for (const toolDef of tools as MCPToolDef[]) {
          if (existingToolNames.has(toolDef.name)) {
            console.warn(`[MCP] Tool "${toolDef.name}" from "${serverName}" conflicts, skipping`)
            continue
          }
          registry.register(this.wrapMCPTool(serverName, client, toolDef))
          existingToolNames.add(toolDef.name)
          registered++
        }

        console.log(`[MCP] Server "${serverName}" connected, ${registered}/${tools.length} tools registered`)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.warn(`[MCP] Failed to connect to "${serverName}": ${msg}`)
      }
    }
  }

  /** 将 MCP 工具包装为 Tool 接口 */
  private wrapMCPTool(serverName: string, client: Client, toolDef: MCPToolDef): Tool {
    return {
      name: toolDef.name,
      description: toolDef.description || `MCP tool: ${toolDef.name}`,
      parameters: this.convertInputSchema(toolDef.inputSchema),
      execute: async (args: Record<string, unknown>) => {
        try {
          const result = await client.callTool({ name: toolDef.name, arguments: args })

          // 提取 text 内容给 AI
          const textParts: string[] = []
          if (result.content && Array.isArray(result.content)) {
            for (const item of result.content) {
              if (item.type === 'text' && 'text' in item && item.text) {
                textParts.push(item.text as string)
              }
            }
          }

          if (textParts.length > 0) return textParts.join('\n')
          return JSON.stringify({ content: result.content, isError: result.isError ?? false })
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          console.error(`[MCP] Tool "${toolDef.name}" failed:`, msg)

          // 传输层错误 → 尝试重连一次
          if (msg.includes('Transport') || msg.includes('not connected') || msg.includes('closed')) {
            try {
              await this.reconnectServer(serverName)
              const result = await client.callTool({ name: toolDef.name, arguments: args })
              const textParts: string[] = []
              if (result.content && Array.isArray(result.content)) {
                for (const item of result.content) {
                  if (item.type === 'text' && 'text' in item && item.text) {
                    textParts.push(item.text as string)
                  }
                }
              }
              return textParts.join('\n') || JSON.stringify({ content: result.content, isError: false })
            } catch (retryErr) {
              const retryMsg = retryErr instanceof Error ? retryErr.message : String(retryErr)
              return JSON.stringify({ error: retryMsg })
            }
          }

          return JSON.stringify({ error: msg })
        }
      },
    }
  }

  /** 转换 MCP inputSchema 为 ToolParameterSchema */
  private convertInputSchema(schema: MCPToolDef['inputSchema']): ToolParameterSchema {
    return {
      type: 'object',
      properties: (schema.properties || {}) as ToolParameterSchema['properties'],
      required: schema.required || [],
    }
  }

  /** 重新连接指定的 MCP Server */
  private async reconnectServer(serverName: string): Promise<void> {
    const rawConfig = this.config?.mcpServers[serverName]
    if (!rawConfig) throw new Error(`No config for server "${serverName}"`)

    // 关闭旧连接
    const old = this.connections.get(serverName)
    if (old) {
      try { await old.client.close() } catch { /* ignore */ }
      this.connections.delete(serverName)
    }

    const config = resolveServerEnv(rawConfig)
    console.log(`[MCP] Reconnecting to "${serverName}"...`)

    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args,
      env: config.env,
      stderr: 'pipe',
    })

    const stderrStream = transport.stderr
    if (stderrStream) {
      stderrStream.on('data', (data: Buffer) => {
        console.log(`[MCP:${serverName}] ${data.toString().trim()}`)
      })
    }

    const client = new Client({ name: 'sky-chat-app', version: '0.1.0' })
    await client.connect(transport)

    this.connections.set(serverName, { client, transport, connectedAt: Date.now() })
    console.log(`[MCP] Reconnected to "${serverName}"`)
  }

  /** 优雅关闭所有连接 */
  async closeAll(): Promise<void> {
    for (const [name, conn] of this.connections) {
      try {
        await conn.client.close()
        console.log(`[MCP] Closed connection to "${name}"`)
      } catch { /* ignore */ }
    }
    this.connections.clear()
  }
}
