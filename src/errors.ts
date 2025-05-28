/*
 * Copyright (C) 2025 Ontic. Pte. Ltd. (realfast.ai)
 * Use of this software is governed by the Business Source License included in the LICENSE.TXT file and at www.mariadb.com/bsl11.
 */

/**
 * Comprehensive error handling system for Salesforce MCP Server
 * 
 * Provides typed error classes with MCP protocol serialization support.
 * Follows JSON-RPC 2.0 error code conventions with application-specific extensions.
 */

// Error codes following JSON-RPC 2.0 specification + application-specific codes
export enum ErrorCode {
  // JSON-RPC 2.0 standard error codes (negative numbers)
  PARSE_ERROR = -32700,
  INVALID_REQUEST = -32600,
  METHOD_NOT_FOUND = -32601,
  INVALID_PARAMS = -32602,
  INTERNAL_ERROR = -32603,
  
  // Application-specific error codes (positive numbers)
  AUTHENTICATION_FAILED = 1001,
  RATE_LIMIT_EXCEEDED = 1002,
  RESOURCE_NOT_FOUND = 1003,
  INVALID_CONFIG = 1004,
  CONNECTION_FAILED = 1005
}

/**
 * MCP protocol error structure for JSON-RPC responses
 */
export interface McpError {
  readonly code: ErrorCode
  readonly message: string
  readonly data?: {
    readonly type: string
    readonly [key: string]: unknown
  }
}

/**
 * Base error class for all application errors
 * 
 * Provides structured error handling with error codes, optional details,
 * and cause chain support for debugging.
 */
export class BaseError extends Error {
  public readonly code: ErrorCode
  public readonly details?: Record<string, unknown> | undefined
  public readonly cause?: Error | undefined

  constructor(
    message: string,
    code: ErrorCode,
    details?: Record<string, unknown> | undefined,
    cause?: Error | undefined
  ) {
    super(message)
    this.name = this.constructor.name
    this.code = code
    this.details = details
    this.cause = cause

    // Maintain proper stack trace in V8
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor)
    }
  }
}

/**
 * Salesforce-specific errors for API interactions
 * 
 * Handles Salesforce API errors, rate limiting, and service-specific failures.
 */
export class SalesforceError extends BaseError {
  constructor(
    message: string,
    code: ErrorCode,
    details?: Record<string, unknown> | undefined,
    cause?: Error | undefined
  ) {
    super(message, code, details, cause)
  }

  /**
   * Create SalesforceError from Salesforce API error response
   */
  static fromApiError(apiError: {
    message: string
    errorCode?: string | undefined
    fields?: string[] | undefined
    [key: string]: unknown
  }): SalesforceError {
    const code = apiError.errorCode === 'REQUEST_LIMIT_EXCEEDED' 
      ? ErrorCode.RATE_LIMIT_EXCEEDED 
      : ErrorCode.INVALID_PARAMS

    const details: Record<string, unknown> = {
      salesforceErrorCode: apiError.errorCode,
      fields: apiError.fields,
      ...apiError
    }
    // Create new object without message property
    const { message: _, ...detailsWithoutMessage } = details

    return new SalesforceError(apiError.message, code, detailsWithoutMessage)
  }
}

/**
 * Tool-specific errors for MCP tool execution
 * 
 * Handles parameter validation, execution failures, and tool-specific issues.
 */
export class ToolError extends BaseError {
  public readonly toolName: string

  constructor(
    message: string,
    code: ErrorCode,
    toolName: string,
    details?: Record<string, unknown> | undefined,
    cause?: Error | undefined
  ) {
    super(message, code, details, cause)
    this.toolName = toolName
  }
}

/**
 * Configuration-related errors
 * 
 * Handles environment variable validation, missing configuration, and setup issues.
 */
export class ConfigError extends BaseError {
  constructor(
    message: string,
    code: ErrorCode = ErrorCode.INVALID_CONFIG,
    details?: Record<string, unknown> | undefined,
    cause?: Error | undefined
  ) {
    super(message, code, details, cause)
  }
}

/**
 * Authentication and authorization errors
 * 
 * Handles OAuth2, JWT, and session management failures.
 */
export class AuthenticationError extends BaseError {
  constructor(
    message: string,
    code: ErrorCode = ErrorCode.AUTHENTICATION_FAILED,
    details?: Record<string, unknown> | undefined,
    cause?: Error | undefined
  ) {
    super(message, code, details, cause)
  }
}

/**
 * Input validation errors
 * 
 * Handles schema validation, type checking, and parameter validation failures.
 */
export class ValidationError extends BaseError {
  constructor(
    message: string,
    code: ErrorCode = ErrorCode.INVALID_PARAMS,
    details?: Record<string, unknown> | undefined,
    cause?: Error | undefined
  ) {
    super(message, code, details, cause)
  }
}

/**
 * Serialize an error for MCP protocol JSON-RPC response
 * 
 * Converts any Error instance to MCP-compatible error format with
 * structured data for debugging and error handling.
 */
export function createMcpError(error: Error): McpError {
  if (error instanceof BaseError) {
    const data: { type: string; [key: string]: unknown } = {
      type: error.constructor.name
    }

    // Add specific error properties
    if (error instanceof ToolError) {
      data.toolName = error.toolName
    }

    // Add details if present
    if (error.details) {
      data.details = error.details
    }

    // Add cause message if present
    if (error.cause) {
      data.cause = error.cause.message
    }

    return {
      code: error.code,
      message: error.message,
      data
    }
  }

  // Handle non-BaseError instances
  return {
    code: ErrorCode.INTERNAL_ERROR,
    message: error.message,
    data: {
      type: error.constructor.name
    }
  }
}

/**
 * Type guard to check if an error is a BaseError
 */
export function isBaseError(error: unknown): error is BaseError {
  return error instanceof BaseError
}

/**
 * Type guard to check if an error is retriable
 * 
 * Determines if an error indicates a temporary condition that might
 * succeed on retry (rate limits, network issues, etc.)
 */
export function isRetriableError(error: Error): boolean {
  if (error instanceof BaseError) {
    return error.code === ErrorCode.RATE_LIMIT_EXCEEDED ||
           error.code === ErrorCode.CONNECTION_FAILED ||
           error.code === ErrorCode.INTERNAL_ERROR
  }
  return false
}

/**
 * Extract retry delay from rate limit errors
 * 
 * Returns the number of seconds to wait before retrying, if specified
 * in the error details.
 */
export function getRetryDelay(error: BaseError): number | undefined {
  if (error.code === ErrorCode.RATE_LIMIT_EXCEEDED && error.details?.retryAfter) {
    return typeof error.details.retryAfter === 'number' ? error.details.retryAfter : undefined
  }
  return undefined
}

/**
 * Type-safe error handling for catch blocks
 * 
 * Ensures caught errors are properly typed and provides safe access to error properties.
 */
export function handleCaughtError(error: unknown): Error {
  if (error instanceof Error) {
    return error
  }
  if (typeof error === 'string') {
    return new Error(error)
  }
  return new Error('Unknown error occurred')
}

/**
 * Safe error message extraction
 * 
 * Extracts error message from unknown error types safely.
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  if (typeof error === 'string') {
    return error
  }
  return 'Unknown error occurred'
}