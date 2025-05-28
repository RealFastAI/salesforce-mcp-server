/*
 * Copyright (C) 2025 Ontic Pte. Ltd. (realfast.ai)
 * Use of this software is governed by the Business Source License included in the LICENSE.TXT file and at www.mariadb.com/bsl11.
 */

import { createChildLogger } from '../logger.js'
import type { ServerCapabilities } from '../types.js'
import type { ApplicationConfiguration, SalesforceIntegrationConfig } from './schema-definitions.js'
import { ConfigurationAssembler } from './configuration-assembler.js'

export class ApplicationConfigurationManager {
  private static instance: ApplicationConfigurationManager | null = null
  private loadedConfiguration: ApplicationConfiguration | null = null
  private readonly logger = createChildLogger('config-manager')

  private constructor() {}

  static getInstance(): ApplicationConfigurationManager {
    ApplicationConfigurationManager.instance ??= new ApplicationConfigurationManager()
    return ApplicationConfigurationManager.instance
  }

  private ensureConfigurationLoaded(): ApplicationConfiguration {
    if (!this.loadedConfiguration) {
      this.logger.debug('Loading configuration from environment and defaults')
      this.loadedConfiguration = ConfigurationAssembler.assembleFromEnvironment()
      this.logger.info({
        serverName: this.loadedConfiguration.name,
        version: this.loadedConfiguration.version,
        salesforceApiVersion: this.loadedConfiguration.salesforce.apiVersion,
        logLevel: this.loadedConfiguration.logging.level
      }, 'Configuration loaded successfully')
    }
    return this.loadedConfiguration
  }

  getServerIdentity(): Readonly<{ name: string; version: string }> {
    const config = this.ensureConfigurationLoaded()
    return {
      name: config.name,
      version: config.version
    }
  }

  getServerCapabilities(): ServerCapabilities {
    const config = this.ensureConfigurationLoaded()
    
    const capabilities: ServerCapabilities = {
      resources: config.capabilities.resources,
      tools: config.capabilities.tools,
      ...(config.capabilities.prompts && { prompts: config.capabilities.prompts })
    }
    
    return capabilities
  }

  getSalesforceIntegrationConfig(): Readonly<SalesforceIntegrationConfig> {
    const config = this.ensureConfigurationLoaded()
    return { ...config.salesforce }
  }

  getObservabilityConfiguration(): Readonly<{ level: string; structured: boolean }> {
    const config = this.ensureConfigurationLoaded()
    return { ...config.logging }
  }

  getCachingStrategyConfiguration(): Readonly<{ enabled: boolean; ttlSeconds: number; maxEntries: number }> {
    const config = this.ensureConfigurationLoaded()
    return { ...config.cache }
  }

  getCompleteConfiguration(): Readonly<ApplicationConfiguration> {
    const config = this.ensureConfigurationLoaded()
    return { ...config }
  }

  resetConfigurationForTesting(): void {
    this.loadedConfiguration = null
  }
}