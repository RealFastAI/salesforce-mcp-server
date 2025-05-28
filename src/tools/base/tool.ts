/*
 * Copyright (C) 2025 Ontic. Pte. Ltd. (realfast.ai)
 * Use of this software is governed by the Business Source License included in the LICENSE.TXT file and at www.mariadb.com/bsl11.
 */

import { z } from 'zod'
import { SalesforceClient } from '../../salesforce-client.js'
import { createChildLogger } from '../../logger.js'
import { ToolError, ErrorCode } from '../../errors.js'

export interface ToolDefinition {
  name: string
  description: string
  inputSchema: {
    type: 'object'
    properties: Record<string, any>
    required?: string[]
  }
  annotations?: {
    title?: string
    readOnlyHint?: boolean
    destructiveHint?: boolean
    idempotentHint?: boolean
    openWorldHint?: boolean
  }
}

export interface ToolExecutionContext {
  salesforceClient: SalesforceClient
}

export interface ToolResult {
  content: Array<{
    type: 'text'
    text: string
  }>
}

export abstract class Tool {
  abstract readonly definition: ToolDefinition
  protected readonly logger = createChildLogger('tool')

  abstract execute(params: any, context: ToolExecutionContext): Promise<ToolResult>
}