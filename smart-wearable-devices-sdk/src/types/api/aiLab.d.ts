export type AiLabStatus = -1 | 0 | 1 | 2;

export interface AiLabStatusResponse {
  userId: number;
  status: AiLabStatus;
  statusText: string;
  jumpUrl?: string;
  applyTime?: string;
  auditTime?: string;
  remark?: string;
}

export interface H5TicketResponse {
  ticket: string;
  expiresIn?: number;
}

export interface ApiResponse<T = any> {
  code: number;
  msg: string;
  data: T;
}
