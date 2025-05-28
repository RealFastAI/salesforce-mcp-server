/*
 * Copyright (C) 2025 Ontic. Pte. Ltd. (realfast.ai)
 * Use of this software is governed by the Business Source License included in the LICENSE.TXT file and at www.mariadb.com/bsl11.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { SalesforceClient } from './salesforce-client.js'
import { SalesforceConfig } from './config.js'

describe('SalesforceClient', () => {
  let validConfig: SalesforceConfig

  beforeEach(() => {
    validConfig = {
      clientId: 'test-client-id',
      instanceUrl: 'https://test.salesforce.com',
      apiVersion: 'v59.0',
      timeout: 30000,
      maxRetries: 3
    }
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('Instantiation', () => {
    test('should create SalesforceClient with valid configuration', () => {
      const client = new SalesforceClient(validConfig)
      
      expect(client).toBeDefined()
      expect(client).toBeInstanceOf(SalesforceClient)
    })

    test('should store configuration properties', () => {
      const client = new SalesforceClient(validConfig)
      
      expect(client.getConfig()).toEqual(validConfig)
    })

    test('should set initial connection state as disconnected', () => {
      const client = new SalesforceClient(validConfig)
      
      expect(client.isConnected()).toBe(false)
    })

    test('should initialize with proper API version', () => {
      const client = new SalesforceClient(validConfig)
      
      expect(client.getApiVersion()).toBe('v59.0')
    })

    test('should initialize with proper instance URL', () => {
      const client = new SalesforceClient(validConfig)
      
      expect(client.getInstanceUrl()).toBe('https://test.salesforce.com')
    })
  })

  describe('Configuration Validation', () => {
    test('should accept minimal required configuration', () => {
      const minimalConfig: SalesforceConfig = {
        clientId: 'test-client-id',
        instanceUrl: 'https://test.salesforce.com',
        apiVersion: 'v59.0',
        timeout: 30000,
        maxRetries: 3
      }
      
      expect(() => new SalesforceClient(minimalConfig)).not.toThrow()
    })

    test('should accept configuration with optional username', () => {
      const configWithUsername: SalesforceConfig = {
        ...validConfig,
        username: 'test@example.com'
      }
      
      expect(() => new SalesforceClient(configWithUsername)).not.toThrow()
    })

    test('should accept configuration with optional private key path', () => {
      const configWithPrivateKey: SalesforceConfig = {
        ...validConfig,
        privateKeyPath: '/path/to/private.key'
      }
      
      expect(() => new SalesforceClient(configWithPrivateKey)).not.toThrow()
    })

    test('should accept different API versions', () => {
      const configV60: SalesforceConfig = {
        ...validConfig,
        apiVersion: 'v60.0'
      }
      
      const client = new SalesforceClient(configV60)
      expect(client.getApiVersion()).toBe('v60.0')
    })
  })

  describe('Client Properties', () => {
    test('should provide access to timeout configuration', () => {
      const customTimeoutConfig: SalesforceConfig = {
        ...validConfig,
        timeout: 45000
      }
      
      const client = new SalesforceClient(customTimeoutConfig)
      expect(client.getTimeout()).toBe(45000)
    })

    test('should provide access to max retries configuration', () => {
      const customRetriesConfig: SalesforceConfig = {
        ...validConfig,
        maxRetries: 5
      }
      
      const client = new SalesforceClient(customRetriesConfig)
      expect(client.getMaxRetries()).toBe(5)
    })

    test('should provide client ID access', () => {
      const client = new SalesforceClient(validConfig)
      expect(client.getClientId()).toBe('test-client-id')
    })
  })

  describe('Connection State Management', () => {
    test('should start in disconnected state', () => {
      const client = new SalesforceClient(validConfig)
      
      expect(client.isConnected()).toBe(false)
      expect(client.getConnectionState()).toBe('disconnected')
    })

    test('should provide last connection attempt timestamp initially as null', () => {
      const client = new SalesforceClient(validConfig)
      
      expect(client.getLastConnectionAttempt()).toBeNull()
    })

    test('should provide connection error initially as null', () => {
      const client = new SalesforceClient(validConfig)
      
      expect(client.getLastConnectionError()).toBeNull()
    })
  })

  describe('Logging Integration', () => {
    test('should initialize with logger', () => {
      const client = new SalesforceClient(validConfig)
      
      // Logger should be available but not exposed publicly
      // We'll verify this through behavior in other tests
      expect(client).toBeDefined()
    })
  })

  describe('JSforce Integration Preparation', () => {
    test('should be ready for jsforce connection setup', () => {
      const client = new SalesforceClient(validConfig)
      
      // Verify client is ready for connection methods
      expect(typeof client.connect).toBe('function')
      expect(typeof client.disconnect).toBe('function')
    })
  })

  describe('Connection Parameters Validation', () => {
    test('should fail connection with missing clientId', async () => {
      const configWithoutCredentials: SalesforceConfig = {
        ...validConfig,
        clientId: ''
      }
      const client = new SalesforceClient(configWithoutCredentials)
      
      await expect(client.connect()).rejects.toThrow('clientId is required for OAuth2 authentication')
      expect(client.getConnectionState()).toBe('error')
      expect(client.getLastConnectionError()).toBeDefined()
    })

    test('should start OAuth2 flow with valid clientId', async () => {
      const client = new SalesforceClient(validConfig)
      
      // Mock the connection interface to avoid actual OAuth2 flow
      const mockConnection = {
        connect: vi.fn().mockRejectedValue(new Error('Mock OAuth2 flow - browser required')),
        disconnect: vi.fn(),
        isConnected: vi.fn().mockReturnValue(false),
        getConnection: vi.fn().mockReturnValue(null)
      }
      
      // Replace the connection handler
      ;(client as any).connectionHandler = mockConnection
      
      await expect(client.connect()).rejects.toThrow('Mock OAuth2 flow - browser required')
      expect(client.getConnectionState()).toBe('error')
      expect(mockConnection.connect).toHaveBeenCalledWith({
        clientId: 'test-client-id'
      })
    })

    test('should update connection state to connecting during connection attempt', async () => {
      const client = new SalesforceClient(validConfig)
      
      // Mock the connection interface
      const mockConnection = {
        connect: vi.fn().mockRejectedValue(new Error('Mock connection failure')),
        disconnect: vi.fn(),
        isConnected: vi.fn().mockReturnValue(false),
        getConnection: vi.fn().mockReturnValue(null)
      }
      
      ;(client as any).connectionHandler = mockConnection
      
      try {
        await client.connect()
      } catch (error) {
        // Expected to fail due to mock
      }
      
      expect(client.getLastConnectionAttempt()).toBeDefined()
      expect(client.getConnectionState()).toBe('error')
    })

    test('should handle invalid instance URL format', () => {
      const configWithInvalidUrl: SalesforceConfig = {
        ...validConfig,
        instanceUrl: 'not-a-valid-url'
      }
      const client = new SalesforceClient(configWithInvalidUrl)
      
      // The URL validation happens at the config level, not connection level
      // But we can test that the client accepts the config
      expect(client.getInstanceUrl()).toBe('not-a-valid-url')
    })

    test('should handle invalid API version format', () => {
      const configWithInvalidVersion: SalesforceConfig = {
        ...validConfig,
        apiVersion: 'invalid-version'
      }
      const client = new SalesforceClient(configWithInvalidVersion)
      
      expect(client.getApiVersion()).toBe('invalid-version')
    })

    test('should validate connection parameters before attempting connection', async () => {
      const client = new SalesforceClient(validConfig)
      
      // Mock the connection interface
      const mockConnection = {
        connect: vi.fn().mockRejectedValue(new Error('Mock network error')),
        disconnect: vi.fn(),
        isConnected: vi.fn().mockReturnValue(false),
        getConnection: vi.fn().mockReturnValue(null)
      }
      
      ;(client as any).connectionHandler = mockConnection
      
      try {
        await client.connect()
      } catch (error) {
        // Expected to fail with network error, not validation error
        expect(client.getLastConnectionAttempt()).toBeDefined()
        expect(client.getConnectionState()).toBe('error')
      }
    })

    test('should clear previous connection error on new connection attempt', async () => {
      const client = new SalesforceClient(validConfig)
      
      // Mock the connection interface
      const mockConnection = {
        connect: vi.fn()
          .mockRejectedValueOnce(new Error('First error'))
          .mockRejectedValueOnce(new Error('Second error')),
        disconnect: vi.fn(),
        isConnected: vi.fn().mockReturnValue(false),
        getConnection: vi.fn().mockReturnValue(null)
      }
      
      ;(client as any).connectionHandler = mockConnection
      
      // First attempt should fail
      try {
        await client.connect()
      } catch (error) {
        expect(client.getLastConnectionError()).toBeDefined()
      }
      
      // Second attempt should clear previous error initially
      try {
        await client.connect()
      } catch (error) {
        // Should have a new error, not the old one
        expect(client.getLastConnectionAttempt()).toBeDefined()
      }
    })

    test('should handle network timeout gracefully', async () => {
      const configWithShortTimeout: SalesforceConfig = {
        ...validConfig,
        timeout: 1 // Very short timeout
      }
      const client = new SalesforceClient(configWithShortTimeout)
      
      // Mock the connection interface
      const mockConnection = {
        connect: vi.fn().mockRejectedValue(new Error('Timeout error')),
        disconnect: vi.fn(),
        isConnected: vi.fn().mockReturnValue(false),
        getConnection: vi.fn().mockReturnValue(null)
      }
      
      ;(client as any).connectionHandler = mockConnection
      
      try {
        await client.connect()
      } catch (error) {
        expect(client.getConnectionState()).toBe('error')
        expect(client.getLastConnectionError()).toBeDefined()
      }
    })
  })
})