#!/usr/bin/env node
/*
 * Copyright (C) 2025 Ontic Pte. Ltd. (realfast.ai)
 * Use of this software is governed by the Business Source License included in the LICENSE.TXT file and at www.mariadb.com/bsl11.
 */
import type { IncomingMessage, ServerResponse } from 'http';
import { createServer } from 'http'
import { SalesforceMcpServer } from './server.js'
import { createChildLogger } from '../logger.js'
import type { McpRequest, McpResponse } from '../types.js'

const logger = createChildLogger('http-server')

class McpHttpServer {
  private readonly mcpServer: SalesforceMcpServer
  private readonly port: number
  private httpServer?: ReturnType<typeof createServer>

  constructor(port = 3000) {
    this.mcpServer = new SalesforceMcpServer()
    this.port = port
  }

  async start(): Promise<void> {
    this.mcpServer.start()
    
    this.httpServer = createServer((req, res) => {
      void this.handleHttpRequest(req, res)
    })

    return new Promise((resolve, reject) => {
      this.httpServer!.listen(this.port, (err?: Error) => {
        if (err) {
          reject(err)
        } else {
          logger.info({ port: this.port }, '🌐 MCP HTTP Server started')
          resolve()
        }
      })
    })
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.httpServer) {
        this.httpServer.close(() => {
          logger.info('🛑 MCP HTTP Server stopped')
          resolve()
        })
      } else {
        resolve()
      }
    })
  }

  private async handleHttpRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // Set CORS headers for browser testing
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

    if (req.method === 'OPTIONS') {
      res.writeHead(200)
      res.end()
      return
    }

    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Method not allowed' }))
      return
    }

    try {
      const body = await this.readRequestBody(req)
      const mcpRequest = JSON.parse(body) as McpRequest
      
      logger.debug({ method: mcpRequest.method }, 'Processing MCP request')
      
      const mcpResponse: McpResponse = await this.mcpServer.handleRequest(mcpRequest)
      
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(mcpResponse))
      
    } catch (error) {
      logger.error({ error }, 'HTTP request processing failed')
      
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32603,
          message: 'Internal error',
          data: { message: error instanceof Error ? error.message : 'Unknown error' }
        }
      }))
    }
  }

  private readRequestBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      let body = ''
      
      req.on('data', (chunk) => {
        body += (chunk as Buffer).toString()
      })
      
      req.on('end', () => {
        resolve(body)
      })
      
      req.on('error', (error) => {
        reject(error)
      })
    })
  }
}

// Start server if called directly
async function main() {
  const port = parseInt(process.env.PORT ?? '3000')
  const server = new McpHttpServer(port)
  
  try {
    await server.start()
    logger.info(`🚀 Salesforce MCP Server running on http://localhost:${port}`)
    logger.info('📋 Available endpoints:')
    logger.info('  POST / - MCP JSON-RPC requests')
    logger.info('📖 Try: curl -X POST http://localhost:3000 -d \'{"jsonrpc":"2.0","id":1,"method":"tools/list"}\'')
    
    // Graceful shutdown
    process.on('SIGINT', () => {
      logger.info('🛑 Shutting down...')
      void server.stop().then(() => process.exit(0))
    })
    
    process.on('SIGTERM', () => {
      logger.info('🛑 Shutting down...')
      void server.stop().then(() => process.exit(0))
    })
    
  } catch (error) {
    logger.error({ error }, '❌ Failed to start server')
    process.exit(1)
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main().catch((error: unknown) => {
    logger.error({ error }, 'Unhandled error')
    process.exit(1)
  })
}

export default McpHttpServer