/*
 * Copyright (C) 2025 Ontic. Pte. Ltd. (realfast.ai)
 * Use of this software is governed by the Business Source License included in the LICENSE.TXT file and at www.mariadb.com/bsl11.
 */

import { test, expect, beforeEach, afterEach, vi } from 'vitest'
import { SalesforceMcpServer } from './server.js'
import { getConfig } from '../config.js'
import { ErrorCode } from '../errors.js'
import { BaseError } from '../errors.js'

// Mock the connection interface to prevent real OAuth2 flow
vi.mock('../connection-interface.js', () => ({
  SalesforceConnection: vi.fn().mockImplementation(() => ({
    connect: vi.fn().mockRejectedValue(new BaseError('Connection failed', ErrorCode.CONNECTION_ERROR))
  }))
}))

describe('SalesforceMcpServer', () => {
  let server: SalesforceMcpServer
  
  beforeEach(() => {
    // Set up minimal required configuration for server tests
    process.env.SFDC_CLIENT_ID = 'test-client-id'
    process.env.SFDC_INSTANCE_URL = 'https://test.salesforce.com'
    
    // Reset configuration manager to pick up test environment
    getConfig().reset()
    
    server = new SalesforceMcpServer()
  })
  
  afterEach(async () => {
    if (server) {
      await server.close()
    }
    
    // Clean up test environment variables
    delete process.env.SFDC_CLIENT_ID
    delete process.env.SFDC_INSTANCE_URL
    
    // Reset configuration manager
    getConfig().reset()
    
    // Restore all mocks
    vi.restoreAllMocks()
  })

  test('should create server instance', () => {
    expect(server).toBeDefined()
    expect(server).toBeInstanceOf(SalesforceMcpServer)
  })

  test('should initialize with default configuration', () => {
    expect(server.name).toBe('salesforce-mcp-server')
    expect(server.version).toBe('0.1.0')
  })

  test('should support MCP capabilities', () => {
    const capabilities = server.getCapabilities()
    expect(capabilities.resources).toEqual({ subscribe: true, listChanged: true })
    expect(capabilities.tools).toEqual({ listChanged: true })
    expect(capabilities.prompts).toBeUndefined()
  })

  test('should start server and handle MCP ping', async () => {
    await server.start()
    expect(server.isRunning()).toBe(true)
    
    const response = await server.handleRequest({
      jsonrpc: '2.0',
      id: 1,
      method: 'ping'
    })
    
    expect(response).toEqual({
      jsonrpc: '2.0',
      id: 1,
      result: {}
    })
  })

  test('should stop server gracefully', async () => {
    await server.start()
    expect(server.isRunning()).toBe(true)
    
    await server.close()
    expect(server.isRunning()).toBe(false)
  })

  test('should return error for unknown method', async () => {
    await server.start()
    
    const response = await server.handleRequest({
      jsonrpc: '2.0',
      id: 2,
      method: 'unknown_method'
    })
    
    expect(response).toEqual({
      jsonrpc: '2.0',
      id: 2,
      error: {
        code: ErrorCode.METHOD_NOT_FOUND,
        message: 'Unknown method: unknown_method',
        data: {
          type: 'BaseError'
        }
      }
    })
  })

  test('should handle request errors gracefully', async () => {
    await server.start()
    
    // Test with malformed request (this won't actually throw in current implementation, 
    // but demonstrates error handling structure)
    const response = await server.handleRequest({
      jsonrpc: '2.0',
      id: 3,
      method: 'test_error'
    })
    
    expect(response.jsonrpc).toBe('2.0')
    expect(response.id).toBe(3)
    expect(response.error).toBeDefined()
    expect(response.error).toMatchObject({
      code: ErrorCode.METHOD_NOT_FOUND,
      message: expect.stringContaining('Unknown method')
    })
  })

  test('should handle tools/list request', async () => {
    await server.start()
    
    const response = await server.handleRequest({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/list'
    })
    
    expect(response).toEqual({
      jsonrpc: '2.0',
      id: 4,
      result: {
        tools: expect.arrayContaining([
          expect.objectContaining({
            name: 'describe_object',
            description: expect.stringContaining('Describes a Salesforce object'),
            inputSchema: expect.objectContaining({
              type: 'object',
              properties: expect.objectContaining({
                objectName: expect.any(Object)
              }),
              required: ['objectName']
            })
          })
        ])
      }
    })
  })

  test('should handle tools/call request with connection error', async () => {
    await server.start()
    
    const response = await server.handleRequest({
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: {
        name: 'describe_object',
        arguments: {
          objectName: 'Account'
        }
      }
    })
    
    expect(response.jsonrpc).toBe('2.0')
    expect(response.id).toBe(5)
    // Tool returns error content, not error response - this is by design
    expect(response.result).toBeDefined()
    expect(response.result).toMatchObject({
      content: expect.arrayContaining([
        expect.objectContaining({
          type: 'text',
          text: expect.stringContaining('Error describing object Account')
        })
      ])
    })
  })

  test('should handle tools/call request with unknown tool', async () => {
    await server.start()
    
    const response = await server.handleRequest({
      jsonrpc: '2.0',
      id: 6,
      method: 'tools/call',
      params: {
        name: 'unknown_tool',
        arguments: {}
      }
    })
    
    expect(response.jsonrpc).toBe('2.0')
    expect(response.id).toBe(6)
    expect(response.error).toBeDefined()
    expect(response.error).toMatchObject({
      code: ErrorCode.INTERNAL_ERROR,
      message: expect.stringContaining("Tool 'unknown_tool' not found")
    })
  })
})