/*
 * Copyright (C) 2025 Ontic Pte. Ltd. (realfast.ai)
 * Use of this software is governed by the Business Source License included in the LICENSE.TXT file and at www.mariadb.com/bsl11.
 */

import { Connection } from 'jsforce'
import { createChildLogger } from '../logger.js'
import { ToolError, ErrorCode } from '../errors.js'
import type { ConnectionConfig, AuthenticationCredentials, ConnectionInfo, OAuth2Tokens, ITokenStorage, ISalesforceConnection } from './types.js'
import { FileTokenStorage } from './storage.js'
import { OAuth2Handler } from './oauth2.js'

export class SalesforceConnection implements ISalesforceConnection {
  private connection: Connection | null = null
  private readonly config: ConnectionConfig
  private readonly tokenStorage: ITokenStorage
  private readonly oauth2Handler: OAuth2Handler
  private readonly logger = createChildLogger('salesforce-connection')

  constructor(config: ConnectionConfig, tokenStorage?: ITokenStorage) {
    this.config = { ...config }
    this.tokenStorage = tokenStorage ?? new FileTokenStorage()
    this.oauth2Handler = new OAuth2Handler(config)
  }

  async connect(credentials: AuthenticationCredentials): Promise<ConnectionInfo> {
    // Try to use stored tokens first
    const storedTokens = await this.tokenStorage.getTokens()
    if (storedTokens && this.isTokenValid(storedTokens)) {
      this.logger.info('Using stored access token for authentication')
      return await this.connectWithToken(storedTokens)
    }

    // Try to refresh token if available
    if (storedTokens?.refreshToken) {
      this.logger.info('Refreshing expired access token')
      try {
        const newTokens = await this.oauth2Handler.refreshAccessToken(storedTokens)
        await this.tokenStorage.saveTokens(newTokens)
        return await this.connectWithToken(newTokens)
      } catch {
        this.logger.warn('Token refresh failed, starting new OAuth flow')
        await this.tokenStorage.clearTokens()
      }
    }

    // Start OAuth2 browser flow
    if (!credentials.clientId) {
      throw new ToolError('clientId is required for OAuth2 authentication', ErrorCode.INVALID_CONFIG, 'oauth2_flow')
    }

    this.logger.info('Starting OAuth2 browser authentication flow')
    const tokens = await this.oauth2Handler.authenticateWithBrowser(credentials.clientId)
    
    try {
      // Save tokens
      await this.tokenStorage.saveTokens(tokens)
      this.logger.info('✅ Authentication successful! Tokens saved for future use')
    } catch (error) {
      this.logger.error({ error }, 'Failed to save OAuth2 tokens')
      throw new ToolError(`Token storage failed: ${error instanceof Error ? error.message : 'Unknown error'}`, ErrorCode.INTERNAL_ERROR, 'oauth2_flow')
    }

    return await this.connectWithToken(tokens)
  }

  private isTokenValid(tokens: OAuth2Tokens): boolean {
    if (!tokens.expiresAt) return true // No expiry info, assume valid
    return Date.now() < tokens.expiresAt - 300000 // 5 minute buffer
  }

  private async connectWithToken(tokens: OAuth2Tokens): Promise<ConnectionInfo> {
    this.connection = new Connection({
      instanceUrl: tokens.instanceUrl,
      version: this.config.apiVersion.replace('v', ''),
      maxRequest: this.config.maxRetries,
      accessToken: tokens.accessToken
    })

    // Test the connection and get user info
    const userInfo = await this.connection.identity()

    return {
      organizationId: userInfo.organization_id,
      userId: userInfo.user_id,
      sessionId: tokens.accessToken
    }
  }

  disconnect(): void {
    if (this.connection) {
      this.connection = null
    }
  }

  isConnected(): boolean {
    return this.connection !== null
  }

  getConnection(): Connection | null {
    return this.connection
  }
}