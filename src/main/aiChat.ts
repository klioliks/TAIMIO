export interface AiChatRequest {
  system: string
  user: string
  json?: boolean
}

export type AiChatFn = (request: AiChatRequest) => Promise<string>
