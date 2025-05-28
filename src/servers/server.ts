/*
 * Copyright (C) 2025 Ontic Pte. Ltd. (realfast.ai)
 * Use of this software is governed by the Business Source License included in the LICENSE.TXT file and at www.mariadb.com/bsl11.
 */

import type { ServerCapabilities, McpRequest, McpNotification, McpResponse } from '../types.js'
import { getConfig } from '../config.js'
import { createMcpError, ErrorCode, BaseError } from '../errors.js'
import { createChildLogger, generateCorrelationId } from '../logger.js'
import { SalesforceClient } from '../salesforce-client.js'
import { ToolRegistry } from '../tools.js'

export class SalesforceMcpServer {
  private readonly config = getConfig()
  private readonly logger = createChildLogger('mcp-server')
  private readonly salesforceClient: SalesforceClient
  private readonly toolRegistry: ToolRegistry
  private running = false

  constructor() {
    this.salesforceClient = new SalesforceClient(this.config.getSalesforceConfig())
    this.toolRegistry = new ToolRegistry()
  }

  get name(): string {
    return this.config.getServerInfo().name
  }

  get version(): string {
    return this.config.getServerInfo().version
  }

  getCapabilities(): ServerCapabilities {
    return this.config.getCapabilities()
  }

  start(): void {
    this.logger.info({
      serverName: this.name,
      version: this.version,
      capabilities: this.getCapabilities()
    }, 'Starting Salesforce MCP Server')
    
    this.running = true
    
    this.logger.info('Salesforce MCP Server started successfully')
  }

  isRunning(): boolean {
    return this.running
  }

  async handleMessage(message: McpRequest | McpNotification): Promise<McpResponse | null> {
    const correlationId = generateCorrelationId()
    const isRequest = 'id' in message
    const messageLogger = isRequest 
      ? this.logger.child({ correlationId, requestId: (message).id })
      : this.logger.child({ correlationId })
    
    messageLogger.debug({
      method: message.method,
      params: message.params,
      isRequest
    }, `Handling MCP ${isRequest ? 'request' : 'notification'}`)
    
    try {
      // Handle notifications (no response required)
      if (!isRequest) {
        if (message.method === 'initialized') {
          messageLogger.debug('Processing initialized notification')
          return null // No response for notifications
        }
        
        messageLogger.warn({ method: message.method }, 'Unknown notification method')
        return null
      }
      
      // Handle requests (response required)
      const request = message
      
      if (request.method === 'initialize') {
        messageLogger.debug('Processing initialize request')
        return {
          jsonrpc: '2.0',
          id: request.id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: this.getCapabilities(),
            serverInfo: {
              name: this.name,
              version: this.version
            }
          }
        }
      }
      
      if (request.method === 'ping') {
        messageLogger.debug('Processing ping request')
        return {
          jsonrpc: '2.0',
          id: request.id,
          result: {}
        }
      }
      
      if (request.method === 'tools/list') {
        messageLogger.debug('Processing tools/list request')
        const tools = this.toolRegistry.listTools()
        return {
          jsonrpc: '2.0',
          id: request.id,
          result: { tools }
        }
      }
      
      if (request.method === 'tools/call') {
        messageLogger.debug({ params: request.params }, 'Processing tools/call request')
        const { name, arguments: toolArgs } = request.params as { name: string; arguments: Record<string, unknown> }
        
        try {
          const result = await this.toolRegistry.executeTool(name, toolArgs, {
            salesforceClient: this.salesforceClient
          })
          
          return {
            jsonrpc: '2.0',
            id: request.id,
            result
          }
        } catch (toolError: unknown) {
          messageLogger.error({ 
            error: toolError, 
            toolName: name 
          }, 'Tool execution failed')
          
          const error = toolError instanceof Error 
            ? new BaseError(`Tool execution failed: ${toolError.message}`, ErrorCode.INTERNAL_ERROR)
            : new BaseError('Tool execution failed', ErrorCode.INTERNAL_ERROR)
          
          return {
            jsonrpc: '2.0',
            id: request.id,
            error: createMcpError(error)
          }
        }
      }
      
      // Method not found error
      messageLogger.warn({
        method: request.method
      }, 'Unknown method requested')
      
      const error = new BaseError(
        `Unknown method: ${request.method}`,
        ErrorCode.METHOD_NOT_FOUND
      )
      
      return {
        jsonrpc: '2.0',
        id: request.id,
        error: createMcpError(error)
      }
    } catch (error) {
      // Handle unexpected errors
      messageLogger.error({
        err: error,
        method: message.method
      }, `Unexpected error handling MCP ${isRequest ? 'request' : 'notification'}`)
      
      // Only return error response for requests, not notifications
      if (!isRequest) {
        return null
      }
      
      const mcpError = error instanceof Error 
        ? createMcpError(error)
        : createMcpError(new BaseError('Unknown error occurred', ErrorCode.INTERNAL_ERROR))
      
      return {
        jsonrpc: '2.0',
        id: (message).id,
        error: mcpError
      }
    }
  }

  // Backward compatibility method
  async handleRequest(request: McpRequest): Promise<McpResponse> {
    const result = await this.handleMessage(request)
    if (result === null) {
      throw new BaseError('Request handler returned null - this should not happen for requests', ErrorCode.INTERNAL_ERROR)
    }
    return result
  }

  close(): void {
    this.logger.info('Shutting down Salesforce MCP Server')
    this.running = false
    this.logger.info('Salesforce MCP Server stopped')
  }
}