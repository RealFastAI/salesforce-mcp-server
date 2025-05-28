/*
 * Copyright (C) 2025 Ontic. Pte. Ltd. (realfast.ai)
 * Use of this software is governed by the Business Source License included in the LICENSE.TXT file and at www.mariadb.com/bsl11.
 */

import { Connection } from 'jsforce'
import { SalesforceConfig } from './config.js'
import { createChildLogger } from './logger.js'
import { ISalesforceConnection, SalesforceConnection, ConnectionInfo, AuthenticationCredentials } from './connection-interface.js'
import { ToolError, ErrorCode } from './errors.js'

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error'

export class SalesforceClient {
  private readonly config: SalesforceConfig
  private readonly logger = createChildLogger('salesforce-client')
  private connectionState: ConnectionState = 'disconnected'
  private lastConnectionAttempt: Date | null = null
  private lastConnectionError: Error | null = null
  private connectionInfo: ConnectionInfo | null = null
  private readonly connectionHandler: ISalesforceConnection

  constructor(config: SalesforceConfig, connectionHandler?: ISalesforceConnection) {
    this.config = { ...config }
    
    // Create connection handler if not provided (for dependency injection)
    this.connectionHandler = connectionHandler || new SalesforceConnection({
      instanceUrl: config.instanceUrl,
      apiVersion: config.apiVersion,
      maxRetries: config.maxRetries,
      timeout: config.timeout,
      oauth2: config.oauth2
    })
    
    this.logger.debug({
      instanceUrl: config.instanceUrl,
      apiVersion: config.apiVersion,
      clientId: config.clientId
    }, 'SalesforceClient initialized')
  }

  // Configuration access methods
  getConfig(): SalesforceConfig {
    return { ...this.config }
  }

  getApiVersion(): string {
    return this.config.apiVersion
  }

  getInstanceUrl(): string {
    return this.config.instanceUrl
  }

  getTimeout(): number {
    return this.config.timeout
  }

  getMaxRetries(): number {
    return this.config.maxRetries
  }

  getClientId(): string {
    return this.config.clientId
  }

  // Connection state methods
  isConnected(): boolean {
    return this.connectionState === 'connected'
  }

  getConnectionState(): ConnectionState {
    return this.connectionState
  }

  getLastConnectionAttempt(): Date | null {
    return this.lastConnectionAttempt
  }

  getLastConnectionError(): Error | null {
    return this.lastConnectionError
  }

  getConnection(): Connection | null {
    return this.connectionHandler.getConnection()
  }

  getConnectionInfo(): ConnectionInfo | null {
    return this.connectionInfo
  }

  // Connection methods using connection interface
  async connect(): Promise<ConnectionInfo> {
    this.logger.info('Connecting to Salesforce...')
    this.connectionState = 'connecting'
    this.lastConnectionAttempt = new Date()
    
    try {
      // Validate required OAuth2 credentials
      if (!this.config.clientId) {
        throw new ToolError('clientId is required for OAuth2 authentication', ErrorCode.INVALID_CONFIG, 'salesforce_client')
      }
      
      // Use connection handler for authentication
      this.connectionInfo = await this.connectionHandler.connect({
        clientId: this.config.clientId
      } as AuthenticationCredentials)
      
      this.connectionState = 'connected'
      this.lastConnectionError = null
      
      this.logger.info({
        instanceUrl: this.config.instanceUrl,
        apiVersion: this.config.apiVersion,
        organizationId: this.connectionInfo.organizationId
      }, 'Connected to Salesforce successfully')
      
      return this.connectionInfo
    } catch (error) {
      this.connectionState = 'error'
      this.lastConnectionError = error instanceof Error ? error : new Error(String(error))
      
      this.logger.error({
        error: this.lastConnectionError,
        instanceUrl: this.config.instanceUrl
      }, 'Failed to connect to Salesforce')
      
      throw this.lastConnectionError
    }
  }

  async disconnect(): Promise<void> {
    this.logger.info('Disconnecting from Salesforce...')
    
    try {
      await this.connectionHandler.disconnect()
    } catch (error) {
      this.logger.warn({ error }, 'Error during disconnect, connection cleared anyway')
    }
    
    this.connectionState = 'disconnected'
    this.connectionInfo = null
    this.lastConnectionError = null
    
    this.logger.info('Disconnected from Salesforce')
  }
}