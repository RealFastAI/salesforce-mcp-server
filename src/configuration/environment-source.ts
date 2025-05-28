/*
 * Copyright (C) 2025 Ontic Pte. Ltd. (realfast.ai)
 * Use of this software is governed by the Business Source License included in the LICENSE.TXT file and at www.mariadb.com/bsl11.
 */

import dotenv from 'dotenv'

// Load .env file at module initialization
// Configuration precedence: environment variables > .env file > schema defaults
dotenv.config()

type EnvironmentValueParser<T> = (value: string | undefined) => T | undefined

const parseStringValue: EnvironmentValueParser<string> = (value) => value ?? undefined

const parseSimpleBooleanValue: EnvironmentValueParser<boolean> = (value) => {
  return value ? value.toLowerCase() === 'true' : undefined
}

const parseStrictBooleanValue: EnvironmentValueParser<boolean> = (value) => {
  if (!value) return undefined
  const normalized = value.toLowerCase()
  return normalized === 'true' ? true : normalized === 'false' ? false : undefined
}

const parseNumericValue: EnvironmentValueParser<number> = (value) => {
  if (!value) return undefined
  const trimmed = value.trim()
  const parsed = parseInt(trimmed)
  return !isNaN(parsed) && parsed >= 0 ? parsed : undefined
}

export class EnvironmentConfigurationSource {
  private static getEnvironmentVariable(key: string): string | undefined {
    return process.env[key]
  }

  static extractServerIdentity() {
    return {
      name: parseStringValue(this.getEnvironmentVariable('SERVER_NAME')),
      version: parseStringValue(this.getEnvironmentVariable('SERVER_VERSION'))
    }
  }

  static extractServerCapabilities() {
    return {
      resources: parseStrictBooleanValue(this.getEnvironmentVariable('CAPABILITIES_RESOURCES')),
      tools: parseStrictBooleanValue(this.getEnvironmentVariable('CAPABILITIES_TOOLS')),
      prompts: parseStrictBooleanValue(this.getEnvironmentVariable('CAPABILITIES_PROMPTS'))
    }
  }

  static extractSalesforceIntegration() {
    return {
      clientId: parseStringValue(this.getEnvironmentVariable('SFDC_CLIENT_ID')),
      instanceUrl: parseStringValue(this.getEnvironmentVariable('SFDC_INSTANCE_URL')),
      apiVersion: parseStringValue(this.getEnvironmentVariable('SFDC_API_VERSION')),
      timeout: parseNumericValue(this.getEnvironmentVariable('SFDC_TIMEOUT')),
      maxRetries: parseNumericValue(this.getEnvironmentVariable('SFDC_MAX_RETRIES')),
      oauth2: {
        callbackPort: parseNumericValue(this.getEnvironmentVariable('OAUTH2_CALLBACK_PORT')),
        callbackHost: parseStringValue(this.getEnvironmentVariable('OAUTH2_CALLBACK_HOST'))
        // scopes will use default from schema
      }
    }
  }

  static extractObservabilitySettings() {
    return {
      level: parseStringValue(this.getEnvironmentVariable('LOG_LEVEL')),
      structured: parseSimpleBooleanValue(this.getEnvironmentVariable('LOG_STRUCTURED'))
    }
  }

  static extractCachingStrategy() {
    return {
      enabled: parseStrictBooleanValue(this.getEnvironmentVariable('CACHE_ENABLED')),
      ttlSeconds: parseNumericValue(this.getEnvironmentVariable('CACHE_TTL_SECONDS')),
      maxEntries: parseNumericValue(this.getEnvironmentVariable('CACHE_MAX_ENTRIES'))
    }
  }
}