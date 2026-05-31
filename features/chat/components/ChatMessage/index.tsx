'use client'

/**
 * Chat Message Module - 消息模块
 * 
 * Container Component（容器组件）
 * 连接 Store，使用消息状态机
 * 
 * @module modules/chat-message
 */

import { useParams } from 'next/navigation'
import { useChatStore } from '@/features/chat/store/chat.store'
import { selectMessagePhase, selectIsProcessing } from '@/features/chat/store/selectors'
import { ChatService } from '@/features/chat/services/chat.service'
import { ChatMessageUI } from './ChatMessageUI'

interface ChatMessageProps {
  messageId: string
}

export function ChatMessage({ messageId }: ChatMessageProps) {
  const params = useParams()
  const conversationId = params.conversationId as string

  // Store 数据
  const message = useChatStore((s) => s.messages.find((m) => m.id === messageId))
  const messages = useChatStore((s) => s.messages)
  const isSendingMessage = useChatStore((s) => s.isSendingMessage)
  
  // 返回消息当前所处阶段：
  // 'idle'(默认值) → 'thinking' → 'tool_calling' → 'answering' → 'idle' → 'error'
  const phase = useChatStore(selectMessagePhase(messageId))
  // 判断消息是否正在"工作中"
  const isProcessing = useChatStore(selectIsProcessing(messageId))

  if (!message) return null

  // 当前消息是否是消息列表的最后一条
  const isLastMessage = messages[messages.length - 1]?.id === messageId
  // 当前消息的发送者是 AI
  const isAIMessage = message.role === 'assistant'
  // 当前消息是否正在"等待 AI 回复"
  // ( 用户刚发消息，前端正等AI流式返回 && 当前消息是最后一条 && 是AI消息 )
  const isWaitingForResponse = isSendingMessage && isLastMessage && isAIMessage
  
  /**
   *  操作回调函数
   *  
   * */ 

  // AI消息重试
  const handleRetry = isAIMessage 
    ? () => ChatService.retryMessage(conversationId, messageId) 
    : undefined

  // 编辑后重新发送
  const handleEdit = message.role === 'user' 
    ? (newContent: string) => ChatService.editAndResend(conversationId, messageId, newContent) 
    : undefined

  // 取消工具执行
  const handleCancelTool = isAIMessage
    ? (toolCallId: string) => ChatService.cancelTool(messageId, toolCallId)
    : undefined

  return (
    <ChatMessageUI
      message={message}
      messageId={messageId}
      phase={phase}
      isProcessing={isProcessing}
      isWaitingForResponse={isWaitingForResponse}
      onRetry={handleRetry}
      onEdit={handleEdit}
      onCancelTool={handleCancelTool}
    />
  )
}

