/*
 * Copyright (C) 2025 Ontic. Pte. Ltd. (realfast.ai)
 * Use of this software is governed by the Business Source License included in the LICENSE.TXT file and at www.mariadb.com/bsl11.
 */

import { z } from 'zod'

export const OAuth2ConfigurationSchema = z.object({
  callbackPort: z.number().min(1024, 'OAUTH2_CALLBACK_PORT must be >= 1024').max(65535, 'OAUTH2_CALLBACK_PORT must be <= 65535').default(8080),
  callbackHost: z.string().default('localhost'),
  scopes: z.array(z.string()).default(['api', 'refresh_token'])
})

export const SalesforceIntegrationSchema = z.object({
  clientId: z.string().min(1, 'SFDC_CLIENT_ID is required').refine(val => val.trim().length > 0, 'SFDC_CLIENT_ID cannot be empty or whitespace'),
  instanceUrl: z.string().min(1, 'SFDC_INSTANCE_URL is required').url('SFDC_INSTANCE_URL must be a valid URL').refine(val => /^https?:\/\//i.test(val), 'SFDC_INSTANCE_URL must use HTTP or HTTPS protocol'),
  apiVersion: z.string().regex(/^v\d+\.\d+$/, 'SFDC_API_VERSION must be in format vXX.0').default('v59.0'),
  timeout: z.number().min(0, 'SFDC_TIMEOUT must be non-negative').default(30000),
  maxRetries: z.number().min(0, 'SFDC_MAX_RETRIES must be non-negative').default(3),
  oauth2: OAuth2ConfigurationSchema
})

export const ObservabilityConfigurationSchema = z.object({
  level: z.string().toLowerCase().pipe(z.enum(['debug', 'info', 'warn', 'error'])).default('info'),
  structured: z.boolean().default(true)
})

export const CachingStrategySchema = z.object({
  enabled: z.boolean().default(true),
  ttlSeconds: z.number().default(300),
  maxEntries: z.number().default(1000)
})

export const ServerCapabilitiesSchema = z.object({
  resources: z.object({
    subscribe: z.boolean().default(true),
    listChanged: z.boolean().default(true)
  }).default({ subscribe: true, listChanged: true }),
  tools: z.object({
    listChanged: z.boolean().default(true)
  }).default({ listChanged: true }),
  prompts: z.object({
    listChanged: z.boolean().default(true)
  }).optional()
})

export const ApplicationConfigurationSchema = z.object({
  name: z.string().default('salesforce-mcp-server'),
  version: z.string().default('0.1.0'),
  capabilities: ServerCapabilitiesSchema,
  salesforce: SalesforceIntegrationSchema,
  logging: ObservabilityConfigurationSchema,
  cache: CachingStrategySchema
})

export type ApplicationConfiguration = z.infer<typeof ApplicationConfigurationSchema>
export type SalesforceIntegrationConfig = z.infer<typeof SalesforceIntegrationSchema>
export type ObservabilityConfiguration = z.infer<typeof ObservabilityConfigurationSchema>
export type CachingStrategyConfig = z.infer<typeof CachingStrategySchema>