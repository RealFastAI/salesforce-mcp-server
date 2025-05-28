/*
 * Copyright (C) 2025 Ontic. Pte. Ltd. (realfast.ai)
 * Use of this software is governed by the Business Source License included in the LICENSE.TXT file and at www.mariadb.com/bsl11.
 */

import { Connection } from 'jsforce'
import { createServer } from 'http'
import { parse } from 'url'
import { createHash, randomBytes } from 'crypto'
import { createChildLogger } from '../logger.js'
import { ToolError, ErrorCode } from '../errors.js'
import type { ConnectionConfig, OAuth2Tokens, OAuth2Config } from './types.js'

export class OAuth2Handler {
  private readonly config: ConnectionConfig
  private readonly logger = createChildLogger('oauth2-handler')

  constructor(config: ConnectionConfig) {
    this.config = config
  }

  async authenticateWithBrowser(clientId: string): Promise<OAuth2Tokens> {
    const { codeVerifier, codeChallenge } = this.generatePKCE()
    const redirectUri = `http://${this.config.oauth2.callbackHost}:${this.config.oauth2.callbackPort}/callback`
    const state = randomBytes(16).toString('hex')
    
    const authUrl = this.buildAuthorizationUrl({
      clientId,
      redirectUri,
      scopes: this.config.oauth2.scopes,
      codeChallenge,
      state
    })

    this.logger.info({ authUrl }, '🔐 Opening browser for Salesforce authentication')
    this.logger.info('If browser doesn\'t open automatically, please visit the URL shown above')
    this.logger.info('Waiting for authentication...')

    try {
      // Open browser (non-blocking, may fail silently)
      await this.openBrowser(authUrl)
    } catch (error) {
      this.logger.warn({ error }, 'Failed to open browser automatically')
    }

    let authCode: string
    try {
      // Start local server and wait for callback
      authCode = await this.startCallbackServer(redirectUri, state)
    } catch (error) {
      this.logger.error({ error, redirectUri }, 'OAuth2 callback server failed')
      throw new ToolError(`Authentication failed: ${error instanceof Error ? error.message : 'Unknown error'}`, ErrorCode.AUTHENTICATION_FAILED, 'oauth2_flow')
    }

    try {
      // Exchange code for tokens
      return await this.exchangeCodeForTokens({
        clientId,
        redirectUri,
        authCode,
        codeVerifier
      })
    } catch (error) {
      this.logger.error({ error, clientId }, 'Failed to exchange authorization code for tokens')
      throw new ToolError(`Token exchange failed: ${error instanceof Error ? error.message : 'Unknown error'}`, ErrorCode.AUTHENTICATION_FAILED, 'oauth2_flow')
    }
  }

  async refreshAccessToken(tokens: OAuth2Tokens): Promise<OAuth2Tokens> {
    const refreshConnection = new Connection({
      instanceUrl: tokens.instanceUrl,
      version: this.config.apiVersion.replace('v', ''),
      maxRequest: this.config.maxRetries
    })

    const result = await refreshConnection.oauth2.refreshToken(tokens.refreshToken!)

    return {
      accessToken: result.access_token,
      refreshToken: tokens.refreshToken,
      instanceUrl: tokens.instanceUrl,
      expiresAt: Date.now() + 3600000 // Default 1 hour
    }
  }

  private generatePKCE(): { codeVerifier: string; codeChallenge: string } {
    const codeVerifier = randomBytes(32).toString('base64url')
    const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url')
    return { codeVerifier, codeChallenge }
  }

  private buildAuthorizationUrl(config: OAuth2Config & { codeChallenge: string; state: string }): string {
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      scope: config.scopes.join(' '),
      state: config.state,
      code_challenge: config.codeChallenge,
      code_challenge_method: 'S256'
    })

    return `${this.config.instanceUrl}/services/oauth2/authorize?${params.toString()}`
  }

  private async openBrowser(url: string): Promise<void> {
    const { exec } = await import('child_process')
    
    return new Promise((resolve) => {
      // Determine the command based on platform
      let command: string
      switch (process.platform) {
        case 'darwin':
          command = 'open'
          break
        case 'win32':
          command = 'start ""'
          break
        case 'linux':
          command = 'xdg-open'
          break
        default:
          this.logger.warn({ platform: process.platform }, 'Unsupported platform for auto-opening browser')
          resolve() // Don't reject, just resolve without opening
          return
      }
      
      // Execute the command with timeout
      exec(`${command} "${url}"`, { timeout: 5000 }, (error: Error | null) => {
        if (error) {
          this.logger.warn({ error: error.message, platform: process.platform }, 'Failed to open browser automatically')
          resolve() // Don't reject, browser opening is optional
        } else {
          this.logger.debug('Browser opened successfully')
          resolve()
        }
      })
    })
  }

  private async startCallbackServer(redirectUri: string, expectedState: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const timeoutMs = 300000 // 5 minute timeout
      let isResolved = false
      
      const server = createServer((req, res) => {
        try {
          const parsedUrl = parse(req.url!, true)
          
          if (parsedUrl.pathname === '/callback') {
            const { code, state, error } = parsedUrl.query

            if (error) {
              this.logger.error({ error, state }, 'OAuth2 callback received error')
              res.writeHead(400, { 'Content-Type': 'text/html' })
              res.end(`<h1>Authentication Failed</h1><p>Error: ${Array.isArray(error) ? error.join(', ') : error}</p>`)
              cleanup()
              if (!isResolved) {
                isResolved = true
                reject(new Error(`OAuth error: ${Array.isArray(error) ? error.join(', ') : error}`))
              }
              return
            }

            if (state !== expectedState) {
              this.logger.error({ receivedState: state, expectedState }, 'OAuth2 state parameter mismatch')
              res.writeHead(400, { 'Content-Type': 'text/html' })
              res.end('<h1>Authentication Failed</h1><p>Invalid state parameter</p>')
              cleanup()
              if (!isResolved) {
                isResolved = true
                reject(new Error('Invalid state parameter - possible CSRF attack'))
              }
              return
            }

            if (!code) {
              this.logger.error('OAuth2 callback missing authorization code')
              res.writeHead(400, { 'Content-Type': 'text/html' })
              res.end('<h1>Authentication Failed</h1><p>No authorization code received</p>')
              cleanup()
              if (!isResolved) {
                isResolved = true
                reject(new Error('No authorization code received'))
              }
              return
            }

            this.logger.info('OAuth2 callback received successfully')
            res.writeHead(200, { 'Content-Type': 'text/html' })
            res.end('<h1>✅ Authentication Successful!</h1><p>You can close this window and return to your terminal.</p>')
            cleanup()
            if (!isResolved) {
              isResolved = true
              resolve(code as string)
            }
          } else {
            res.writeHead(404, { 'Content-Type': 'text/html' })
            res.end('<h1>Not Found</h1>')
          }
        } catch (error) {
          this.logger.error({ error }, 'Error processing OAuth2 callback')
          res.writeHead(500, { 'Content-Type': 'text/html' })
          res.end('<h1>Internal Server Error</h1>')
          cleanup()
          if (!isResolved) {
            isResolved = true
            reject(new Error(`Callback processing failed: ${error instanceof Error ? error.message : 'Unknown error'}`))
          }
        }
      })

      const cleanup = () => {
        try {
          server.close()
        } catch (error) {
          this.logger.warn({ error }, 'Error closing callback server')
        }
        if (timeout) {
          clearTimeout(timeout)
        }
      }

      // Set up timeout
      const timeout = setTimeout(() => {
        this.logger.error({ timeoutMs }, 'OAuth2 callback server timeout')
        cleanup()
        if (!isResolved) {
          isResolved = true
          reject(new Error(`Authentication timeout after ${timeoutMs / 1000} seconds`))
        }
      }, timeoutMs)

      // Extract port from redirectUri
      const redirectUrl = new URL(redirectUri)
      const port = parseInt(redirectUrl.port) || 8080
      const host = redirectUrl.hostname || 'localhost'

      server.listen(port, host, () => {
        this.logger.info({ host, port }, 'OAuth2 callback server started')
      })

      server.on('error', (error) => {
        this.logger.error({ error, host, port }, 'Failed to start OAuth2 callback server')
        cleanup()
        if (!isResolved) {
          isResolved = true
          reject(new Error(`Failed to start callback server on ${host}:${port}: ${error.message}`))
        }
      })
    })
  }

  private async exchangeCodeForTokens(params: {
    clientId: string
    redirectUri: string
    authCode: string
    codeVerifier: string
  }): Promise<OAuth2Tokens> {
    // Use direct fetch for OAuth2 token exchange with PKCE
    const tokenUrl = `${this.config.instanceUrl}/services/oauth2/token`
    const tokenParams = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: params.clientId,
      redirect_uri: params.redirectUri,
      code: params.authCode,
      code_verifier: params.codeVerifier
    })

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json'
      },
      body: tokenParams.toString()
    })

    if (!response.ok) {
      const error = await response.text()
      throw new ToolError(`Token exchange failed: ${error}`, ErrorCode.AUTHENTICATION_FAILED, 'oauth2_flow')
    }

    const result = await response.json() as {
      access_token: string
      refresh_token?: string
      instance_url?: string
      expires_in?: number
    }

    return {
      accessToken: result.access_token,
      refreshToken: result.refresh_token,
      instanceUrl: result.instance_url ?? this.config.instanceUrl,
      expiresAt: Date.now() + (result.expires_in ? result.expires_in * 1000 : 3600000)
    }
  }
}