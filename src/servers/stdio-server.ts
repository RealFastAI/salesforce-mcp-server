#!/usr/bin/env node
/*
 * Copyright (C) 2025 Ontic Pte. Ltd. (realfast.ai)
 * Use of this software is governed by the Business Source License included in the LICENSE.TXT file and at www.mariadb.com/bsl11.
 */

import { SalesforceMcpServer } from './server.js'
import type { McpRequest, McpNotification } from '../types.js'

class McpStdioServer {
  private readonly mcpServer: SalesforceMcpServer

  constructor() {
    this.mcpServer = new SalesforceMcpServer()
  }

  start(): void {
    this.mcpServer.start()

    // Set up stdin/stdout communication
    process.stdin.setEncoding('utf8')
    process.stdout.setEncoding('utf8')

    // Buffer for incomplete JSON messages
    let buffer = ''

    process.stdin.on('data', (chunk: string) => {
      console.error('[STDIO] Received chunk:', chunk.length, 'bytes')
      buffer += chunk

      // Process complete JSON-RPC messages (line-delimited)
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? '' // Keep incomplete line in buffer

      console.error('[STDIO] Processing', lines.length, 'lines, remaining buffer:', buffer.length, 'chars')

      for (const line of lines) {
        if (line.trim()) {
          console.error('[STDIO] Processing line:', line.trim())
          void this.handleStdioMessage(line.trim())
        }
      }
    })

    process.stdin.on('error', (error) => {
      console.error('[STDIO] stdin error:', error)
      process.exit(1)
    })
  }

  private async handleStdioMessage(message: string): Promise<void> {
    console.error('[STDIO] Processing message:', message)
    try {
      const parsedMessage = JSON.parse(message) as McpRequest | McpNotification
      const isRequest = 'id' in parsedMessage
      
      console.error('[STDIO] Parsed', isRequest ? 'request' : 'notification', 'method:', parsedMessage.method)
      
      const response = await this.mcpServer.handleMessage(parsedMessage)
      
      if (response !== null) {
        console.error('[STDIO] Generated response for ID:', response.id)
        // Write only the JSON response to stdout
        process.stdout.write(JSON.stringify(response) + '\n')
        console.error('[STDIO] Response written to stdout')
      } else {
        console.error('[STDIO] No response required (notification handled)')
      }
      
    } catch (error) {
      console.error('[STDIO] Error handling message:', error)
      // Send error response only if we can determine it was a request
      try {
        const parsedMessage = JSON.parse(message) as { id?: unknown }
        if ('id' in parsedMessage) {
          const errorResponse = {
            jsonrpc: '2.0',
            id: parsedMessage.id,
            error: {
              code: -32700,
              message: 'Parse error'
            }
          }
          process.stdout.write(JSON.stringify(errorResponse) + '\n')
        }
      } catch {
        // If we can't parse the message, send a generic error
        const errorResponse = {
          jsonrpc: '2.0',
          id: null,
          error: {
            code: -32700,
            message: 'Parse error'
          }
        }
        process.stdout.write(JSON.stringify(errorResponse) + '\n')
      }
    }
  }
}

// Start server
function main() {
  console.error('[STDIO] Starting main function')
  try {
    console.error('[STDIO] Creating McpStdioServer')
    const server = new McpStdioServer()
    console.error('[STDIO] Starting server')
    server.start()
    
    console.error('[STDIO] Server started, resuming stdin')
    // Keep process alive
    process.stdin.resume()
    console.error('[STDIO] Process ready and listening')
    
  } catch (error) {
    console.error('[STDIO] Error in main:', error)
    process.exit(1)
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main()
  } catch {
    process.exit(1)
  }
}

export default McpStdioServer