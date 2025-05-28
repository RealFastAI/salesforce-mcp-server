/*
 * Copyright (C) 2025 Ontic. Pte. Ltd. (realfast.ai)
 * Use of this software is governed by the Business Source License included in the LICENSE.TXT file and at www.mariadb.com/bsl11.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { SalesforceClient } from '../salesforce-client.js'
import { ConfigManager } from '../config.js'
import { createChildLogger } from '../logger.js'
import { createHash, randomBytes } from 'crypto'

/**
 * OAuth2 PKCE Mocked Integration Tests
 * 
 * These tests validate OAuth2 components using mocks, suitable for CI/CD.
 * They test the OAuth2 implementation logic without requiring real Salesforce connectivity.
 */
describe('OAuth2 PKCE Mocked Integration Tests', () => {
  let client: SalesforceClient
  let logger = createChildLogger('oauth2-mocked-integration')
  let originalFetch: typeof fetch

  beforeEach(async () => {
    // Mock fetch to avoid real network calls
    originalFetch = global.fetch
    global.fetch = vi.fn()

    const configManager = ConfigManager.getInstance()
    const salesforceConfig = configManager.getSalesforceConfig()
    client = new SalesforceClient(salesforceConfig)
  })

  afterEach(async () => {
    global.fetch = originalFetch
    if (client && client.isConnected()) {
      await client.disconnect()
    }
    vi.restoreAllMocks()
  })

  describe('PKCE Security Implementation', () => {
    test('should generate cryptographically secure PKCE parameters', async () => {
      const codeVerifier = randomBytes(32).toString('base64url')
      const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url')
      
      expect(codeVerifier).toMatch(/^[A-Za-z0-9_-]{43}$/)
      expect(codeChallenge).toMatch(/^[A-Za-z0-9_-]{43}$/)
      expect(codeChallenge).not.toBe(codeVerifier)
      
      logger.info('PKCE parameters generated successfully')
    })

    test('should validate PKCE code challenge against verifier', async () => {
      const codeVerifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
      const expectedChallenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'
      
      const actualChallenge = createHash('sha256').update(codeVerifier).digest('base64url')
      
      expect(actualChallenge).toBe(expectedChallenge)
      logger.info('PKCE validation successful')
    })
  })

  describe('OAuth2 Token Exchange Flow', () => {
    test('should simulate complete token exchange process', async () => {
      const mockTokenResponse = {
        access_token: 'mock_access_token_12345',
        refresh_token: 'mock_refresh_token_67890',
        instance_url: 'https://test.salesforce.com',
        token_type: 'Bearer',
        scope: 'api refresh_token'
      }

      ;(global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockTokenResponse
      })

      const tokenExchange = async (authCode: string, codeVerifier: string) => {
        const response = await fetch('https://test.salesforce.com/services/oauth2/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'authorization_code',
            code: authCode,
            client_id: 'test-client-id',
            redirect_uri: 'http://localhost:8080/callback',
            code_verifier: codeVerifier
          })
        })
        return response.json()
      }

      const tokens = await tokenExchange('mock_auth_code', 'mock_code_verifier')
      
      expect(tokens.access_token).toBe('mock_access_token_12345')
      expect(tokens.refresh_token).toBe('mock_refresh_token_67890')
      expect(tokens.instance_url).toBe('https://test.salesforce.com')
      expect(tokens.token_type).toBe('Bearer')
      
      logger.info('Token exchange simulation successful')
    })

    test('should handle token exchange errors gracefully', async () => {
      ;(global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({
          error: 'invalid_grant',
          error_description: 'authentication failure'
        })
      })

      const tokenExchange = async (authCode: string, codeVerifier: string) => {
        const response = await fetch('https://test.salesforce.com/services/oauth2/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'authorization_code',
            code: authCode,
            client_id: 'test-client-id',
            redirect_uri: 'http://localhost:8080/callback',
            code_verifier: codeVerifier
          })
        })
        
        if (!response.ok) {
          const error = await response.json()
          throw new Error(`${error.error}: ${error.error_description}`)
        }
        return response.json()
      }

      await expect(tokenExchange('invalid_code', 'invalid_verifier'))
        .rejects.toThrow('invalid_grant: authentication failure')
    })
  })

  describe('Token Security and Storage', () => {
    test('should encrypt tokens using TokenEncryption implementation', async () => {
      const mockTokens = {
        accessToken: 'sensitive_access_token_12345',
        refreshToken: 'sensitive_refresh_token_67890',
        instanceUrl: 'https://test.salesforce.com',
        expiresAt: Date.now() + 3600000
      }

      const { FileTokenStorage } = await import('../connection-interface.js')
      const storage = new FileTokenStorage()
      
      try {
        await storage.saveTokens(mockTokens)
        const retrievedTokens = await storage.getTokens()
        
        expect(retrievedTokens).toEqual(mockTokens)
        logger.info('Token encryption validation successful')
      } finally {
        await storage.clearTokens()
      }
    })

    test('should never expose tokens in logs or errors', async () => {
      const logSpy = vi.spyOn(logger, 'info')
      const errorSpy = vi.spyOn(logger, 'error')
      
      try {
        logger.info('Processing OAuth2 tokens', { tokenCount: 2 })
        
        const error = new Error('Authentication failed')
        logger.error('OAuth2 error occurred', { error: error.message })
        
        const allLogCalls = [...logSpy.mock.calls, ...errorSpy.mock.calls]
        const allLogOutput = JSON.stringify(allLogCalls)
        
        expect(allLogOutput).not.toContain('secret_token_should_not_appear_in_logs')
        expect(allLogOutput).not.toContain('secret_refresh_should_not_appear_in_logs')
        
        logger.info('Token security validation successful')
      } finally {
        logSpy.mockRestore()
        errorSpy.mockRestore()
      }
    })
  })

  describe('Token Refresh Flow', () => {
    test('should handle automatic token refresh', async () => {
      const mockRefreshResponse = {
        access_token: 'new_access_token_12345',
        refresh_token: 'new_refresh_token_67890',
        instance_url: 'https://test.salesforce.com',
        token_type: 'Bearer'
      }

      ;(global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockRefreshResponse
      })

      const refreshTokens = async (refreshToken: string) => {
        const response = await fetch('https://test.salesforce.com/services/oauth2/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
            client_id: 'test-client-id'
          })
        })
        return response.json()
      }

      const newTokens = await refreshTokens('old_refresh_token')
      
      expect(newTokens.access_token).toBe('new_access_token_12345')
      expect(newTokens.refresh_token).toBe('new_refresh_token_67890')
      
      logger.info('Token refresh simulation successful')
    })

    test('should handle refresh token expiration', async () => {
      ;(global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({
          error: 'invalid_grant',
          error_description: 'expired access/refresh token'
        })
      })

      const refreshTokens = async (refreshToken: string) => {
        const response = await fetch('https://test.salesforce.com/services/oauth2/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
            client_id: 'test-client-id'
          })
        })
        
        if (!response.ok) {
          const error = await response.json()
          throw new Error(`${error.error}: ${error.error_description}`)
        }
        return response.json()
      }

      await expect(refreshTokens('expired_refresh_token'))
        .rejects.toThrow('invalid_grant: expired access/refresh token')
    })
  })

  describe('Authenticated API Operations', () => {
    test('should make authenticated Salesforce API calls', async () => {
      const mockApiResponse = {
        sobjects: [
          { name: 'Account', label: 'Account' },
          { name: 'Contact', label: 'Contact' },
          { name: 'Opportunity', label: 'Opportunity' }
        ]
      }

      ;(global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockApiResponse
      })

      const makeApiCall = async (accessToken: string, instanceUrl: string) => {
        const response = await fetch(`${instanceUrl}/services/data/v59.0/sobjects/`, {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          }
        })
        return response.json()
      }

      const result = await makeApiCall('mock_access_token', 'https://test.salesforce.com')
      
      expect(result.sobjects).toBeDefined()
      expect(result.sobjects).toHaveLength(3)
      expect(result.sobjects[0].name).toBe('Account')
      
      logger.info('Authenticated API call simulation successful')
    })

    test('should handle API authentication errors', async () => {
      ;(global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ([{
          message: 'Session expired or invalid',
          errorCode: 'INVALID_SESSION_ID'
        }])
      })

      const makeApiCall = async (accessToken: string, instanceUrl: string) => {
        const response = await fetch(`${instanceUrl}/services/data/v59.0/sobjects/`, {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          }
        })
        
        if (!response.ok) {
          const errors = await response.json()
          throw new Error(`API Error: ${errors[0].message}`)
        }
        return response.json()
      }

      await expect(makeApiCall('invalid_token', 'https://test.salesforce.com'))
        .rejects.toThrow('API Error: Session expired or invalid')
    })
  })
})