/*
 * Copyright (C) 2025 Ontic Pte. Ltd. (realfast.ai)
 * Use of this software is governed by the Business Source License included in the LICENSE.TXT file and at www.mariadb.com/bsl11.
 */

import pino from 'pino'
import { createWriteStream } from 'fs'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface LoggerConfig {
  level?: LogLevel
  structured?: boolean
  stream?: NodeJS.WritableStream
}

export type Logger = pino.Logger

/**
 * Create a structured logger with Pino
 * Supports both structured JSON output and pretty-printed output for development
 */
export function createLogger(config: LoggerConfig = {}): Logger {
  const { level = 'info', structured = true, stream } = config
  
  // Check if we should log to file instead of stdout (for stdio mode)
  let actualStream = stream
  if (!stream && process.env.MCP_LOG_FILE) {
    try {
      actualStream = createWriteStream(process.env.MCP_LOG_FILE, { flags: 'a' })
      // Handle stream errors to prevent crashes
      actualStream.on('error', () => {
        // Silently ignore log file errors and fall back to null stream
      })
    } catch (error) {
      // If we can't create the log file, continue without file logging
      actualStream = undefined
    }
  }

  // Configure Pino options
  const pinoOptions: pino.LoggerOptions = {
    level,
    // Serialize Error objects properly
    serializers: {
      err: pino.stdSerializers.err,
      error: pino.stdSerializers.err
    }
  }

  // Configure transport for pretty printing in development
  if (!structured && !stream) {
    pinoOptions.transport = {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname'
      }
    }
  }

  // Use custom stream if provided (useful for testing or file logging)
  if (actualStream) {
    return pino(pinoOptions, actualStream)
  }

  return pino(pinoOptions)
}

/**
 * Default logger instance
 * Can be overridden by calling setDefaultLogger()
 */
let defaultLogger: Logger | null = null

/**
 * Get the default logger instance
 * Creates one with default configuration if none exists
 */
export function getLogger(): Logger {
  if (!defaultLogger) {
    // If MCP_LOG_FILE is set, create logger that writes only to file
    if (process.env.MCP_LOG_FILE) {
      try {
        const fileStream = createWriteStream(process.env.MCP_LOG_FILE, { flags: 'a' })
        fileStream.on('error', () => {
          // Silently ignore log file errors
        })
        defaultLogger = createLogger({ stream: fileStream })
      } catch (error) {
        // Fall back to default logger if file creation fails
        defaultLogger = createLogger()
      }
    } else {
      defaultLogger = createLogger()
    }
  }
  return defaultLogger
}

/**
 * Set the default logger instance
 * Useful for configuring logging at application startup
 */
export function setDefaultLogger(logger: Logger): void {
  defaultLogger = logger
}

/**
 * Generate a correlation ID for tracking requests across components
 */
export function generateCorrelationId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
}

/**
 * Create a child logger with bound correlation ID
 */
export function createChildLogger(correlationId?: string): Logger {
  const logger = getLogger()
  const id = correlationId || generateCorrelationId()
  
  return logger.child({ correlationId: id })
}