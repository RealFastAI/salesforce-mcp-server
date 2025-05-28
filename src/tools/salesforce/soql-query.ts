/*
 * Copyright (C) 2025 Ontic. Pte. Ltd. (realfast.ai)
 * Use of this software is governed by the Business Source License included in the LICENSE.TXT file and at www.mariadb.com/bsl11.
 */

import { Tool, type ToolDefinition, type ToolExecutionContext, type ToolResult } from '../base/index.js'
import { ToolError, ErrorCode } from '../../errors.js'

export class SoqlQueryTool extends Tool {
  readonly definition: ToolDefinition = {
    name: 'soql_query',
    description: 'Execute a SOQL query against Salesforce with injection prevention and pagination support',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The SOQL query to execute (e.g., "SELECT Id, Name FROM Account LIMIT 10")'
        },
        limit: {
          type: 'number',
          minimum: 1,
          maximum: 2000,
          description: 'Maximum number of records to return (default: 200, max: 2000)',
          default: 200
        }
      },
      required: ['query']
    },
    annotations: {
      title: 'Execute SOQL Query',
      readOnlyHint: true,
      idempotentHint: true
    }
  }

  async execute(params: { query: string; limit?: number }, context: ToolExecutionContext): Promise<ToolResult> {
    const { query, limit = 200 } = params
    
    // Validate and sanitize the SOQL query FIRST (security)
    this.validateSoqlQuery(query)
    
    // Ensure client is connected
    if (!context.salesforceClient.isConnected()) {
      await context.salesforceClient.connect()
    }
    
    const connection = context.salesforceClient.getConnection()
    if (!connection) {
      throw new ToolError('No Salesforce connection available', ErrorCode.CONNECTION_FAILED, 'soql_query')
    }

    try {
      
      // Log the query execution
      this.logger.info({ 
        query: this.sanitizeQueryForLogging(query),
        limit 
      }, 'Executing SOQL query')

      // Execute the query with pagination
      let queryResult = await connection.query(query)
      
      // Apply client-side limit if needed
      if (queryResult.records.length > limit) {
        queryResult.records = queryResult.records.slice(0, limit)
      }
      
      // Format the result
      const result = {
        totalSize: queryResult.totalSize,
        done: queryResult.done,
        recordCount: queryResult.records.length,
        records: queryResult.records.map((record: any) => {
          // Remove Salesforce metadata attributes for cleaner output
          const { attributes, ...cleanRecord } = record
          return cleanRecord
        }),
        hasMore: !queryResult.done,
        nextRecordsUrl: queryResult.nextRecordsUrl || null
      }
      
      // Create human-readable summary
      let summary = `Query executed successfully.\n\n`
      
      if (result.recordCount === 0) {
        summary += `No records found matching the query criteria.\n`
        summary += `Total records: ${result.totalSize}`
      } else {
        summary += `Showing ${result.recordCount} record${result.recordCount === 1 ? '' : 's'}`
        
        if (result.recordCount < result.totalSize) {
          summary += ` (first ${result.recordCount} of ${result.totalSize} total records available)`
        }
        
        if (result.hasMore) {
          summary += `\nMore records available - use pagination to retrieve additional results.`
        }
        
        summary += `\n\nResults:\n${JSON.stringify(result.records, null, 2)}`
        summary += `\n\nQuery Summary:\n- Total records: ${result.totalSize}\n- Records returned: ${result.recordCount}\n- Query complete: ${result.done ? 'Yes' : 'No'}`
      }
      
      this.logger.info({ 
        totalSize: result.totalSize,
        recordCount: result.recordCount,
        hasMore: result.hasMore
      }, 'SOQL query executed successfully')
      
      return {
        content: [{
          type: 'text',
          text: summary
        }]
      }
    } catch (error) {
      this.logger.error({ 
        error, 
        query: this.sanitizeQueryForLogging(query)
      }, 'Failed to execute SOQL query')
      
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
      throw new ToolError(`SOQL query execution failed: ${errorMessage}`, ErrorCode.INTERNAL_ERROR, 'soql_query')
    }
  }

  private validateSoqlQuery(query: string): void {
    const trimmedQuery = query.trim().toUpperCase()
    
    // Basic SOQL syntax validation
    if (!trimmedQuery.startsWith('SELECT')) {
      throw new ToolError('Invalid SOQL query syntax: Query must start with SELECT', ErrorCode.INVALID_PARAMS, 'soql_query')
    }
    
    if (!trimmedQuery.includes('FROM')) {
      throw new ToolError('Invalid SOQL query syntax: Query must include FROM clause', ErrorCode.INVALID_PARAMS, 'soql_query')
    }
    
    // Injection prevention - check for potentially dangerous patterns
    const dangerousPatterns = [
      /;\s*(DROP|DELETE|INSERT|UPDATE|CREATE|ALTER|TRUNCATE)/i,  // SQL injection attempts
      /--/,  // SQL comments
      /\/\*/,  // Block comments
      /\bEXEC\b/i,  // Execution commands
      /\bSCRIPT\b/i,  // Script execution
      /\bSELECT.*INTO\s+OUTFILE/i,  // File operations
    ]
    
    for (const pattern of dangerousPatterns) {
      if (pattern.test(query)) {
        throw new ToolError('SOQL query contains potentially unsafe content', ErrorCode.INVALID_PARAMS, 'soql_query')
      }
    }
    
    // Additional SOQL-specific validations could be added here
    // For now, we rely on Salesforce's own query validation
  }

  private sanitizeQueryForLogging(query: string): string {
    // Remove sensitive data patterns for logging
    return query
      .replace(/(['"])[^'"]*\1/g, '$1[REDACTED]$1')  // String literals
      .replace(/\b\d{15,18}\b/g, '[ID_REDACTED]')     // Salesforce IDs
  }
}