/*
 * Copyright (C) 2025 Ontic. Pte. Ltd. (realfast.ai)
 * Use of this software is governed by the Business Source License included in the LICENSE.TXT file and at www.mariadb.com/bsl11.
 */

import type { ITokenStorage, OAuth2Tokens } from './types.js'
import { TokenEncryption } from './encryption.js'

export class FileTokenStorage implements ITokenStorage {
  private readonly tokenPath: string

  constructor(tokenPath?: string) {
    this.tokenPath = tokenPath ?? process.env.SFDC_TOKEN_FILE ?? '.salesforce-tokens.enc'
  }

  async getTokens(): Promise<OAuth2Tokens | null> {
    try {
      const fs = await import('fs/promises')
      const encryptedData = await fs.readFile(this.tokenPath, 'utf8')
      const decryptedData = TokenEncryption.decrypt(encryptedData)
      return JSON.parse(decryptedData) as OAuth2Tokens
    } catch {
      // File doesn't exist, is corrupted, or decryption failed
      return null
    }
  }

  async saveTokens(tokens: OAuth2Tokens): Promise<void> {
    const fs = await import('fs/promises')
    const jsonData = JSON.stringify(tokens)
    const encryptedData = TokenEncryption.encrypt(jsonData)
    await fs.writeFile(this.tokenPath, encryptedData, 'utf8')
  }

  async clearTokens(): Promise<void> {
    try {
      const fs = await import('fs/promises')
      await fs.unlink(this.tokenPath)
    } catch {
      // Ignore if file doesn't exist
    }
  }
}