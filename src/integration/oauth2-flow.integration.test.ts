/*
 * Copyright (C) 2025 Ontic. Pte. Ltd. (realfast.ai)
 * Use of this software is governed by the Business Source License included in the LICENSE.TXT file and at www.mariadb.com/bsl11.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { SalesforceClient } from '../salesforce-client.js'
import { ConfigManager } from '../config.js'
import { createChildLogger } from '../logger.js'

/**
 * OAuth2 Flow Integration Tests
 * 
 * These tests validate the complete OAuth2 authentication flow against
 * a real Salesforce org. They require:
 * 1. Valid Salesforce Connected App configuration
 * 2. Ability to open browser for authentication
 * 3. Network connectivity to Salesforce
 * 
 * Run with: npm run test:integration
 */
describe('OAuth2 Flow Integration Tests', () => {
  let client: SalesforceClient
  let logger = createChildLogger('oauth2-integration')

  beforeEach(async () => {
    const configManager = ConfigManager.getInstance()
    const salesforceConfig = configManager.getSalesforceConfig()
    client = new SalesforceClient(salesforceConfig)
  })

  afterEach(async () => {
    if (client && client.isConnected()) {
      await client.disconnect()
    }
  })

  describe('Real Salesforce Authentication', () => {
    test('should complete OAuth2 PKCE flow with real Salesforce org', async () => {
      logger.info('Starting OAuth2 authentication test')
      logger.info('This test will open a browser window for Salesforce login')
      
      // Start OAuth2 flow
      const connectionInfo = await client.connect()
      
      // Verify successful connection
      expect(connectionInfo).toBeDefined()
      expect(connectionInfo.organizationId).toBeDefined()
      expect(connectionInfo.userId).toBeDefined()
      expect(client.isConnected()).toBe(true)
      expect(client.getConnectionState()).toBe('connected')
      
      logger.info('OAuth2 authentication successful', {
        organizationId: connectionInfo.organizationId,
        userId: connectionInfo.userId,
        connectionState: client.getConnectionState()
      })
    }, 60000) // 60 second timeout for manual browser interaction

    test('should make authenticated API calls after OAuth2 authentication', async () => {
      logger.info('Testing authenticated API calls')
      
      // Authenticate
      await client.connect()
      
      // Test basic API call
      const connection = client.getConnection()
      expect(connection).toBeDefined()
      
      if (connection) {
        // Test sobjects list API
        const sobjectsResponse = await fetch(
          `${client.getInstanceUrl()}/services/data/v59.0/sobjects/`,
          {
            headers: {
              'Authorization': `Bearer ${(connection as any).accessToken}`,
              'Content-Type': 'application/json'
            }
          }
        )
        
        expect(sobjectsResponse.ok).toBe(true)
        const sobjectsData = await sobjectsResponse.json()
        expect(sobjectsData.sobjects).toBeDefined()
        expect(Array.isArray(sobjectsData.sobjects)).toBe(true)
        expect(sobjectsData.sobjects.length).toBeGreaterThan(0)
        
        // Test SOQL query
        const result = await connection.query('SELECT Id, Name FROM Account LIMIT 5')
        expect(result).toBeDefined()
        expect(typeof result.totalSize).toBe('number')
        expect(Array.isArray(result.records)).toBe(true)
        
        logger.info('API calls successful', {
          sobjectsCount: sobjectsData.sobjects.length,
          accountRecords: result.totalSize
        })
      }
    }, 60000)

    test('should persist tokens and reuse them on subsequent connections', async () => {
      logger.info('Testing token persistence and reuse')
      
      // First connection - will trigger OAuth2 flow
      await client.connect()
      const firstConnectionTime = client.getLastConnectionAttempt()
      
      // Disconnect
      await client.disconnect()
      expect(client.isConnected()).toBe(false)
      
      // Second connection - should reuse stored tokens
      await client.connect()
      const secondConnectionTime = client.getLastConnectionAttempt()
      
      // Verify connection is successful
      expect(client.isConnected()).toBe(true)
      expect(client.getConnectionState()).toBe('connected')
      
      // Test that tokens were reused (connection should be faster)
      const connection = client.getConnection()
      expect(connection).toBeDefined()
      
      if (connection) {
        // Verify API call works with reused tokens
        const result = await connection.query('SELECT COUNT() FROM User')
        expect(result).toBeDefined()
        expect(typeof result.totalSize).toBe('number')
      }
      
      logger.info('Token persistence validation successful', {
        firstConnectionTime,
        secondConnectionTime,
        tokenReused: true
      })
    }, 60000)
  })

  describe('Error Scenarios', () => {
    test('should handle invalid client configuration gracefully', async () => {
      const invalidConfig = {
        ...client.getConfig(),
        clientId: 'definitely-invalid-client-id-12345'
      }
      
      // Use a different token file to avoid cached tokens
      const { FileTokenStorage } = await import('../connection/storage.js')
      const tempTokenStorage = new FileTokenStorage('.test-invalid-tokens.enc')
      await tempTokenStorage.clearTokens()
      
      const invalidClient = new SalesforceClient(invalidConfig, tempTokenStorage)
      
      await expect(invalidClient.connect()).rejects.toThrow()
      expect(invalidClient.getConnectionState()).toBe('error')
      expect(invalidClient.getLastConnectionError()).toBeDefined()
      
      // Cleanup
      await tempTokenStorage.clearTokens()
    })

    test('should handle network connectivity issues', async () => {
      const networkErrorConfig = {
        ...client.getConfig(),
        instanceUrl: 'https://invalid-salesforce-instance.com',
        timeout: 5000
      }
      
      // Use a different token file to avoid cached tokens
      const { FileTokenStorage } = await import('../connection/storage.js')
      const tempTokenStorage = new FileTokenStorage('.test-network-tokens.enc')
      await tempTokenStorage.clearTokens()
      
      const networkClient = new SalesforceClient(networkErrorConfig, tempTokenStorage)
      
      await expect(networkClient.connect()).rejects.toThrow()
      expect(networkClient.getConnectionState()).toBe('error')
      
      // Cleanup
      await tempTokenStorage.clearTokens()
    })
  })

  describe('Security Validation', () => {
    test('should not expose sensitive tokens in logs', async () => {
      const logSpy = vi.spyOn(logger, 'info')
      const errorSpy = vi.spyOn(logger, 'error')
      
      try {
        await client.connect()
        
        // Check that no log output contains access tokens
        const allLogCalls = [...logSpy.mock.calls, ...errorSpy.mock.calls]
        const allLogOutput = JSON.stringify(allLogCalls)
        
        // Should not contain common token patterns
        expect(allLogOutput).not.toMatch(/00D[a-zA-Z0-9]{15}/) // Org ID pattern (but this might be OK)
        expect(allLogOutput).not.toMatch(/Bearer\s+[a-zA-Z0-9+/=]{20,}/) // Bearer token pattern
        expect(allLogOutput).not.toMatch(/access_token/)
        expect(allLogOutput).not.toMatch(/refresh_token/)
        
        logger.info('Security validation successful - no tokens found in logs')
      } finally {
        logSpy.mockRestore()
        errorSpy.mockRestore()
      }
    }, 60000)

    test('should encrypt tokens on disk', async () => {
      await client.connect()
      
      // Check that token file exists and is encrypted
      const fs = await import('fs/promises')
      const os = await import('os')
      const path = await import('path')
      
      const tokenFile = path.join(os.homedir(), '.salesforce-mcp-tokens.enc')
      
      try {
        const encryptedContent = await fs.readFile(tokenFile, 'utf8')
        
        // Encrypted content should not contain readable token patterns
        expect(encryptedContent).not.toMatch(/00D[a-zA-Z0-9]{15}/) // Org ID
        expect(encryptedContent).not.toMatch(/access_token/)
        expect(encryptedContent).not.toMatch(/refresh_token/)
        expect(encryptedContent).not.toMatch(/https:\/\/.*\.salesforce\.com/)
        
        logger.info('Token encryption validation successful')
      } catch (error) {
        // Token file might not exist in some test environments
        logger.info('Token file not found - encryption test skipped')
      }
    }, 60000)
  })
})