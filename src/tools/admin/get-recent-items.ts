/*
 * Copyright (C) 2025 Ontic. Pte. Ltd. (realfast.ai)
 * Use of this software is governed by the Business Source License included in the LICENSE.TXT file and at www.mariadb.com/bsl11.
 */

import { Tool, type ToolDefinition, type ToolExecutionContext, type ToolResult } from '../base/index.js'
import { ToolError, ErrorCode, handleCaughtError, getErrorMessage } from '../../errors.js'

export class GetRecentItemsTool extends Tool {
  readonly definition: ToolDefinition = {
    name: 'get_recent_items',
    description: 'Retrieve recently accessed items for the current user including records from various Salesforce objects',
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

    this.logger.info('Getting recent items for current user')

    const connection = salesforceClient.getConnection()
    if (!connection) {
      this.logger.error('No Salesforce connection available')
      throw new ToolError('No Salesforce connection available', ErrorCode.CONNECTION_FAILED, 'get_recent_items')
    }

    try {
      // Use Salesforce REST API to get recent items
      const recentItems = await connection.request('/services/data/v59.0/recent') as any[]
      
      this.logger.info({ 
        itemCount: recentItems ? recentItems.length : 0
      }, 'Successfully retrieved recent items')

      return {
        content: [{
          type: 'text',
          text: this.formatRecentItemsOutput(recentItems || [])
        }]
      }
    } catch (error: unknown) {
      const typedError = handleCaughtError(error)
      this.logger.error({ 
        error: getErrorMessage(error) 
      }, 'Failed to get recent items')
      
      throw new ToolError(
        `Failed to get recent items: ${typedError.message}`,
        ErrorCode.INTERNAL_ERROR,
        'get_recent_items'
      )
    }
  }

  private formatRecentItemsOutput(recentItems: any[]): string {
    if (!recentItems || recentItems.length === 0) {
      return 'No recent items found for the current user.'
    }

    let output = `Recently Accessed Items:\n\n`
    output += `Total items: ${recentItems.length}\n\n`

    recentItems.forEach((item, index) => {
      const objectType = item.attributes?.type || 'Unknown'
      const recordId = item.Id || '[No ID]'
      const sanitizedId = this.sanitizeIdForLogging(recordId)
      
      // Try to get display name from various possible fields
      const displayName = this.getDisplayName(item, objectType)
      
      output += `${index + 1}. ${objectType}: ${displayName}\n`
      output += `   ID: ${sanitizedId}\n`
      
      if (item.attributes?.url) {
        // Sanitize URLs by replacing full IDs with sanitized versions
        const sanitizedUrl = this.sanitizeUrlIds(item.attributes.url)
        output += `   URL: ${sanitizedUrl}\n`
      }
      
      output += '\n'
    })

    return output
  }

  private getDisplayName(item: any, objectType: string): string {
    // Try common name fields in order of preference
    const nameFields = ['Name', 'Subject', 'Title', 'CaseNumber', 'OpportunityName', 'Title__c']
    
    for (const field of nameFields) {
      if (item[field] && typeof item[field] === 'string') {
        return item[field]
      }
    }
    
    // Fallback to any field that looks like a title/name
    for (const [key, value] of Object.entries(item)) {
      if (typeof value === 'string' && 
          (key.toLowerCase().includes('name') || 
           key.toLowerCase().includes('title') || 
           key.toLowerCase().includes('subject')) &&
          !key.includes('Id') && 
          !key.includes('__c')) {
        return value
      }
    }
    
    return '[No name available]'
  }

  private sanitizeIdForLogging(id: string): string {
    // Show first 3 and last 3 characters for debugging while maintaining privacy
    if (id && id.length >= 6) {
      return `${id.substring(0, 3)}...${id.substring(id.length - 3)}`
    }
    return '[ID_REDACTED]'
  }

  private sanitizeUrlIds(url: string): string {
    // Replace Salesforce IDs in URLs with sanitized versions
    return url.replace(/\/([a-zA-Z0-9]{15,18})\b/g, (match, id) => {
      return `/${this.sanitizeIdForLogging(id)}`
    })
  }
}