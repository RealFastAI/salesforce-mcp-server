/*
 * Copyright (C) 2025 Ontic Pte. Ltd. (realfast.ai)
 * Use of this software is governed by the Business Source License included in the LICENSE.TXT file and at www.mariadb.com/bsl11.
 */

// Basic test setup
import { setDefaultLogger, createLogger } from '../logger.js'

// Configure logging for test environment
// Check for explicit LOG_LEVEL override, otherwise default to error for tests
const logLevel = process.env.LOG_LEVEL as 'debug' | 'info' | 'warn' | 'error' | undefined || 
  (process.env.CI === 'true' || process.argv.includes('--run') || process.env.NODE_ENV === 'test') 
    ? 'error' : 'error'

// Create logger with appropriate level for tests
const testLogger = createLogger({ level: logLevel })
setDefaultLogger(testLogger)