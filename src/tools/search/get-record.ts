/*
 * Copyright (C) 2025 Ontic. Pte. Ltd. (realfast.ai)
 * Use of this software is governed by the Business Source License included in the LICENSE.TXT file and at www.mariadb.com/bsl11.
 */

import { Tool, type ToolDefinition, type ToolExecutionContext, type ToolResult } from '../base/index.js'

export class GetRecordTool extends Tool {
  readonly definition: ToolDefinition = {
    name: 'get_record',
    description: 'Retrieve a specific record by ID with optional field selection and relationship traversal',
    inputSchema: {
      type: 'object',
      properties: {
        objectName: {
          type: 'string',
          description: 'The API name of the Salesforce object (e.g., Account, Contact, Custom__c)'
        },
        recordId: {
          type: 'string',
          description: 'The 15 or 18 character Salesforce ID of the record to retrieve'
        },
        fields: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional array of field names to retrieve. If not specified, all accessible fields are returned. Supports relationship fields (e.g., Account.Name)'
        }
      },
      required: ['objectName', 'recordId']
    },
    annotations: {
      title: 'Get Salesforce Record',
      readOnlyHint: true,
      idempotentHint: true
    }
  }

  async execute(params: any, context: ToolExecutionContext): Promise<ToolResult> {
    const { objectName, recordId, fields } = params

    // Validate Salesforce ID format first (security-first)
    if (!this.isValidSalesforceId(recordId)) {
      this.logger.warn({ recordId: this.sanitizeIdForLogging(recordId) }, 'Invalid Salesforce ID format provided')
      return {
        content: [{
          type: 'text',
          text: `Error: Invalid Salesforce ID format. Salesforce IDs must be 15 or 18 characters long and contain only alphanumeric characters.`
        }]
      }
    }

    // Check connection after validation (consistent with other tools)
    const connection = context.salesforceClient.getConnection()
    if (!context.salesforceClient.isConnected() || !connection) {
      this.logger.error({ objectName, recordId: this.sanitizeIdForLogging(recordId) }, 'No Salesforce connection available')
      return {
        content: [{
          type: 'text',
          text: 'Error: No Salesforce connection available. Please authenticate first.'
        }]
      }
    }

    try {
      this.logger.info({ 
        objectName, 
        recordId: this.sanitizeIdForLogging(recordId), 
        fieldCount: fields?.length 
      }, 'Retrieving Salesforce record')

      // Use jsforce's retrieve method with optional field selection
      const record = await connection.sobject(objectName).retrieve(recordId, fields)

      this.logger.debug({ 
        objectName, 
        recordId: this.sanitizeIdForLogging(recordId),
        hasData: !!record 
      }, 'Record retrieved successfully')

      return {
        content: [{
          type: 'text',
          text: this.formatRecordOutput(record, objectName, recordId)
        }]
      }

    } catch (error) {
      this.logger.error({ 
        error, 
        objectName, 
        recordId: this.sanitizeIdForLogging(recordId),
        fields 
      }, 'Failed to retrieve Salesforce record')

      return {
        content: [{
          type: 'text',
          text: `Error retrieving record: ${error instanceof Error ? error.message : 'Unknown error occurred'}`
        }]
      }
    }
  }

  private isValidSalesforceId(id: string): boolean {
    // Salesforce IDs are 15 or 18 characters, case-sensitive alphanumeric
    return /^[a-zA-Z0-9]{15}$|^[a-zA-Z0-9]{18}$/.test(id)
  }

  private sanitizeIdForLogging(id: string): string {
    // Show first 3 and last 3 characters for debugging while maintaining privacy
    if (id.length >= 6) {
      return `${id.substring(0, 3)}...${id.substring(id.length - 3)}`
    }
    return '[ID_REDACTED]'
  }

  private formatRecordOutput(record: any, objectName: string, recordId: string): string {
    if (!record) {
      return `Record ${recordId} not found in ${objectName}.`
    }

    // Remove Salesforce metadata attributes for cleaner output
    const cleanRecord = { ...record }
    delete cleanRecord.attributes

    let output = `Record retrieved successfully from ${objectName}:\n\n`
    output += `Record ID: ${recordId}\n`
    output += `Object Type: ${objectName}\n\n`
    output += `Field Values:\n`
    
    // Format fields with proper indentation and handle nested objects (relationships)
    Object.entries(cleanRecord).forEach(([key, value]) => {
      if (value !== null && value !== undefined) {
        if (typeof value === 'object' && value !== null && 'attributes' in value) {
          // This is a relationship object
          const relatedType = (value as any).attributes?.type
          const relatedFields = { ...value }
          delete (relatedFields as any).attributes
          
          output += `  ${key} (${relatedType}):\n`
          Object.entries(relatedFields).forEach(([relKey, relValue]) => {
            output += `    ${relKey}: ${this.formatFieldValue(relValue)}\n`
          })
        } else {
          output += `  ${key}: ${this.formatFieldValue(value)}\n`
        }
      }
    })

    return output
  }

  private formatFieldValue(value: any): string {
    if (value === null || value === undefined) {
      return '[null]'
    }
    if (typeof value === 'string' && value.includes('T') && value.includes('Z')) {
      // Likely a datetime field, format it nicely
      try {
        return new Date(value).toLocaleString()
      } catch {
        return value
      }
    }
    return String(value)
  }
}