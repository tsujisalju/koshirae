import { ERROR_STATUS, type ErrorCode } from "@koshirae/core";

export class ApiError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
  get status() {
    return ERROR_STATUS[this.code];
  }
}
