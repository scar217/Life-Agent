/**
 * SSE 事件写入器
 */

import type { ToolCall } from '@/server/services/tools'

/**
 * SSE 事件写入器
 */
export class SSEWriter {
  private _controller: ReadableStreamDefaultController
  private _encoder: TextEncoder
  private _sessionId: string
  private _closed = false

  constructor(controller: ReadableStreamDefaultController, encoder: TextEncoder, sessionId: string) {
    this._controller = controller
    this._encoder = encoder
    this._sessionId = sessionId
  }

  private _send(data: Record<string, unknown>): void {
    if (this._closed) return
    try {
      /**
       * 将数据编码为字节流，并添加到流中
       *  SSE要求：
       *    1.每一条消息必须以 data:  开头，
       *    2.并以两个换行符 \n\n 结尾。
       *  */ 
      this._controller.enqueue(this._encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
    } catch {
      this._closed = true
    }
  }
  
  // 前端根据type类型处理渲染
  //  注意：sessionId在前端中没有用到！！！
  sendThinking(content: string): void {
    this._send({ type: 'thinking', content, sessionId: this._sessionId })
  }

  sendAnswer(content: string): void {
    this._send({ type: 'answer', content, sessionId: this._sessionId })
  }

  sendToolCall(tc: ToolCall): void {
    let args: Record<string, unknown> = {}
    try { args = JSON.parse(tc.function.arguments) } 
    catch { 
      /* ignore */ 
    }

    const event: Record<string, unknown> = {
      type: 'tool_call',
      toolCallId: tc.id,
      name: tc.function.name,
      sessionId: this._sessionId,
    }

    if (tc.function.name === 'web_search') event.query = args.query
    if (tc.function.name === 'get_weather') event.city = args.city
    if (tc.function.name === 'generate_image') event.prompt = args.prompt
    if (tc.function.name === 'get_stock_info') {
      event.action = args.action
      event.symbols = args.symbols
    }

    this._send(event)
  }

  sendToolProgress(toolCallId: string, progress: number): void {
    this._send({ type: 'tool_progress', toolCallId, progress, sessionId: this._sessionId })
  }

  sendToolResult(result: { toolCallId: string; name: string; success: boolean; content: string }): void {
    let parsed: Record<string, unknown> = {}
    try { parsed = JSON.parse(result.content) } catch { /* ignore */ }

    const event: Record<string, unknown> = {
      type: 'tool_result',
      toolCallId: result.toolCallId,
      name: result.name,
      success: result.success,
      sessionId: this._sessionId,
    }

    if (result.name === 'web_search') {
      event.resultCount = parsed.resultCount || 0
      event.sources = parsed.sources || []
    }
    if (result.name === 'generate_image') {
      event.imageUrl = parsed.url
      event.width = parsed.width
      event.height = parsed.height
    }
    if (result.name === 'get_stock_info') {
      event.action = parsed.action
      event.items = parsed.items
      event.sectors = parsed.sectors
      event.gainers = parsed.gainers
      event.resultCount = (parsed.items as unknown[])?.length || (parsed.sectors as unknown[])?.length || (parsed.gainers as unknown[])?.length || 0
    }

    this._send(event)
  }

  sendErrorMessage(message: string): void {
    this._send({ type: 'error', message, sessionId: this._sessionId })
  }

  sendComplete(): void {
    if (this._closed) return
    this._send({ type: 'complete', sessionId: this._sessionId })
    try { this._controller.enqueue(this._encoder.encode('data: [DONE]\n\n')) } catch { /* ignore */ }
  }

  close(): void {
    if (this._closed) return
    this._closed = true
    try { this._controller.close() } catch { /* ignore */ }
  }

  error(err: unknown): void {
    if (this._closed) return
    this._closed = true
    try { this._controller.error(err) } catch { /* ignore */ }
  }
}
