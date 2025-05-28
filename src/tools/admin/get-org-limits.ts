/*
 * Copyright (C) 2025 Ontic Pte. Ltd. (realfast.ai)
 * Use of this software is governed by the Business Source License included in the LICENSE.TXT file and at www.mariadb.com/bsl11.
 */

import { Tool, type ToolDefinition, type ToolExecutionContext, type ToolResult } from '../base/index.js'
import { ToolError, ErrorCode, handleCaughtError, getErrorMessage } from '../../errors.js'

export class GetOrgLimitsTool extends Tool {
  readonly definition: ToolDefinition = {
    name: 'get_org_limits',
    description: 'Retrieve Salesforce organization limits and usage statistics including API calls, storage, and feature limits',
    inputSchema: {
      type: 'object',
      properties: {},
      required: []
    },
    annotations: {
      readOnlyHint: true,
      idempotentHint: true
    }
  }

  async execute(params: any, context: ToolExecutionContext): Promise<ToolResult> {
    const { salesforceClient } = context

    this.logger.info('Getting organization limits')

    const connection = salesforceClient.getConnection()
    if (!connection) {
      this.logger.error('No Salesforce connection available')
      throw new ToolError('No Salesforce connection available', ErrorCode.CONNECTION_FAILED, 'get_org_limits')
    }

    try {
      // Use Salesforce REST API to get organization limits
      const limits = await connection.request('/services/data/v59.0/limits/')
      
      this.logger.info({ 
        limitCount: limits && typeof limits === 'object' ? Object.keys(limits).length : 0
      }, 'Successfully retrieved organization limits')

      return {
        content: [{
          type: 'text',
          text: JSON.stringify(limits, null, 2)
        }]
      }
    } catch (error: unknown) {
      const typedError = handleCaughtError(error)
      this.logger.error({ 
        error: getErrorMessage(error) 
      }, 'Failed to get organization limits')
      
      throw new ToolError(
        `Failed to get organization limits: ${typedError.message}`,
        ErrorCode.INTERNAL_ERROR,
        'get_org_limits'
      )
    }
  }
}