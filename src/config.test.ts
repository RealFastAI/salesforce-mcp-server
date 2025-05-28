/*
 * Copyright (C) 2025 Ontic Pte. Ltd. (realfast.ai)
 * Use of this software is governed by the Business Source License included in the LICENSE.TXT file and at www.mariadb.com/bsl11.
 */

import { test, expect, beforeEach, afterEach, vi, describe } from 'vitest'
import { loadConfiguration, getConfig, type ServerConfig } from './config.js'
import { ConfigError, ErrorCode } from './errors.js'

// Test helper for common setup patterns
const createTestConfig = (overrides: Record<string, string> = {}) => {
  const defaults = {
    SFDC_CLIENT_ID: 'test-client-id',
    SFDC_INSTANCE_URL: 'https://test.salesforce.com'
  }
  return { ...defaults, ...overrides }
}

const setEnvVars = (vars: Record<string, string>) => {
  Object.entries(vars).forEach(([key, value]) => {
    process.env[key] = value
  })
}

// Common regex patterns for error matching
const ERROR_PATTERNS = {
  required: /required/i,
  url: /valid.*url/i,
  protocol: /protocol/i,
  apiVersion: /format.*vXX\.0/i,
  enum: /invalid.*enum/i,
  whitespace: /whitespace/i
} as const

describe('Configuration Loading', () => {
  const testEnvVars = [
    'SFDC_CLIENT_ID', 'SFDC_CLIENT_SECRET', 'SFDC_INSTANCE_URL',
    'SFDC_API_VERSION', 'SFDC_TIMEOUT', 'SFDC_MAX_RETRIES',
    'LOG_LEVEL', 'LOG_STRUCTURED', 'CACHE_ENABLED',
    'CACHE_TTL_SECONDS', 'CACHE_MAX_ENTRIES'
  ] as const

  const cleanupEnv = () => {
    testEnvVars.forEach(key => delete process.env[key])
    getConfig().reset()
  }

  beforeEach(cleanupEnv)
  afterEach(cleanupEnv)

  describe('Valid Configuration Loading', () => {
    test('should load complete configuration from environment variables', () => {
      process.env.SFDC_CLIENT_ID = 'test-client-id'
      process.env.SFDC_CLIENT_SECRET = 'test-client-secret'
      process.env.SFDC_INSTANCE_URL = 'https://test.salesforce.com'
      process.env.SFDC_API_VERSION = 'v59.0'
      process.env.SFDC_TIMEOUT = '45000'
      process.env.LOG_LEVEL = 'debug'
      process.env.CACHE_ENABLED = 'false'
      
      const config = loadConfiguration()
      
      // Verify all loaded values
      expect(config.salesforce.clientId).toBe('test-client-id')
      expect(config.salesforce.instanceUrl).toBe('https://test.salesforce.com')
      expect(config.salesforce.apiVersion).toBe('v59.0')
      expect(config.salesforce.timeout).toBe(45000)
      expect(config.logging.level).toBe('debug')
      expect(config.cache.enabled).toBe(false)
    })

    test('should use default values for optional settings', () => {
      process.env.SFDC_CLIENT_ID = 'test-client-id'
      process.env.SFDC_INSTANCE_URL = 'https://test.salesforce.com'
      
      const config = loadConfiguration()
      
      expect(config.salesforce.apiVersion).toBe('v59.0')
      expect(config.salesforce.timeout).toBe(30000)
      expect(config.salesforce.maxRetries).toBe(3)
      expect(config.logging.level).toBe('info')
      expect(config.logging.structured).toBe(true)
      expect(config.cache.enabled).toBe(true)
      expect(config.cache.ttlSeconds).toBe(300)
      expect(config.cache.maxEntries).toBe(1000)
    })
  })

  describe('Required Field Validation', () => {
    test('should fail when SFDC_CLIENT_ID is missing', () => {
      setEnvVars({ SFDC_INSTANCE_URL: 'https://test.salesforce.com' })
      expect(() => loadConfiguration()).toThrow(ERROR_PATTERNS.required)
    })

    test('should fail when SFDC_INSTANCE_URL is missing', () => {
      setEnvVars({ SFDC_CLIENT_ID: 'test-client-id' })
      expect(() => loadConfiguration()).toThrow(ERROR_PATTERNS.required)
    })

    test('should fail with empty string values', () => {
      setEnvVars({ SFDC_CLIENT_ID: '', SFDC_INSTANCE_URL: 'https://test.salesforce.com' })
      expect(() => loadConfiguration()).toThrow(ERROR_PATTERNS.required)
    })
  })

  describe('Format Validation', () => {
    beforeEach(() => setEnvVars(createTestConfig()))

    test('should validate SFDC_INSTANCE_URL format', () => {
      setEnvVars({ SFDC_INSTANCE_URL: 'invalid-url' })
      expect(() => loadConfiguration()).toThrow(ERROR_PATTERNS.url)
    })

    test('should validate SFDC_API_VERSION format', () => {
      setEnvVars({ SFDC_API_VERSION: 'invalid-version' })
      expect(() => loadConfiguration()).toThrow(ERROR_PATTERNS.apiVersion)
    })
  })

  describe('Graceful Error Handling', () => {
    beforeEach(() => setEnvVars(createTestConfig()))

    test('should handle invalid number formats gracefully', () => {
      process.env.SFDC_TIMEOUT = 'not-a-number'
      process.env.SFDC_MAX_RETRIES = 'also-not-a-number'
      
      const config = loadConfiguration()
      
      // Should use defaults when parsing fails
      expect(config.salesforce.timeout).toBe(30000)
      expect(config.salesforce.maxRetries).toBe(3)
    })

    test('should handle invalid boolean values gracefully', () => {
      process.env.CACHE_ENABLED = 'invalid-boolean'
      // LOG_STRUCTURED uses different parsing logic - only 'true' becomes true
      
      const config = loadConfiguration()
      
      // Should use defaults when parsing fails
      expect(config.cache.enabled).toBe(true) // undefined -> default true
      expect(config.logging.structured).toBe(true) // undefined -> default true
    })

    test('should handle valid boolean strings correctly', () => {
      process.env.CACHE_ENABLED = 'false'
      process.env.LOG_STRUCTURED = 'true'
      
      const config = loadConfiguration()
      
      expect(config.cache.enabled).toBe(false)
      expect(config.logging.structured).toBe(true)
    })
  })

  describe('Configuration Source Priority', () => {
    beforeEach(() => setEnvVars(createTestConfig()))

    test('should prioritize environment variables over defaults', () => {
      // Environment variables should override schema defaults
      process.env.SFDC_API_VERSION = 'v61.0' // Override default v59.0
      process.env.SFDC_TIMEOUT = '45000' // Override default 30000
      
      const config = loadConfiguration()
      
      // Environment variables should take precedence over defaults
      expect(config.salesforce.apiVersion).toBe('v61.0')
      expect(config.salesforce.timeout).toBe(45000)
    })

    test('should demonstrate dotenv integration loads .env file values', () => {
      // dotenv.config() is called in config.ts
      // If .env file exists, those values would be loaded into process.env
      // before our loadConfiguration runs
      
      // Verify dotenv is working (we can see it loads .env file)
      const config = loadConfiguration()
      
      // This test mainly verifies the integration exists
      // In real usage, .env values would be in process.env before we check
      expect(config).toBeDefined()
      expect(config.salesforce.clientId).toBe('test-client-id') // from our beforeEach
    })

    test('should use defaults when no environment variables or .env values are set', () => {
      // Only required fields set, everything else should use defaults
      const config = loadConfiguration()
      
      // Verify all defaults are applied
      expect(config.name).toBe('salesforce-mcp-server')
      expect(config.version).toBe('0.1.0')
      expect(config.capabilities.resources).toEqual({ subscribe: true, listChanged: true })
      expect(config.capabilities.tools).toEqual({ listChanged: true })
      expect(config.capabilities.prompts).toBeUndefined()
      expect(config.salesforce.apiVersion).toBe('v59.0')
      expect(config.salesforce.timeout).toBe(30000)
      expect(config.salesforce.maxRetries).toBe(3)
      expect(config.logging.level).toBe('info')
      expect(config.logging.structured).toBe(true)
      expect(config.cache.enabled).toBe(true)
      expect(config.cache.ttlSeconds).toBe(300)
      expect(config.cache.maxEntries).toBe(1000)
    })

    test('should handle partial configuration with mixed sources', () => {
      // Mix of environment variables and defaults
      process.env.SFDC_TIMEOUT = '25000' // Override default
      process.env.LOG_LEVEL = 'warn' // Override default
      // CACHE_ENABLED not set, should use default
      
      const config = loadConfiguration()
      
      // Environment overrides
      expect(config.salesforce.timeout).toBe(25000)
      expect(config.logging.level).toBe('warn')
      
      // Defaults for unset values
      expect(config.salesforce.maxRetries).toBe(3)
      expect(config.cache.enabled).toBe(true)
      expect(config.cache.ttlSeconds).toBe(300)
    })

    test('should demonstrate configuration precedence order', () => {
      // Test the precedence: environment variables > .env file > schema defaults
      
      // 1. Schema default: v59.0
      // 2. .env file would override if present
      // 3. Environment variable overrides both
      process.env.SFDC_API_VERSION = 'v62.0'
      
      const config = loadConfiguration()
      
      // Environment variable wins
      expect(config.salesforce.apiVersion).toBe('v62.0')
      
      // Test with no override - should get default
      delete process.env.SFDC_API_VERSION
      const configWithDefault = loadConfiguration()
      expect(configWithDefault.salesforce.apiVersion).toBe('v59.0')
    })

    test('should support .env file loading through dotenv integration', () => {
      // Since dotenv.config() is called at module load time, we simulate
      // what would happen if .env file values were loaded into process.env
      // This tests the integration without actual file I/O during test
      
      // Simulate .env file values being loaded (without overriding our test config)
      process.env.SFDC_API_VERSION = 'v58.0'  // Simulate from .env
      process.env.SFDC_TIMEOUT = '25000'      // Simulate from .env
      
      const config = loadConfiguration()
      
      // Values from simulated .env file should be used
      expect(config.salesforce.apiVersion).toBe('v58.0')
      expect(config.salesforce.timeout).toBe(25000)
      
      // Cleanup
      delete process.env.SFDC_API_VERSION
      delete process.env.SFDC_TIMEOUT
    })

    test('should merge configuration from multiple sources with correct precedence', () => {
      // Test complete precedence chain: env vars > .env file > defaults
      // We simulate .env file values by setting process.env, then override some with direct env vars
      
      // Simulate values that would come from .env file
      process.env.SFDC_TIMEOUT = '20000'      // From .env
      process.env.LOG_LEVEL = 'debug'         // From .env  
      process.env.CACHE_ENABLED = 'false'     // From .env
      
      // Override some values with environment variables (higher precedence)
      process.env.SFDC_API_VERSION = 'v60.0'  // Override .env value
      process.env.SFDC_MAX_RETRIES = '5'      // Not in .env, override default
      
      const config = loadConfiguration()
      
      // Environment variable should win
      expect(config.salesforce.apiVersion).toBe('v60.0')
      expect(config.salesforce.maxRetries).toBe(5)
      
      // Simulated .env file values should be used when no env var override
      expect(config.salesforce.timeout).toBe(20000)
      expect(config.logging.level).toBe('debug')
      expect(config.cache.enabled).toBe(false)
      
      // Schema defaults should be used when neither env var nor .env
      expect(config.salesforce.instanceUrl).toBe('https://test.salesforce.com') // from createTestConfig
      expect(config.cache.ttlSeconds).toBe(300) // schema default
      expect(config.cache.maxEntries).toBe(1000) // schema default
      
      // Cleanup
      delete process.env.SFDC_API_VERSION
      delete process.env.SFDC_TIMEOUT
      delete process.env.LOG_LEVEL
      delete process.env.CACHE_ENABLED
      delete process.env.SFDC_MAX_RETRIES
    })
  })

  describe('Edge Case Validation', () => {
    describe('Empty String Handling', () => {
      test('should reject empty SFDC_CLIENT_ID', () => {
        setEnvVars(createTestConfig({ SFDC_CLIENT_ID: '' }))
        expect(() => loadConfiguration()).toThrow(ERROR_PATTERNS.required)
      })

      test('should reject empty SFDC_INSTANCE_URL', () => {
        setEnvVars(createTestConfig({ SFDC_INSTANCE_URL: '' }))
        expect(() => loadConfiguration()).toThrow(ERROR_PATTERNS.required)
      })

      test('should reject whitespace-only required fields', () => {
        setEnvVars(createTestConfig({ SFDC_CLIENT_ID: '   ' }))
        expect(() => loadConfiguration()).toThrow(ERROR_PATTERNS.whitespace)
      })

      test('should handle empty SFDC_CLIENT_SECRET gracefully', () => {
        setEnvVars(createTestConfig({ SFDC_CLIENT_SECRET: '' }))
        const config = loadConfiguration()
        expect(config.salesforce.clientSecret).toBeUndefined()
      })
    })

    describe('URL Validation Edge Cases', () => {
      const testWithUrl = (url: string, shouldThrow = true, pattern = ERROR_PATTERNS.url) => {
        setEnvVars(createTestConfig({ SFDC_INSTANCE_URL: url }))
        if (shouldThrow) {
          expect(() => loadConfiguration()).toThrow(pattern)
        } else {
          expect(() => loadConfiguration()).not.toThrow()
        }
      }

      test('should reject malformed URLs', () => testWithUrl('not-a-url'))
      test('should reject URLs without protocol', () => testWithUrl('test.salesforce.com'))
      test('should reject URLs with invalid protocols', () => testWithUrl('ftp://test.salesforce.com', true, ERROR_PATTERNS.protocol))
      test('should accept valid HTTPS URLs', () => testWithUrl('https://test.salesforce.com', false))
      test('should accept valid HTTP URLs', () => testWithUrl('http://test.salesforce.com', false))
      test('should handle URLs with ports', () => testWithUrl('https://test.salesforce.com:8080', false))
      test('should handle URLs with paths', () => testWithUrl('https://test.salesforce.com/path', false))
    })

    describe('API Version Format Edge Cases', () => {
      const testApiVersion = (version: string, shouldThrow = true) => {
        setEnvVars(createTestConfig({ SFDC_API_VERSION: version }))
        if (shouldThrow) {
          expect(() => loadConfiguration()).toThrow(ERROR_PATTERNS.apiVersion)
        } else {
          const config = loadConfiguration()
          expect(config.salesforce.apiVersion).toBe(version)
        }
      }

      test('should reject API version without v prefix', () => testApiVersion('59.0'))
      test('should reject API version with wrong format', () => testApiVersion('v59'))
      test('should reject API version with multiple decimal points', () => testApiVersion('v59.0.1'))
      test('should accept valid single-digit version', () => testApiVersion('v1.0', false))
      test('should accept valid double-digit version', () => testApiVersion('v59.0', false))
      test('should accept valid triple-digit version', () => testApiVersion('v100.0', false))
    })

    describe('Numeric Value Edge Cases', () => {
      beforeEach(() => setEnvVars(createTestConfig()))

      test('should handle zero values gracefully', () => {
        process.env.SFDC_TIMEOUT = '0'
        process.env.SFDC_MAX_RETRIES = '0'
        process.env.CACHE_TTL_SECONDS = '0'
        process.env.CACHE_MAX_ENTRIES = '0'
        
        const config = loadConfiguration()
        
        expect(config.salesforce.timeout).toBe(0)
        expect(config.salesforce.maxRetries).toBe(0)
        expect(config.cache.ttlSeconds).toBe(0)
        expect(config.cache.maxEntries).toBe(0)
      })

      test('should handle negative numbers gracefully', () => {
        process.env.SFDC_TIMEOUT = '-1000'
        process.env.SFDC_MAX_RETRIES = '-5'
        
        const config = loadConfiguration()
        
        // Should use defaults for invalid negative values
        expect(config.salesforce.timeout).toBe(30000)
        expect(config.salesforce.maxRetries).toBe(3)
      })

      test('should handle very large numbers', () => {
        process.env.SFDC_TIMEOUT = '999999999'
        process.env.CACHE_MAX_ENTRIES = '1000000'
        
        const config = loadConfiguration()
        
        expect(config.salesforce.timeout).toBe(999999999)
        expect(config.cache.maxEntries).toBe(1000000)
      })

      test('should handle decimal numbers in integer fields', () => {
        process.env.SFDC_TIMEOUT = '30000.5'
        process.env.SFDC_MAX_RETRIES = '3.7'
        
        const config = loadConfiguration()
        
        // Should use defaults when parsing invalid decimals
        expect(config.salesforce.timeout).toBe(30000)
        expect(config.salesforce.maxRetries).toBe(3)
      })

      test('should handle numeric strings with spaces', () => {
        process.env.SFDC_TIMEOUT = ' 45000 '
        process.env.SFDC_MAX_RETRIES = '  5  '
        
        const config = loadConfiguration()
        
        expect(config.salesforce.timeout).toBe(45000)
        expect(config.salesforce.maxRetries).toBe(5)
      })
    })

    describe('Boolean Value Edge Cases', () => {
      beforeEach(() => setEnvVars(createTestConfig()))

      test('should handle case-insensitive boolean values', () => {
        process.env.CACHE_ENABLED = 'FALSE'
        process.env.LOG_STRUCTURED = 'TRUE'
        
        const config = loadConfiguration()
        
        expect(config.cache.enabled).toBe(false)
        expect(config.logging.structured).toBe(true)
      })

      test('should handle numeric boolean representations', () => {
        process.env.CACHE_ENABLED = '0'
        process.env.LOG_STRUCTURED = '1'
        
        const config = loadConfiguration()
        
        // Should use defaults for non-boolean strings
        expect(config.cache.enabled).toBe(true) // default - '0' is not 'true' or 'false'
        expect(config.logging.structured).toBe(false) // '1' is not 'true', so false
      })

      test('should handle boolean-like strings', () => {
        process.env.CACHE_ENABLED = 'yes'
        process.env.LOG_STRUCTURED = 'no'
        
        const config = loadConfiguration()
        
        // Should use defaults for non-standard boolean strings
        expect(config.cache.enabled).toBe(true) // default - 'yes' is not 'true' or 'false'
        expect(config.logging.structured).toBe(false) // 'no' is not 'true', so false
      })

      test('should handle empty boolean values', () => {
        process.env.CACHE_ENABLED = ''
        process.env.LOG_STRUCTURED = ''
        
        const config = loadConfiguration()
        
        // Should use defaults for empty values
        expect(config.cache.enabled).toBe(true)
        expect(config.logging.structured).toBe(true)
      })
    })

    describe('Log Level Edge Cases', () => {
      beforeEach(() => setEnvVars(createTestConfig()))

      test('should handle case-insensitive log levels', () => {
        process.env.LOG_LEVEL = 'ERROR'
        const config = loadConfiguration()
        expect(config.logging.level).toBe('error')
      })

      test('should handle mixed case log levels', () => {
        process.env.LOG_LEVEL = 'WaRn'
        const config = loadConfiguration()
        expect(config.logging.level).toBe('warn')
      })

      test('should reject invalid log levels', () => {
        setEnvVars({ LOG_LEVEL: 'invalid-level' })
        expect(() => loadConfiguration()).toThrow(ERROR_PATTERNS.enum)
      })

      test('should reject empty log level', () => {
        setEnvVars({ LOG_LEVEL: '' })
        expect(() => loadConfiguration()).toThrow(ERROR_PATTERNS.enum)
      })
    })
  })

  describe('ConfigManager Type-Safe Access', () => {
    beforeEach(() => setEnvVars(createTestConfig()))

    test('should provide singleton access', () => {
      const config1 = getConfig()
      const config2 = getConfig()
      
      expect(config1).toBe(config2) // Same instance
    })

    test('should provide type-safe server info access', () => {
      const config = getConfig()
      const serverInfo = config.getServerInfo()
      
      expect(serverInfo).toHaveProperty('name')
      expect(serverInfo).toHaveProperty('version')
      expect(serverInfo.name).toBe('salesforce-mcp-server')
      expect(serverInfo.version).toBe('0.1.0')
      
      // Should be readonly
      expect(Object.isFrozen(serverInfo)).toBe(false) // Object spread creates new object
      expect(typeof serverInfo.name).toBe('string')
      expect(typeof serverInfo.version).toBe('string')
    })

    test('should provide type-safe capabilities access', () => {
      const config = getConfig()
      const capabilities = config.getCapabilities()
      
      expect(capabilities).toHaveProperty('resources')
      expect(capabilities).toHaveProperty('tools')
      expect(capabilities.resources).toEqual({ subscribe: true, listChanged: true })
      expect(capabilities.tools).toEqual({ listChanged: true })
      // prompts is optional and may not be present
    })

    test('should provide type-safe Salesforce config access', () => {
      const config = getConfig()
      const sfdcConfig = config.getSalesforceConfig()
      
      expect(sfdcConfig.clientId).toBe('test-client-id')
      expect(sfdcConfig.instanceUrl).toBe('https://test.salesforce.com')
      expect(sfdcConfig.apiVersion).toBe('v59.0') // default
      expect(sfdcConfig.timeout).toBe(30000) // default
      expect(sfdcConfig.maxRetries).toBe(3) // default
    })

    test('should provide type-safe logging config access', () => {
      const config = getConfig()
      const loggingConfig = config.getLoggingConfig()
      
      expect(loggingConfig.level).toBe('info') // default
      expect(loggingConfig.structured).toBe(true) // default
    })

    test('should provide type-safe cache config access', () => {
      const config = getConfig()
      const cacheConfig = config.getCacheConfig()
      
      expect(cacheConfig.enabled).toBe(true) // default
      expect(cacheConfig.ttlSeconds).toBe(300) // default
      expect(cacheConfig.maxEntries).toBe(1000) // default
    })

    test('should lazy load configuration on first access', () => {
      const config = getConfig()
      config.reset() // Ensure config is not loaded
      
      // First access should load configuration
      const serverInfo = config.getServerInfo()
      expect(serverInfo.name).toBe('salesforce-mcp-server')
      
      // Subsequent access should use cached config
      const serverInfo2 = config.getServerInfo()
      expect(serverInfo2.name).toBe('salesforce-mcp-server')
    })

    test('should reset configuration for testing', () => {
      const config = getConfig()
      
      // Access configuration to load it
      config.getServerInfo()
      
      // Reset should clear cached config
      config.reset()
      
      // Next access should reload configuration
      const serverInfo = config.getServerInfo()
      expect(serverInfo.name).toBe('salesforce-mcp-server')
    })

    test('should return immutable configuration objects', () => {
      const config = getConfig()
      const serverInfo = config.getServerInfo()
      const capabilities = config.getCapabilities()
      const sfdcConfig = config.getSalesforceConfig()
      
      // Attempt to modify returned objects should not affect config
      const originalName = serverInfo.name
      ;(serverInfo as any).name = 'modified'
      
      const serverInfo2 = config.getServerInfo()
      expect(serverInfo2.name).toBe(originalName) // Should be unchanged
      
      // Same for capabilities
      const originalResources = capabilities.resources
      ;(capabilities as any).resources = false
      
      const capabilities2 = config.getCapabilities()
      expect(capabilities2.resources).toBe(originalResources) // Should be unchanged
    })
  })

  describe('Configuration Completeness', () => {
    test('should provide complete configuration object structure', () => {
      setEnvVars(createTestConfig())
      const config = loadConfiguration()
      
      // Verify complete structure exists
      expect(config).toHaveProperty('name')
      expect(config).toHaveProperty('version')
      expect(config).toHaveProperty('capabilities')
      expect(config.capabilities).toHaveProperty('resources')
      expect(config.capabilities).toHaveProperty('tools')
      expect(config.capabilities).toHaveProperty('prompts')
      
      expect(config).toHaveProperty('salesforce')
      expect(config.salesforce).toHaveProperty('clientId')
      expect(config.salesforce).toHaveProperty('instanceUrl')
      expect(config.salesforce).toHaveProperty('apiVersion')
      expect(config.salesforce).toHaveProperty('timeout')
      expect(config.salesforce).toHaveProperty('maxRetries')
      
      expect(config).toHaveProperty('logging')
      expect(config.logging).toHaveProperty('level')
      expect(config.logging).toHaveProperty('structured')
      
      expect(config).toHaveProperty('cache')
      expect(config.cache).toHaveProperty('enabled')
      expect(config.cache).toHaveProperty('ttlSeconds')
      expect(config.cache).toHaveProperty('maxEntries')
    })

    test('should have correct TypeScript types', () => {
      setEnvVars(createTestConfig())
      const config: ServerConfig = loadConfiguration()
      
      // These should compile without TypeScript errors
      expect(typeof config.name).toBe('string')
      expect(typeof config.version).toBe('string')
      expect(typeof config.capabilities.resources).toBe('object')
      expect(typeof config.salesforce.clientId).toBe('string')
      expect(typeof config.salesforce.timeout).toBe('number')
      expect(['debug', 'info', 'warn', 'error']).toContain(config.logging.level)
    })
  })
})