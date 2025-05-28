/*
 * Copyright (C) 2025 Ontic. Pte. Ltd. (realfast.ai)
 * Use of this software is governed by the Business Source License included in the LICENSE.TXT file and at www.mariadb.com/bsl11.
 */

// Centralized tool registry - all tools available through modular architecture
export * from './base/index.js'
export * from './salesforce/index.js'
export * from './search/index.js'
export * from './layout/index.js'
export * from './admin/index.js'
export * from './analysis/index.js'

// Tool registry for easy access
export {
  // Salesforce core operations
  DescribeObjectTool,
  ListObjectsTool,
  SoqlQueryTool
} from './salesforce/index.js'

export {
  // Search and data access
  GetRecordTool,
  SoslSearchTool
} from './search/index.js'

export {
  // Layout and UI information
  DescribeLayoutTool
} from './layout/index.js'

export {
  // Administrative operations
  GetRecentItemsTool,
  GetOrgLimitsTool,
  GetUserInfoTool
} from './admin/index.js'

export {
  // Analysis and validation
  GetPicklistValuesTool,
  ValidateSoqlTool,
  ExplainQueryPlanTool
} from './analysis/index.js'