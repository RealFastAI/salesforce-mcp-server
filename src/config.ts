/*
 * Copyright (C) 2025 Ontic. Pte. Ltd. (realfast.ai)
 * Use of this software is governed by the Business Source License included in the LICENSE.TXT file and at www.mariadb.com/bsl11.
 */

export type {
  ApplicationConfiguration as ServerConfig,
  SalesforceIntegrationConfig as SalesforceConfig
} from './configuration/index.js'

import { ApplicationConfigurationManager, ConfigurationAssembler } from './configuration/index.js'

// Legacy ConfigManager wrapper for backward compatibility
export class ConfigManager {
  private static instance: ConfigManager | null = null
  private manager: ApplicationConfigurationManager

  private constructor() {
    this.manager = ApplicationConfigurationManager.getInstance()
  }

  static getInstance(): ConfigManager {
    if (!ConfigManager.instance) {
      ConfigManager.instance = new ConfigManager()
    }
    return ConfigManager.instance
  }

  getServerInfo() {
    return this.manager.getServerIdentity()
  }

  getCapabilities() {
    return this.manager.getServerCapabilities()
  }

  getSalesforceConfig() {
    return this.manager.getSalesforceIntegrationConfig()
  }

  getLoggingConfig() {
    return this.manager.getObservabilityConfiguration()
  }

  getCacheConfig() {
    return this.manager.getCachingStrategyConfiguration()
  }

  getFullConfig() {
    return this.manager.getCompleteConfiguration()
  }

  reset() {
    this.manager.resetConfigurationForTesting()
  }
}

export function getConfig(): ConfigManager {
  return ConfigManager.getInstance()
}

export const loadConfiguration = () => {
  return ConfigurationAssembler.assembleFromEnvironment()
}