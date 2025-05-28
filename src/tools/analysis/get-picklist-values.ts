/*
 * Copyright (C) 2025 Ontic Pte. Ltd. (realfast.ai)
 * Use of this software is governed by the Business Source License included in the LICENSE.TXT file and at www.mariadb.com/bsl11.
 */

import { Tool, type ToolDefinition, type ToolExecutionContext, type ToolResult } from '../base/index.js'
import { ToolError, ErrorCode, handleCaughtError, getErrorMessage } from '../../errors.js'
import { createChildLogger } from '../../logger.js'

export class GetPicklistValuesTool extends Tool {
  readonly definition: ToolDefinition = {
    name: 'get_picklist_values',
    description: 'Retrieve picklist values for a specific Salesforce field with security validation and dependency information',
    inputSchema: {
      type: 'object',
      properties: {
        objectName: {
          type: 'string',
          description: 'Name of the Salesforce object (e.g., Account, Contact)'
        },
        fieldName: {
          type: 'string',
          description: 'Name of the picklist field to retrieve values for'
        },
        includeInactive: {
          type: 'boolean',
          description: 'Whether to include inactive picklist values (default: false)',
          default: false
        }
      },
      required: ['objectName', 'fieldName']
    },
    annotations: {
      readOnlyHint: true,
      idempotentHint: true
    }
  }

  async execute(input: any, context: ToolExecutionContext): Promise<ToolResult> {
    // Input validation
    if (!input.objectName || (typeof input.objectName === 'string' && input.objectName.trim() === '')) {
      throw new ToolError(input.objectName === '' ? 'objectName cannot be empty' : 'objectName is required', ErrorCode.INVALID_PARAMS, 'get_picklist_values')
    }
    if (!input.fieldName || (typeof input.fieldName === 'string' && input.fieldName.trim() === '')) {
      throw new ToolError(input.fieldName === '' ? 'fieldName cannot be empty' : 'fieldName is required', ErrorCode.INVALID_PARAMS, 'get_picklist_values')
    }
    if (typeof input.objectName !== 'string') {
      throw new ToolError('objectName must be a string', ErrorCode.INVALID_PARAMS, 'get_picklist_values')
    }
    if (typeof input.fieldName !== 'string') {
      throw new ToolError('fieldName must be a string', ErrorCode.INVALID_PARAMS, 'get_picklist_values')
    }

    const { objectName, fieldName, includeInactive = false } = input

    this.logger.info({ objectName, fieldName, includeInactive }, 'Retrieving picklist values')

    // Validate Salesforce connection
    if (!context.salesforceClient.isConnected()) {
      await context.salesforceClient.connect()
    }
    
    const connection = context.salesforceClient.getConnection()
    if (!connection) {
      throw new ToolError('No Salesforce connection available', ErrorCode.CONNECTION_FAILED, 'get_picklist_values')
    }

    try {
      // Get field metadata via object describe
      const sobject = connection.sobject(objectName)
      const objectDescribe = await sobject.describe()
      
      // Find the specific field
      const fieldDescribe = objectDescribe.fields.find((field: any) => 
        field.name.toLowerCase() === fieldName.toLowerCase()
      )

      if (!fieldDescribe) {
        throw new ToolError(`Field ${fieldName} not found on ${objectName} object`, ErrorCode.RESOURCE_NOT_FOUND, 'get_picklist_values')
      }

      // Check field-level security
      if ((fieldDescribe as any).accessible === false) {
        throw new ToolError(`Access denied: insufficient permissions to read field ${fieldName}`, ErrorCode.AUTHENTICATION_FAILED, 'get_picklist_values')
      }

      // Validate this is a picklist field
      if (fieldDescribe.type !== 'picklist' && fieldDescribe.type !== 'multipicklist') {
        throw new ToolError(`Field ${fieldName} is not a picklist field`, ErrorCode.INVALID_PARAMS, 'get_picklist_values')
      }

      // Get picklist values
      let picklistValues = fieldDescribe.picklistValues || []

      // Filter inactive values unless requested
      if (!includeInactive) {
        picklistValues = picklistValues.filter((value: any) => value.active === true)
      }

      // Sanitize sensitive data in picklist values
      picklistValues = this.sanitizePicklistValues(picklistValues)

      const result = {
        objectName,
        fieldName: fieldDescribe.name,
        fieldType: fieldDescribe.type,
        values: picklistValues,
        isDependentPicklist: fieldDescribe.dependentPicklist || false,
        controllerField: fieldDescribe.controllerName || null,
        totalValues: picklistValues.length,
        includesInactive: includeInactive
      }

      this.logger.info({ 
        objectName, 
        fieldName, 
        valueCount: picklistValues.length,
        isDependentPicklist: result.isDependentPicklist
      }, 'Successfully retrieved picklist values')

      return {
        content: [{
          type: 'text',
          text: JSON.stringify(result, null, 2)
        }]
      }

    } catch (error: unknown) {
      // Handle specific Salesforce errors
      const errorMessage = getErrorMessage(error)
      if (errorMessage.includes('INVALID_TYPE')) {
        throw new ToolError(`Invalid object name: ${objectName}`, ErrorCode.RESOURCE_NOT_FOUND, 'get_picklist_values')
      }
      
      if (errorMessage.includes('timeout')) {
        throw new ToolError(`Failed to retrieve picklist values: ${errorMessage}`, ErrorCode.RATE_LIMIT_EXCEEDED, 'get_picklist_values')
      }

      // Re-throw ToolErrors as-is
      if (error instanceof ToolError) {
        throw error
      }

      // Wrap other errors
      const typedError = handleCaughtError(error)
      this.logger.error({ error: typedError, objectName, fieldName }, 'Failed to retrieve picklist values')
      throw new ToolError(`Failed to retrieve picklist values: ${typedError.message}`, ErrorCode.INTERNAL_ERROR, 'get_picklist_values', undefined, typedError)
    }
  }

  /**
   * Sanitize sensitive data in picklist values using established patterns
   */
  private sanitizePicklistValues(values: any[]): any[] {
    return values.map(value => ({
      ...value,
      label: this.sanitizeString(value.label || value.value),
      value: value.value // Keep original value for functional purposes
    }))
  }

  /**
   * Sanitize individual strings for PII data using existing sanitization patterns
   */
  private sanitizeString(text: string): string {
    if (!text || typeof text !== 'string') {
      return text
    }

    // SSN pattern sanitization
    const ssnPattern = /\b\d{3}-\d{2}-\d{4}\b/g
    let sanitized = text.replace(ssnPattern, '***-**-****')

    // Credit card pattern sanitization
    const creditCardPattern = /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g
    sanitized = sanitized.replace(creditCardPattern, '****-****-****-****')

    return sanitized
  }
}