/*
 * Copyright (C) 2025 Ontic Pte. Ltd. (realfast.ai)
 * Use of this software is governed by the Business Source License included in the LICENSE.TXT file and at www.mariadb.com/bsl11.
 */

import { test, expect, describe } from 'vitest'
import { 
  BaseError, 
  SalesforceError, 
  ToolError, 
  ConfigError,
  AuthenticationError,
  ValidationError,
  createMcpError,
  ErrorCode 
} from './errors.js'

describe('Error Handling System', () => {
  describe('BaseError', () => {
    test('should create error with message and code', () => {
      const error = new BaseError('Test message', ErrorCode.INTERNAL_ERROR)
      
      expect(error.message).toBe('Test message')
      expect(error.code).toBe(ErrorCode.INTERNAL_ERROR)
      expect(error.name).toBe('BaseError')
      expect(error).toBeInstanceOf(Error)
      expect(error).toBeInstanceOf(BaseError)
    })

    test('should include stack trace', () => {
      const error = new BaseError('Test message', ErrorCode.INTERNAL_ERROR)
      
      expect(error.stack).toBeDefined()
      expect(error.stack).toContain('BaseError')
    })

    test('should support optional details', () => {
      const details = { userId: '123', operation: 'test' }
      const error = new BaseError('Test message', ErrorCode.INTERNAL_ERROR, details)
      
      expect(error.details).toEqual(details)
    })

    test('should support optional cause', () => {
      const cause = new Error('Original error')
      const error = new BaseError('Test message', ErrorCode.INTERNAL_ERROR, undefined, cause)
      
      expect(error.cause).toBe(cause)
    })
  })

  describe('SalesforceError', () => {
    test('should create Salesforce-specific error', () => {
      const error = new SalesforceError('API rate limit exceeded', ErrorCode.RATE_LIMIT_EXCEEDED)
      
      expect(error.message).toBe('API rate limit exceeded')
      expect(error.code).toBe(ErrorCode.RATE_LIMIT_EXCEEDED)
      expect(error.name).toBe('SalesforceError')
      expect(error).toBeInstanceOf(Error)
      expect(error).toBeInstanceOf(BaseError)
      expect(error).toBeInstanceOf(SalesforceError)
    })

    test('should support Salesforce-specific details', () => {
      const details = {
        salesforceErrorCode: 'INVALID_FIELD',
        fields: ['invalidField'],
        sobjectType: 'Account'
      }
      const error = new SalesforceError('Invalid field', ErrorCode.INVALID_PARAMS, details)
      
      expect(error.details).toEqual(details)
    })

    test('should handle API response errors', () => {
      const apiError = {
        message: 'INVALID_FIELD: No such column \'badField\' on entity \'Account\'',
        errorCode: 'INVALID_FIELD',
        fields: ['badField']
      }
      const error = SalesforceError.fromApiError(apiError)
      
      expect(error.message).toContain('INVALID_FIELD')
      expect(error.code).toBe(ErrorCode.INVALID_PARAMS)
      expect(error.details).toMatchObject({
        salesforceErrorCode: 'INVALID_FIELD',
        fields: ['badField']
      })
    })
  })

  describe('ToolError', () => {
    test('should create tool-specific error', () => {
      const error = new ToolError('Invalid tool parameters', ErrorCode.INVALID_PARAMS, 'soql_query')
      
      expect(error.message).toBe('Invalid tool parameters')
      expect(error.code).toBe(ErrorCode.INVALID_PARAMS)
      expect(error.toolName).toBe('soql_query')
      expect(error.name).toBe('ToolError')
      expect(error).toBeInstanceOf(BaseError)
    })

    test('should support tool-specific details', () => {
      const details = { 
        parameter: 'query',
        expectedType: 'string',
        receivedType: 'number'
      }
      const error = new ToolError('Invalid parameter type', ErrorCode.INVALID_PARAMS, 'soql_query', details)
      
      expect(error.details).toEqual(details)
      expect(error.toolName).toBe('soql_query')
    })
  })

  describe('ConfigError', () => {
    test('should create configuration-specific error', () => {
      const error = new ConfigError('Missing required configuration', ErrorCode.INVALID_CONFIG)
      
      expect(error.message).toBe('Missing required configuration')
      expect(error.code).toBe(ErrorCode.INVALID_CONFIG)
      expect(error.name).toBe('ConfigError')
      expect(error).toBeInstanceOf(BaseError)
    })

    test('should support configuration details', () => {
      const details = { 
        field: 'SFDC_CLIENT_ID',
        source: 'environment'
      }
      const error = new ConfigError('Missing client ID', ErrorCode.INVALID_CONFIG, details)
      
      expect(error.details).toEqual(details)
    })
  })

  describe('AuthenticationError', () => {
    test('should create authentication-specific error', () => {
      const error = new AuthenticationError('Invalid credentials', ErrorCode.AUTHENTICATION_FAILED)
      
      expect(error.message).toBe('Invalid credentials')
      expect(error.code).toBe(ErrorCode.AUTHENTICATION_FAILED)
      expect(error.name).toBe('AuthenticationError')
      expect(error).toBeInstanceOf(BaseError)
    })

    test('should support authentication details', () => {
      const details = { 
        authMethod: 'oauth2',
        instanceUrl: 'https://test.salesforce.com'
      }
      const error = new AuthenticationError('OAuth2 failed', ErrorCode.AUTHENTICATION_FAILED, details)
      
      expect(error.details).toEqual(details)
    })
  })

  describe('ValidationError', () => {
    test('should create validation-specific error', () => {
      const error = new ValidationError('Schema validation failed', ErrorCode.INVALID_PARAMS)
      
      expect(error.message).toBe('Schema validation failed')
      expect(error.code).toBe(ErrorCode.INVALID_PARAMS)
      expect(error.name).toBe('ValidationError')
      expect(error).toBeInstanceOf(BaseError)
    })

    test('should support validation details', () => {
      const details = { 
        field: 'email',
        constraint: 'format',
        received: 'not-an-email'
      }
      const error = new ValidationError('Invalid email format', ErrorCode.INVALID_PARAMS, details)
      
      expect(error.details).toEqual(details)
    })
  })

  describe('MCP Error Serialization', () => {
    test('should serialize error for MCP protocol', () => {
      const error = new SalesforceError('API error', ErrorCode.RATE_LIMIT_EXCEEDED, {
        retryAfter: 60
      })

      const mcpError = createMcpError(error)

      expect(mcpError).toEqual({
        code: ErrorCode.RATE_LIMIT_EXCEEDED,
        message: 'API error',
        data: {
          type: 'SalesforceError',
          details: {
            retryAfter: 60
          }
        }
      })
    })

    test('should serialize error with cause', () => {
      const cause = new Error('Network timeout')
      const error = new ToolError('Query failed', ErrorCode.INTERNAL_ERROR, 'soql_query', undefined, cause)

      const mcpError = createMcpError(error)

      expect(mcpError).toEqual({
        code: ErrorCode.INTERNAL_ERROR,
        message: 'Query failed',
        data: {
          type: 'ToolError',
          toolName: 'soql_query',
          cause: 'Network timeout'
        }
      })
    })

    test('should serialize basic error without details', () => {
      const error = new BaseError('Simple error', ErrorCode.METHOD_NOT_FOUND)

      const mcpError = createMcpError(error)

      expect(mcpError).toEqual({
        code: ErrorCode.METHOD_NOT_FOUND,
        message: 'Simple error',
        data: {
          type: 'BaseError'
        }
      })
    })

    test('should handle non-BaseError instances', () => {
      const error = new Error('Regular error')

      const mcpError = createMcpError(error)

      expect(mcpError).toEqual({
        code: ErrorCode.INTERNAL_ERROR,
        message: 'Regular error',
        data: {
          type: 'Error'
        }
      })
    })
  })

  describe('Error Code Mapping', () => {
    test('should have all required error codes', () => {
      expect(ErrorCode.INVALID_REQUEST).toBe(-32600)
      expect(ErrorCode.METHOD_NOT_FOUND).toBe(-32601)
      expect(ErrorCode.INVALID_PARAMS).toBe(-32602)
      expect(ErrorCode.INTERNAL_ERROR).toBe(-32603)
      expect(ErrorCode.PARSE_ERROR).toBe(-32700)
      
      // Application-specific codes (positive numbers)
      expect(ErrorCode.AUTHENTICATION_FAILED).toBe(1001)
      expect(ErrorCode.RATE_LIMIT_EXCEEDED).toBe(1002)
      expect(ErrorCode.RESOURCE_NOT_FOUND).toBe(1003)
      expect(ErrorCode.INVALID_CONFIG).toBe(1004)
      expect(ErrorCode.CONNECTION_FAILED).toBe(1005)
    })
  })

  describe('Error Inheritance Chain', () => {
    test('should maintain proper inheritance chain', () => {
      const salesforceError = new SalesforceError('Test', ErrorCode.INTERNAL_ERROR)
      const toolError = new ToolError('Test', ErrorCode.INVALID_PARAMS, 'test_tool')
      const configError = new ConfigError('Test', ErrorCode.INVALID_CONFIG)

      // Check instanceof works for inheritance chain
      expect(salesforceError instanceof Error).toBe(true)
      expect(salesforceError instanceof BaseError).toBe(true)
      expect(salesforceError instanceof SalesforceError).toBe(true)

      expect(toolError instanceof Error).toBe(true)
      expect(toolError instanceof BaseError).toBe(true)
      expect(toolError instanceof ToolError).toBe(true)

      expect(configError instanceof Error).toBe(true)
      expect(configError instanceof BaseError).toBe(true)
      expect(configError instanceof ConfigError).toBe(true)

      // Check cross-type instanceof returns false
      expect(salesforceError instanceof ToolError).toBe(false)
      expect(toolError instanceof SalesforceError).toBe(false)
    })
  })
})