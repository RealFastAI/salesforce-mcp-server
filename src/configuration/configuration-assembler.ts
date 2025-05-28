/*
 * Copyright (C) 2025 Ontic Pte. Ltd. (realfast.ai)
 * Use of this software is governed by the Business Source License included in the LICENSE.TXT file and at www.mariadb.com/bsl11.
 */

import { z } from 'zod'
import { createChildLogger } from '../logger.js'
import { ConfigError, ErrorCode } from '../errors.js'
import { ApplicationConfigurationSchema, type ApplicationConfiguration } from './schema-definitions.js'
import { EnvironmentConfigurationSource } from './environment-source.js'

export class ConfigurationAssembler {
  private static readonly logger = createChildLogger('config-assembler')

  static assembleFromEnvironment(): ApplicationConfiguration {
    this.logger.debug('Starting configuration assembly from environment sources')
    
    const rawConfigurationData = {
      ...EnvironmentConfigurationSource.extractServerIdentity(),
      capabilities: EnvironmentConfigurationSource.extractServerCapabilities(),
      salesforce: EnvironmentConfigurationSource.extractSalesforceIntegration(),
      logging: EnvironmentConfigurationSource.extractObservabilitySettings(),
      cache: EnvironmentConfigurationSource.extractCachingStrategy()
    }

    this.logger.debug({
      hasServerName: !!rawConfigurationData.name,
      hasSalesforceConfig: !!rawConfigurationData.salesforce.instanceUrl,
      logLevel: rawConfigurationData.logging.level
    }, 'Raw configuration data extracted from environment')

    return this.validateAndTransform(rawConfigurationData)
  }

  private static validateAndTransform(rawData: unknown): ApplicationConfiguration {
    try {
      const validatedConfiguration = ApplicationConfigurationSchema.parse(rawData)
      this.logger.debug('Configuration validation and transformation successful')
      return validatedConfiguration
    } catch (error) {
      if (error instanceof z.ZodError) {
        const validationFailure = error.errors[0]
        if (validationFailure) {
          const fieldPath = validationFailure.path.join('.')
          const validationMessage = validationFailure.message
          
          this.logger.error({
            field: fieldPath,
            validationError: validationMessage,
            errorCode: validationFailure.code
          }, 'Configuration validation failed')
          
          throw new ConfigError(
            `Configuration validation failed: ${fieldPath}: ${validationMessage}`,
            ErrorCode.INVALID_CONFIG,
            {
              field: fieldPath,
              validationError: validationMessage,
              code: validationFailure.code,
              path: validationFailure.path
            }
          )
        }
      }
      
      this.logger.error({
        err: error
      }, 'Unexpected error during configuration validation')
      throw error
    }
  }
}