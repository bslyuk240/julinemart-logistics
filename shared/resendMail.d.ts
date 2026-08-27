export const RESEND_BATCH_LIMIT: number;

export type ResendAttachment = {
  filename: string;
  content: string | Buffer;
};

export type ResendSendInput = {
  from: string;
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  replyTo?: string;
  attachments?: ResendAttachment[];
};

export type ResendBatchItem = {
  from: string;
  to: string[];
  subject: string;
  html?: string;
  text?: string;
};

export function sendResendEmail(apiKey: string, input: ResendSendInput): Promise<unknown>;
export function sendResendBatch(apiKey: string, emails: ResendBatchItem[]): Promise<unknown[]>;
export function verifyResendKey(apiKey: string): Promise<unknown>;
