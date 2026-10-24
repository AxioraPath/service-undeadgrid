import type { ApiError, ErrorCode } from '../contracts';

/**
 * Error de dominio con un código estable. El gateway lo captura y lo convierte
 * en un ack `{ ok: false, error }`. Nunca se filtra un stack trace al cliente.
 */
export class DomainError extends Error {
  readonly code: ErrorCode;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.details = details;
  }

  toApiError(): ApiError {
    return { code: this.code, message: this.message, details: this.details };
  }
}
