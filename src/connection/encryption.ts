/*
 * Copyright (C) 2025 Ontic. Pte. Ltd. (realfast.ai)
 * Use of this software is governed by the Business Source License included in the LICENSE.TXT file and at www.mariadb.com/bsl11.
 */

import { createHash, randomBytes, createCipheriv, createDecipheriv } from 'crypto'

export class TokenEncryption {
  private static readonly ALGORITHM = 'aes-256-gcm'
  private static readonly KEY_LENGTH = 32
  private static readonly IV_LENGTH = 16
  private static readonly TAG_LENGTH = 16

  private static getEncryptionKey(): Buffer {
    // In production, this should be derived from a secure key management system
    // For now, we'll use a key derived from the system
    const keyMaterial = process.env.TOKEN_ENCRYPTION_KEY ?? 'salesforce-mcp-default-key'
    return createHash('sha256').update(keyMaterial).digest()
  }

  static encrypt(data: string): string {
    const key = this.getEncryptionKey()
    const iv = randomBytes(this.IV_LENGTH)
    const cipher = createCipheriv(this.ALGORITHM, key, iv)
    
    let encrypted = cipher.update(data, 'utf8', 'hex')
    encrypted += cipher.final('hex')
    const tag = cipher.getAuthTag()
    
    // Combine iv + tag + encrypted data
    return iv.toString('hex') + tag.toString('hex') + encrypted
  }

  static decrypt(encryptedData: string): string {
    const key = this.getEncryptionKey()
    
    // Extract iv, tag, and encrypted data
    const iv = Buffer.from(encryptedData.slice(0, this.IV_LENGTH * 2), 'hex')
    const tag = Buffer.from(encryptedData.slice(this.IV_LENGTH * 2, (this.IV_LENGTH + this.TAG_LENGTH) * 2), 'hex')
    const encrypted = encryptedData.slice((this.IV_LENGTH + this.TAG_LENGTH) * 2)
    
    const decipher = createDecipheriv(this.ALGORITHM, key, iv)
    decipher.setAuthTag(tag)
    
    let decrypted = decipher.update(encrypted, 'hex', 'utf8')
    decrypted += decipher.final('utf8')
    
    return decrypted
  }
}