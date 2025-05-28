/*
 * Copyright (C) 2025 Ontic. Pte. Ltd. (realfast.ai)
 * Use of this software is governed by the Business Source License included in the LICENSE.TXT file and at www.mariadb.com/bsl11.
 */

export * from './schema-definitions.js'
export * from './environment-source.js'
export * from './configuration-assembler.js'
export * from './configuration-manager.js'

import { ApplicationConfigurationManager } from './configuration-manager.js'

// Convenience function for direct access to configuration manager
export function getApplicationConfiguration() {
  return ApplicationConfigurationManager.getInstance()
}