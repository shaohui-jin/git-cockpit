export type ChatRole = 'user' | 'assistant' | 'system' | 'tool';

export interface ChatLine {
  id: number;
  role: ChatRole;
  text: string;
  tool?: string;
  success?: boolean;
}

export interface PendingConfirm {
  token: string;
  tool: string;
  command: string;
  affectedFiles: string[];
  note?: string;
}
