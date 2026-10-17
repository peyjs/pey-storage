// Standard Bonyan error mapping for the pey.storage plugin
// Converts raw errors into the standard Bonyan error structure.

import { ERROR_SOURCE, ERROR_CODES } from './constants.js'

/**
 * Build a standard Bonyan error object.
 *
 * @param {string} code     — machine-readable error code
 * @param {string} message  — human-readable description (NO raw record contents)
 * @param {object} [detail] — optional safe metadata
 * @returns {{ code: string, message: string, source: string, type: string, timestamp: string, detail: object | null }}
 */
export function buildError(code, message, detail = null) {
  return {
    code,
    message,
    source: ERROR_SOURCE,
    type: 'operational',
    timestamp: new Date().toISOString(),
    detail,
  }
}

/**
 * Build a startup error (for unrecoverable conditions during plugin startup).
 *
 * @param {string} code     — machine-readable error code
 * @param {string} message  — human-readable description
 * @param {object} [detail] — optional safe metadata
 * @returns {object} standard Bonyan error with type 'startup'
 */
export function buildStartupError(code, message, detail = null) {
  return {
    code,
    message,
    source: ERROR_SOURCE,
    type: 'startup',
    timestamp: new Date().toISOString(),
    detail,
  }
}

/**
 * Build a critical error (for unrecoverable conditions during runtime).
 *
 * @param {string} code     — machine-readable error code
 * @param {string} message  — human-readable description
 * @param {object} [detail] — optional safe metadata
 * @returns {object} standard Bonyan error with type 'critical'
 */
export function buildCriticalError(code, message, detail = null) {
  return {
    code,
    message,
    source: ERROR_SOURCE,
    type: 'critical',
    timestamp: new Date().toISOString(),
    detail,
  }
}

/**
 * Map a raw IndexedDB / system error to a standard Bonyan error.
 *
 * @param {Error} rawError — the raw error from IndexedDB or the host
 * @param {string} context — short description of where the error occurred
 * @returns {{ code: string, message: string, source: string, type: string, timestamp: string, detail: object | null }}
 */
export function mapError(rawError, context = '') {
  const msg = context ? `${context}: ${rawError.message}` : rawError.message

  // Quota exceeded — check DOMException code or message
  if (isQuotaExceeded(rawError)) {
    return buildError(ERROR_CODES.QUOTA_EXCEEDED, 'Storage quota exceeded', { context })
  }

  // Storage unavailable (e.g. private browsing, disabled)
  if (isStorageUnavailable(rawError)) {
    return buildCriticalError(ERROR_CODES.STORAGE_UNAVAILABLE, 'IndexedDB is not available in this environment', { context })
  }

  // Requested database object (store) not found
  if (rawError?.name === 'NotFoundError') {
    return buildError(ERROR_CODES.STORE_NOT_FOUND, 'Requested storage object could not be found', { context })
  }

  // Transaction failed
  if (isTransactionError(rawError)) {
    return buildError(ERROR_CODES.TRANSACTION_FAILED, `Transaction failed: ${msg}`, { context })
  }

  // Default — safe fallback (no raw message exposure beyond a safe substring)
  const safeMsg = msg.length > 200 ? msg.slice(0, 200) + '…' : msg
  return buildError('UNKNOWN_ERROR', `Storage error: ${safeMsg}`, { context })
}

/** Check if an error indicates quota exceeded. */
function isQuotaExceeded(error) {
  if (error?.name === 'QuotaExceededError') return true
  if (error?.code === 22) return true
  if (error?.message && /quota/i.test(error.message)) return true
  return false
}

/** Check if an error indicates storage is unavailable / restricted. */
function isStorageUnavailable(error) {
  if (error?.name === 'InvalidStateError') return true
  if (error?.message && (/private|incognito|disabled/i.test(error.message))) return true
  if (error?.message && /not allowed/i.test(error.message)) return true
  return false
}

/** Check if an error is related to a transaction failure. */
function isTransactionError(error) {
  if (error?.name === 'TransactionInactiveError') return true
  if (error?.message && /transaction/i.test(error.message)) return true
  return false
}
