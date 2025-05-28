/*
 * Copyright (C) 2025 Ontic. Pte. Ltd. (realfast.ai)
 * Use of this software is governed by the Business Source License included in the LICENSE.TXT file and at www.mariadb.com/bsl11.
 */

import { Tool, type ToolDefinition, type ToolExecutionContext, type ToolResult } from '../base/index.js'
import { ToolError, ErrorCode } from '../../errors.js'

export class ListObjectsTool extends Tool {
  readonly definition: ToolDefinition = {
    name: 'list_objects',
    description: 'Lists all available Salesforce objects with filtering options',
    inputSchema: {
      type: 'object',
      properties: {
        objectType: {
          type: 'string',
          enum: ['all', 'standard', 'custom'],
          description: 'Filter objects by type: all, standard, or custom objects',
          default: 'all'
        },
        limit: {
          type: 'number',
          minimum: 1,
          maximum: 500,
          description: 'Maximum number of objects to return (default: 100)',
          default: 100
        }
      },
      required: []
    },
    annotations: {
      title: 'List Salesforce Objects',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  }

  async execute(params: any, context: ToolExecutionContext): Promise<ToolResult> {
    const { objectType = 'all', limit = 100 } = params
    
    this.logger.info({ objectType, limit }, 'Listing Salesforce objects')
    
    try {
      // Ensure client is connected
      if (!context.salesforceClient.isConnected()) {
        await context.salesforceClient.connect()
      }
      
      const connection = context.salesforceClient.getConnection()
      if (!connection) {
        throw new ToolError('No Salesforce connection available', ErrorCode.CONNECTION_FAILED, 'list_objects')
      }
      
      // Call Salesforce describeGlobal API
      const globalDescribe = await connection.describeGlobal()
      
      // Filter objects based on type
      let filteredObjects = globalDescribe.sobjects
      
      if (objectType === 'standard') {
        filteredObjects = filteredObjects.filter(obj => !obj.custom)
      } else if (objectType === 'custom') {
        filteredObjects = filteredObjects.filter(obj => obj.custom)
      }
      
      // Apply limit
      const limitedObjects = filteredObjects.slice(0, limit)
      
      // Format the result
      const result = {
        totalCount: filteredObjects.length,
        returnedCount: limitedObjects.length,
        objectType,
        objects: limitedObjects.map(obj => ({
          name: obj.name,
          label: obj.label,
          labelPlural: obj.labelPlural,
          keyPrefix: obj.keyPrefix,
          createable: obj.createable,
          updateable: obj.updateable,
          deletable: obj.deletable,
          queryable: obj.queryable,
          searchable: obj.searchable,
          custom: obj.custom,
          deprecatedAndHidden: obj.deprecatedAndHidden
        }))
      }
      
      this.logger.info({ 
        objectType,
        totalCount: result.totalCount,
        returnedCount: result.returnedCount
      }, 'Successfully listed Salesforce objects')
      
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(result, null, 2)
        }]
      }
    } catch (error) {
      this.logger.error({ 
        error, 
        objectType,
        limit
      }, 'Failed to list Salesforce objects')
      
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
      return {
        content: [{
          type: 'text',
          text: `Error listing objects: ${errorMessage}`
        }]
      }
    }
  }
}