/**
 * SiliconFlow AI API 封装
 * 
 * 负责与 SiliconFlow API 的通信
 */

import { getModelById } from '@/features/chat/constants/models'

const SILICONFLOW_API_URL = 'https://api.siliconflow.cn/v1/chat/completions'
// 设置最大等待时间
const REQUEST_TIMEOUT_MS = 120000
// 设置最大重试次数
const MAX_RETRIES = 2

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatCompletionOptions {
  model: string
  messages: ChatMessage[]
  enableThinking?: boolean
  thinkingBudget?: number
  tools?: unknown[]
  toolChoice?: 'auto' | 'required' | { type: 'function'; function: { name: string } }
}

export interface SiliconFlowResponse {
  reader: ReadableStreamDefaultReader<Uint8Array>
}

/**
 * 调用 SiliconFlow Chat Completion API（流式）
 */
export async function createChatCompletion(
  apiKey: string,
  options: ChatCompletionOptions
): Promise<SiliconFlowResponse> {
  const { model, messages, enableThinking = false, thinkingBudget = 4096, tools, toolChoice } = options
  
  const modelInfo = getModelById(model)
  
  // 构建请求体 Record声明requestBody是键值对类型
  const requestBody: Record<string, unknown> = {
    model,
    messages,
    stream: true,
    temperature: 0.7,
    max_tokens: enableThinking || modelInfo?.isReasoningModel ? 4096 : 1024,
  }

  // Reasoning 模型：只用 thinking_budget
  if (modelInfo?.isReasoningModel) {
    requestBody.thinking_budget = thinkingBudget
  }
  // 普通模型支持思考开关：用 enable_thinking + thinking_budget
  else if (enableThinking && modelInfo?.supportsThinkingToggle) {
    requestBody.enable_thinking = true
    requestBody.thinking_budget = thinkingBudget
  }

  // 如果提供了 tools，添加到请求中
  if (tools && Array.isArray(tools) && tools.length > 0) {
    requestBody.tools = tools
    // 默认 auto，有工具时让 AI 自己决定
    requestBody.tool_choice = toolChoice || 'auto'
  }

  let lastError: unknown = null

  // 最大重试
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    // 创建一个 AbortController 实例，用于在请求超时后终止请求
    const controller = new AbortController()
    // 设置定时器，到达最大等待时间终止请求
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

    try {
      // 向 SiliconFlow API 发送请求
      const response = await fetch(SILICONFLOW_API_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`SiliconFlow API error: ${response.status} - ${errorText}`)
      }

      const reader = response.body?.getReader()
      if (!reader) {
        throw new Error('No stream available')
      }
      // 返回 大模型返回的reader流
      return { reader }
    } catch (error) {
      lastError = error

      const message = error instanceof Error ? error.message : String(error)
      const isRetryable =
        message.includes('ECONNRESET') ||
        message.includes('UND_ERR_BODY_TIMEOUT') ||
        message.includes('Body Timeout Error') ||
        message.includes('network') ||
        message.includes('fetch failed') ||
        message.includes('aborted')

      if (!isRetryable || attempt === MAX_RETRIES) {
        break
      }

      const delayMs = 800 * attempt
      console.warn(`[SiliconFlow] Request failed (attempt ${attempt}/${MAX_RETRIES}), retrying in ${delayMs}ms: ${message}`)
      // 设置等待时间，结束后重新发起
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    } finally {
      clearTimeout(timer)
    }
  }

  throw lastError instanceof Error ? lastError : new Error('SiliconFlow request failed')
}
