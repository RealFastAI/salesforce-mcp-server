#!/usr/bin/env node
/*
 * Copyright (C) 2025 Ontic Pte. Ltd. (realfast.ai)
 * Use of this software is governed by the Business Source License included in the LICENSE.TXT file and at www.mariadb.com/bsl11.
 */

import { SalesforceMcpServer } from './servers/index.js'
import { createChildLogger } from './logger.js'

const logger = createChildLogger('main')

async function main() {
  const server = new SalesforceMcpServer()
  
  try {
    await server.start()
    
    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      logger.info('Received SIGINT, shutting down gracefully...')
      await server.close()
      process.exit(0)
    })
    
    process.on('SIGTERM', async () => {
      logger.info('Received SIGTERM, shutting down gracefully...')
      await server.close()
      process.exit(0)
    })
    
    // Keep the process alive
    process.stdin.resume()
    
  } catch (error) {
    logger.error({ error }, 'Failed to start server')
    process.exit(1)
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    logger.error({ error }, 'Unhandled error in main')
    process.exit(1)
  })
}

export { SalesforceMcpServer } from './servers/index.js'