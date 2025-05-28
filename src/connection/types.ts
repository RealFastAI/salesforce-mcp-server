/*
 * Copyright (C) 2025 Ontic Pte. Ltd. (realfast.ai)
 * Use of this software is governed by the Business Source License included in the LICENSE.TXT file and at www.mariadb.com/bsl11.
 */

import type { Connection } from 'jsforce'

export interface OAuth2CallbackConfig {
  readonly callbackPort: number
  readonly callbackHost: string
  readonly scopes: string[]
}

export interface ConnectionConfig {
  readonly instanceUrl: string
  readonly apiVersion: string
  readonly maxRetries: number
  readonly timeout: number
  readonly oauth2: OAuth2CallbackConfig
}

export interface AuthenticationCredentials {
  readonly username?: string | undefined
  readonly clientSecret?: string | undefined
  readonly clientId?: string | undefined
  readonly privateKeyPath?: string | undefined
  readonly privateKey?: string | undefined
  readonly jwtAudience?: string | undefined
}

export interface OAuth2Tokens {
  readonly accessToken: string
  readonly refreshToken?: string | undefined
  readonly instanceUrl: string
  readonly expiresAt?: number | undefined
}

export interface OAuth2Config {
  readonly clientId: string
  readonly redirectUri: string
  readonly scopes: string[]
}

export interface ConnectionInfo {
  readonly organizationId?: string | undefined
  readonly userId?: string | undefined
  readonly sessionId?: string | undefined
}

export interface ITokenStorage {
  getTokens(): Promise<OAuth2Tokens | null>
  saveTokens(tokens: OAuth2Tokens): Promise<void>
  clearTokens(): Promise<void>
}

export interface ISalesforceConnection {
  connect(credentials: AuthenticationCredentials): Promise<ConnectionInfo>
  disconnect(): void
  isConnected(): boolean
  getConnection(): Connection | null
}