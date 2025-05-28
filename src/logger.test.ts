/*
 * Copyright (C) 2025 Ontic Pte. Ltd. (realfast.ai)
 * Use of this software is governed by the Business Source License included in the LICENSE.TXT file and at www.mariadb.com/bsl11.
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest'
import { Writable } from 'stream'
import { createLogger, LogLevel, generateCorrelationId, createChildLogger } from './logger.js'

// Create a writable stream that captures output
class CapturingStream extends Writable {
  public chunks: string[] = []

  _write(chunk: any, encoding: string, callback: () => void) {
    this.chunks.push(chunk.toString())
    callback()
  }

  getOutput(): string[] {
    return this.chunks
  }

  clear() {
    this.chunks = []
  }
}

describe('Logger', () => {
  let captureStream: CapturingStream

  beforeEach(() => {
    captureStream = new CapturingStream()
  })

  afterEach(() => {
    captureStream.clear()
  })

  describe('Logger Creation', () => {
    test('should create logger with default configuration', () => {
      const logger = createLogger()
      
      expect(logger).toBeDefined()
      expect(typeof logger.info).toBe('function')
      expect(typeof logger.error).toBe('function')
      expect(typeof logger.debug).toBe('function')
      expect(typeof logger.warn).toBe('function')
    })

    test('should create logger with custom level', () => {
      const logger = createLogger({ level: 'debug' })
      
      expect(logger).toBeDefined()
    })

    test('should create logger with structured format', () => {
      const logger = createLogger({ 
        level: 'info',
        structured: true 
      })
      
      expect(logger).toBeDefined()
    })

    test('should create logger with pretty format', () => {
      const logger = createLogger({ 
        level: 'info',
        structured: false 
      })
      
      expect(logger).toBeDefined()
    })
  })

  describe('Log Levels', () => {
    test('should log at info level', () => {
      const logger = createLogger({ 
        level: 'info',
        stream: captureStream 
      })
      
      logger.info('Test info message')
      
      const output = captureStream.getOutput()
      expect(output).toHaveLength(1)
      expect(output[0]).toContain('Test info message')
    })

    test('should log at error level', () => {
      const logger = createLogger({ 
        level: 'error',
        stream: captureStream 
      })
      
      logger.error('Test error message')
      
      const output = captureStream.getOutput()
      expect(output).toHaveLength(1)
      expect(output[0]).toContain('Test error message')
    })

    test('should respect log level hierarchy', () => {
      const logger = createLogger({ 
        level: 'warn',
        stream: captureStream 
      })
      
      // Should log warn and error
      logger.warn('Warning message')
      logger.error('Error message')
      
      // Should not log info or debug
      logger.info('Info message')
      logger.debug('Debug message')
      
      const output = captureStream.getOutput()
      expect(output).toHaveLength(2) // Only warn and error should be logged
      expect(output[0]).toContain('Warning message')
      expect(output[1]).toContain('Error message')
    })
  })

  describe('Correlation IDs', () => {
    test('should include correlation ID in log messages', () => {
      const logger = createLogger({ 
        level: 'info',
        stream: captureStream 
      })
      const correlationId = 'test-correlation-123'
      
      logger.info({ correlationId }, 'Test message with correlation ID')
      
      const output = captureStream.getOutput()
      expect(output).toHaveLength(1)
      expect(output[0]).toContain(correlationId)
    })

    test('should support child loggers with bound correlation ID', () => {
      const parentLogger = createLogger({ 
        level: 'info',
        stream: captureStream 
      })
      const correlationId = 'bound-correlation-456'
      
      const childLogger = parentLogger.child({ correlationId })
      childLogger.info('Message from child logger')
      
      const output = captureStream.getOutput()
      expect(output).toHaveLength(1)
      expect(output[0]).toContain(correlationId)
    })
  })

  describe('Structured Logging', () => {
    test('should log structured data as JSON', () => {
      const logger = createLogger({ 
        level: 'info',
        structured: true,
        stream: captureStream 
      })
      
      const testData = {
        operation: 'test-operation',
        userId: 'user-123',
        duration: 150
      }
      
      logger.info(testData, 'Operation completed')
      
      const output = captureStream.getOutput()
      expect(output).toHaveLength(1)
      
      // Should be valid JSON
      const logOutput = output[0]
      expect(() => JSON.parse(logOutput)).not.toThrow()
      
      const parsed = JSON.parse(logOutput)
      expect(parsed.operation).toBe('test-operation')
      expect(parsed.userId).toBe('user-123')
      expect(parsed.duration).toBe(150)
      expect(parsed.msg).toBe('Operation completed')
    })

    test('should include timestamp in structured logs', () => {
      const logger = createLogger({ 
        level: 'info',
        structured: true,
        stream: captureStream 
      })
      
      logger.info('Test message with timestamp')
      
      const output = captureStream.getOutput()
      expect(output).toHaveLength(1)
      const parsed = JSON.parse(output[0])
      
      expect(parsed.time).toBeDefined()
      expect(typeof parsed.time).toBe('number')
    })

    test('should include log level in structured logs', () => {
      const logger = createLogger({ 
        level: 'debug',
        structured: true,
        stream: captureStream 
      })
      
      logger.debug('Debug message')
      logger.info('Info message') 
      logger.warn('Warning message')
      logger.error('Error message')
      
      const output = captureStream.getOutput()
      expect(output).toHaveLength(4)
      
      const debugLog = JSON.parse(output[0])
      const infoLog = JSON.parse(output[1])
      const warnLog = JSON.parse(output[2])
      const errorLog = JSON.parse(output[3])
      
      expect(debugLog.level).toBe(20) // Pino debug level
      expect(infoLog.level).toBe(30)  // Pino info level
      expect(warnLog.level).toBe(40)  // Pino warn level
      expect(errorLog.level).toBe(50) // Pino error level
    })
  })

  describe('Error Logging', () => {
    test('should properly serialize Error objects', () => {
      const logger = createLogger({ 
        level: 'error',
        structured: true,
        stream: captureStream 
      })
      
      const error = new Error('Test error message')
      error.stack = 'Error: Test error message\\n    at test (file.js:1:1)'
      
      logger.error({ err: error }, 'Error occurred')
      
      const output = captureStream.getOutput()
      expect(output).toHaveLength(1)
      const parsed = JSON.parse(output[0])
      
      expect(parsed.err).toBeDefined()
      expect(parsed.err.message).toBe('Test error message')
      expect(parsed.err.stack).toContain('Error: Test error message')
    })

    test('should handle errors with additional context', () => {
      const logger = createLogger({ 
        level: 'error',
        structured: true,
        stream: captureStream 
      })
      
      const error = new Error('Database connection failed')
      
      logger.error({
        err: error,
        operation: 'database-connect',
        retryAttempt: 3,
        correlationId: 'req-789'
      }, 'Failed to connect to database')
      
      const output = captureStream.getOutput()
      expect(output).toHaveLength(1)
      const parsed = JSON.parse(output[0])
      
      expect(parsed.err.message).toBe('Database connection failed')
      expect(parsed.operation).toBe('database-connect')
      expect(parsed.retryAttempt).toBe(3)
      expect(parsed.correlationId).toBe('req-789')
    })
  })

  describe('Utility Functions', () => {
    test('generateCorrelationId should create unique IDs', () => {
      const id1 = generateCorrelationId()
      const id2 = generateCorrelationId()
      
      expect(id1).toBeDefined()
      expect(id2).toBeDefined()
      expect(id1).not.toBe(id2)
      expect(typeof id1).toBe('string')
      expect(typeof id2).toBe('string')
    })

    test('createChildLogger should create logger with correlation ID', () => {
      const childLogger = createChildLogger('test-correlation')
      
      expect(childLogger).toBeDefined()
      expect(typeof childLogger.info).toBe('function')
    })

    test('createChildLogger should generate correlation ID if not provided', () => {
      const childLogger = createChildLogger()
      
      expect(childLogger).toBeDefined()
      expect(typeof childLogger.info).toBe('function')
    })
  })

  describe('LogLevel validation', () => {
    test('should accept valid log levels', () => {
      const validLevels: LogLevel[] = ['debug', 'info', 'warn', 'error']
      
      for (const level of validLevels) {
        expect(() => createLogger({ level })).not.toThrow()
      }
    })
  })
})