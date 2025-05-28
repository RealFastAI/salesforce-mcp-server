/*
 * Copyright (C) 2025 Ontic Pte. Ltd. (realfast.ai)
 * Use of this software is governed by the Business Source License included in the LICENSE.TXT file and at www.mariadb.com/bsl11.
 */

import { Tool, type ToolDefinition, type ToolExecutionContext, type ToolResult } from '../base/index.js'

export class SoslSearchTool extends Tool {
  readonly definition: ToolDefinition = {
    name: 'sosl_search',
    description: 'Execute multi-object text search using SOSL with result ranking and pagination',
    inputSchema: {
      type: 'object',
      properties: {
        searchTerm: {
          type: 'string',
          description: 'The text to search for across Salesforce objects',
          minLength: 2
        },
        objects: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional array of object names to search within (e.g., ["Account", "Contact"])',
          default: []
        },
        limit: {
          type: 'number',
          minimum: 1,
          maximum: 200,
          description: 'Maximum number of records to return per object (default: 20, max: 200)',
          default: 20
        },
        fields: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional array of field names to search within (security restrictions apply)',
          default: []
        }
      },
      required: ['searchTerm']
    },
    annotations: {
      title: 'SOSL Text Search',
      readOnlyHint: true,
      idempotentHint: true
    }
  }

  async execute(params: any, context: ToolExecutionContext): Promise<ToolResult> {
    const { searchTerm, objects = [], limit = 20, fields = [] } = params

    // Validate search term - check for empty or whitespace-only terms
    if (!searchTerm || searchTerm.trim().length === 0) {
      return {
        content: [{
          type: 'text',
          text: 'Error: Search term cannot be empty'
        }]
      }
    }

    // Validate search term length
    if (searchTerm.trim().length < 2) {
      return {
        content: [{
          type: 'text',
          text: 'Error: Search term must be at least 2 characters long'
        }]
      }
    }

    // Security validation - check for dangerous patterns and injection attempts
    if (this.containsDangerousPatterns(searchTerm) || this.detectSoslInjection(searchTerm)) {
      return {
        content: [{
          type: 'text',
          text: 'Error: Search term contains potentially unsafe content'
        }]
      }
    }

    // Security validation - check object scope limitations
    const scopeValidation = this.validateSearchScope(objects)
    if (!scopeValidation.valid) {
      return {
        content: [{
          type: 'text',
          text: `Error: ${scopeValidation.message}`
        }]
      }
    }

    // Security validation - check field targeting
    const fieldValidation = this.validateFieldTargeting(fields)
    if (!fieldValidation.valid) {
      return {
        content: [{
          type: 'text',
          text: `Error: ${fieldValidation.message}`
        }]
      }
    }

    // Ensure client is connected
    if (!context.salesforceClient.isConnected()) {
      await context.salesforceClient.connect()
    }

    const connection = context.salesforceClient.getConnection()
    if (!connection) {
      return {
        content: [{
          type: 'text',
          text: 'Error: No Salesforce connection available. Please authenticate first.'
        }]
      }
    }

    try {
      this.logger.info({ 
        searchTerm: this.sanitizeSearchTermForLogging(searchTerm),
        objects: objects.length > 0 ? objects : 'all',
        limit 
      }, 'Executing SOSL search')

      // Build SOSL query
      const soslQuery = this.buildSoslQuery(searchTerm, objects, limit)
      
      // Execute the search
      const searchResult = await connection.search(soslQuery)
      
      // Sanitize and filter results
      const sanitizedRecords = await this.sanitizeAndFilterResults(searchResult.searchRecords, connection)
      
      // Format the result
      const result = this.formatSearchResults(sanitizedRecords, searchTerm, objects, limit)
      
      this.logger.info({ 
        recordCount: searchResult.searchRecords?.length || 0,
        searchTerm: this.sanitizeSearchTermForLogging(searchTerm)
      }, 'SOSL search completed successfully')
      
      return {
        content: [{
          type: 'text',
          text: result
        }]
      }
    } catch (error) {
      this.logger.error({ 
        error, 
        searchTerm: this.sanitizeSearchTermForLogging(searchTerm),
        objects
      }, 'Failed to execute SOSL search')
      
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
      
      // Enhanced error handling with better user messages
      if (errorMessage.includes('INVALID_SEARCH') || errorMessage.includes('Invalid search syntax')) {
        return {
          content: [{
            type: 'text',
            text: `Invalid search syntax detected. Check your search term format. ${errorMessage}`
          }]
        }
      }
      
      // Handle specific Salesforce API errors
      if (errorMessage.includes('INVALID_TYPE') || errorMessage.includes('is not supported')) {
        return {
          content: [{
            type: 'text',
            text: `Search failed: ${errorMessage}`
          }]
        }
      }
      
      // Handle network and timeout errors
      if (errorMessage.includes('timeout') || errorMessage.includes('Request timeout')) {
        return {
          content: [{
            type: 'text',
            text: `Search failed: ${errorMessage}`
          }]
        }
      }
      
      // Generic error fallback
      return {
        content: [{
          type: 'text',
          text: `Error executing search: ${errorMessage}`
        }]
      }
    }
  }

  private containsDangerousPatterns(searchTerm: string): boolean {
    const dangerousPatterns = [
      /;\s*(DROP|DELETE|INSERT|UPDATE|CREATE|ALTER|TRUNCATE)/i,
      /--/,
      /\/\*/,
      /\bEXEC\b/i,
      /\bSCRIPT\b/i,
    ]
    
    return dangerousPatterns.some(pattern => pattern.test(searchTerm))
  }

  private detectSoslInjection(searchTerm: string): boolean {
    // Detect SOSL injection attempts
    const soslInjectionPatterns = [
      /}\s*(RETURNING|IN|LIMIT)/i,  // Attempting to break out of search term
      /"\s*(OR|AND|UNION)/i,        // SQL-style injection patterns
      /'\s*(OR|AND|UNION)/i,        // Single quote injection patterns  
      /}\s*RETURNING\s+\w+/i,       // Direct RETURNING injection
      /}\s*LIMIT\s+\d+/i            // Direct LIMIT injection
    ]
    
    return soslInjectionPatterns.some(pattern => pattern.test(searchTerm))
  }

  private buildSoslQuery(searchTerm: string, objects: string[], limit: number): string {
    // Escape the search term for SOSL
    const escapedTerm = searchTerm.replace(/[{}]/g, '\\$&')
    
    if (objects.length === 0) {
      // Search all standard objects by default
      return `FIND {${escapedTerm}} IN ALL FIELDS RETURNING Account(Id LIMIT ${limit}), Contact(Id LIMIT ${limit})`
    }
    
    // Search specific objects with individual limits - correct SOSL syntax
    const returningClause = objects.map(obj => `${obj}(Id LIMIT ${limit})`).join(', ')
    return `FIND {${escapedTerm}} IN ALL FIELDS RETURNING ${returningClause}`
  }

  private async sanitizeAndFilterResults(records: any[], connection: any): Promise<any[]> {
    if (!records || records.length === 0) {
      return []
    }

    const sanitizedRecords: any[] = []

    for (const record of records) {
      try {
        // Get field permissions for this object type
        const objectType = record.attributes?.type
        let fieldPermissions: any = {}
        
        if (objectType) {
          try {
            const describe = await connection.sobject(objectType).describe()
            fieldPermissions = describe.fields || {}
          } catch (error) {
            // If describe fails, continue with basic sanitization
            this.logger.warn({ objectType, error: error instanceof Error ? error.message : 'Unknown error' }, 
              'Failed to get field permissions, using basic sanitization')
          }
        }

        // Create sanitized record
        const sanitizedRecord = { ...record }

        // Filter fields based on permissions and sanitize sensitive data
        for (const [fieldName, value] of Object.entries(record)) {
          if (fieldName === 'attributes') {
            continue // Keep attributes as-is
          }

          // Check field accessibility
          const fieldInfo = fieldPermissions[fieldName]
          if (fieldInfo && fieldInfo.accessible === false) {
            // Remove inaccessible fields
            delete sanitizedRecord[fieldName]
            continue
          }

          // Sanitize sensitive data patterns
          if (typeof value === 'string') {
            sanitizedRecord[fieldName] = this.sanitizeSensitiveData(value, fieldName)
          }
        }

        sanitizedRecords.push(sanitizedRecord)
      } catch (error) {
        // If sanitization fails for a record, log and include with basic sanitization
        this.logger.warn({ recordId: record.Id, error: error instanceof Error ? error.message : 'Unknown error' }, 
          'Failed to sanitize record, using basic sanitization')
        
        const basicSanitized = { ...record }
        for (const [fieldName, value] of Object.entries(record)) {
          if (fieldName !== 'attributes' && typeof value === 'string') {
            basicSanitized[fieldName] = this.sanitizeSensitiveData(value, fieldName)
          }
        }
        sanitizedRecords.push(basicSanitized)
      }
    }

    return sanitizedRecords
  }

  private sanitizeSensitiveData(value: string, fieldName: string): string {
    // Sanitize based on field name patterns
    if (fieldName.toLowerCase().includes('ssn') || fieldName.toLowerCase().includes('social')) {
      // Mask SSN: 123-45-6789 -> ***-**-****
      return value.replace(/\d{3}-\d{2}-\d{4}/, '***-**-****')
        .replace(/\d{9}/, '*********')
    }

    if (fieldName.toLowerCase().includes('credit') && fieldName.toLowerCase().includes('card')) {
      // Mask credit card: 1234-5678-9012-3456 -> ****-****-****-****
      return value.replace(/\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}/, '****-****-****-****')
        .replace(/\d{13,19}/, '****************')
    }

    // Sanitize based on value patterns
    // SSN patterns
    value = value.replace(/\b\d{3}-\d{2}-\d{4}\b/g, '***-**-****')
    value = value.replace(/\b\d{9}\b/g, '*********')

    // Credit card patterns
    value = value.replace(/\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g, '****-****-****-****')
    value = value.replace(/\b\d{13,19}\b/g, (match) => '*'.repeat(match.length))

    return value
  }

  private formatSearchResults(records: any[], searchTerm: string, objects: string[], limit: number): string {
    return SearchResultFormatter.formatSearchResults(records, searchTerm)
  }

  private formatRecordSummary(record: any, objectType: string): string {
    return RecordSummaryFormatter.formatRecord(record, objectType)
  }

  private sanitizeSearchTermForLogging(searchTerm: string): string {
    // Truncate long search terms and mask potentially sensitive patterns
    if (searchTerm.length > 50) {
      return searchTerm.substring(0, 47) + '...'
    }
    return searchTerm.replace(/\b\d{15,18}\b/g, '[ID_REDACTED]')
  }

  private validateSearchScope(objects: string[]): { valid: boolean; message?: string } {
    // Maximum object count validation
    if (objects.length > 10) {
      return {
        valid: false,
        message: 'Cannot search too many objects at once (maximum: 10)'
      }
    }

    // Restricted objects - security-sensitive objects that should not be searchable
    const restrictedObjects = [
      'User', 'Profile', 'PermissionSet', 'PermissionSetAssignment',
      'UserRole', 'UserRecordAccess', 'LoginHistory', 'AuthSession',
      'SetupEntityAccess', 'ObjectPermissions', 'FieldPermissions',
      'SystemModstamp', 'OrgWideEmailAddress', 'CronTrigger',
      'AsyncApexJob', 'ApexLog', 'ApexTestResult'
    ]

    const forbiddenObjects = objects.filter(obj => 
      restrictedObjects.includes(obj) || 
      obj.toLowerCase().includes('permission') ||
      obj.toLowerCase().includes('security') ||
      obj.toLowerCase().includes('auth')
    )

    if (forbiddenObjects.length > 0) {
      return {
        valid: false,
        message: `Cannot access to restricted objects: ${forbiddenObjects.join(', ')}`
      }
    }

    return { valid: true }
  }

  private validateFieldTargeting(fields: string[]): { valid: boolean; message?: string } {
    if (fields.length === 0) {
      return { valid: true }
    }

    // Sensitive field patterns - fields that might contain PII or sensitive data
    const sensitiveFieldPatterns = [
      /ssn/i, /social/i, /tax/i, /ein/i,
      /credit/i, /card/i, /bank/i, /account.*number/i,
      /password/i, /token/i, /key/i, /secret/i,
      /salary/i, /wage/i, /income/i, /compensation/i,
      /medical/i, /health/i, /diagnosis/i, /prescription/i,
      /birth.*date/i, /dob/i, /license/i, /passport/i
    ]

    const sensitiveFields = fields.filter(field =>
      sensitiveFieldPatterns.some(pattern => pattern.test(field))
    )

    if (sensitiveFields.length > 0) {
      return {
        valid: false,
        message: `Cannot access to sensitive fields: ${sensitiveFields.join(', ')}`
      }
    }

    return { valid: true }
  }
}

// Search Result Formatting Utilities
export class SearchResultFormatter {
  /**
   * Groups search records by their Salesforce object type
   */
  static groupRecordsByType(records: any[]): Map<string, any[]> {
    const groupedResults = new Map<string, any[]>()
    
    records.forEach(record => {
      const objectType = record.attributes?.type || 'Unknown'
      if (!groupedResults.has(objectType)) {
        groupedResults.set(objectType, [])
      }
      groupedResults.get(objectType)!.push(record)
    })

    return groupedResults
  }

  /**
   * Formats the search summary header with record count
   */
  static formatSearchSummary(searchTerm: string, recordCount: number): string {
    const recordText = recordCount === 1 ? 'record' : 'records'
    return `Search completed successfully.\n\nFound ${recordCount} ${recordText} matching "${searchTerm}"\n\n`
  }

  /**
   * Formats a header for an object group with record count
   */
  static formatObjectGroupHeader(objectType: string, count: number): string {
    const recordText = count === 1 ? 'record' : 'records'
    return `${objectType} (${count} ${recordText}):`
  }

  /**
   * Formats complete search results with grouping and summaries
   */
  static formatSearchResults(records: any[], searchTerm: string): string {
    if (!records || records.length === 0) {
      return `No records found matching search term "${searchTerm}".`
    }

    // Group results by object type
    const groupedResults = this.groupRecordsByType(records)
    
    let result = this.formatSearchSummary(searchTerm, records.length)

    // Display results grouped by object type
    for (const [objectType, objectRecords] of groupedResults) {
      result += this.formatObjectGroupHeader(objectType, objectRecords.length) + '\n'
      
      objectRecords.forEach((record, index) => {
        const cleanRecord = { ...record }
        delete cleanRecord.attributes
        
        result += `  ${index + 1}. ${RecordSummaryFormatter.formatRecord(cleanRecord, objectType)}\n`
      })
      result += '\n'
    }

    return result
  }
}

// Record Summary Formatting Utilities  
export class RecordSummaryFormatter {
  /**
   * Formats a Salesforce record into a human-readable summary
   */
  static formatRecord(record: any, objectType: string): string {
    const details: string[] = []
    
    // Always include Id if available
    if (record.Id) details.push(`Id: ${record.Id}`)
    
    switch (objectType) {
      case 'Account':
        this.addAccountFields(record, details)
        break
      case 'Contact':
        this.addContactFields(record, details)
        break
      case 'Lead':
        this.addLeadFields(record, details)
        break
      default:
        this.addGenericFields(record, details)
    }
    
    return details.join(', ')
  }

  /**
   * Adds Account-specific fields to the details array
   */
  private static addAccountFields(record: any, details: string[]): void {
    if (record.Name) details.push(`Name: ${record.Name}`)
    if (record.Type) details.push(`Type: ${record.Type}`)
    if (record.Phone) details.push(`Phone: ${record.Phone}`)
    if (record.Email) details.push(`Email: ${record.Email}`)
    if (record.Revenue) details.push(`Revenue: ${record.Revenue}`)
    if (record.SSN__c) details.push(`SSN: ${record.SSN__c}`)
    if (record.CreditCard__c) details.push(`CreditCard: ${record.CreditCard__c}`)
  }

  /**
   * Adds Contact-specific fields to the details array
   */
  private static addContactFields(record: any, details: string[]): void {
    const name = [record.FirstName, record.LastName].filter(Boolean).join(' ')
    if (name) details.push(`Name: ${name}`)
    if (record.Title) details.push(`Title: ${record.Title}`)
    if (record.Phone) details.push(`Phone: ${record.Phone}`)
    if (record.Email) details.push(`Email: ${record.Email}`)
    if (record.SSN__c) details.push(`SSN: ${record.SSN__c}`)
    if (record.BirthDate) details.push(`BirthDate: ${record.BirthDate}`)
  }

  /**
   * Adds Lead-specific fields to the details array
   */
  private static addLeadFields(record: any, details: string[]): void {
    const leadName = [record.FirstName, record.LastName].filter(Boolean).join(' ')
    if (leadName) details.push(`Name: ${leadName}`)
    if (record.Company) details.push(`Company: ${record.Company}`)
    if (record.Phone) details.push(`Phone: ${record.Phone}`)
    if (record.Email) details.push(`Email: ${record.Email}`)
  }

  /**
   * Adds generic fields for unknown object types
   */
  private static addGenericFields(record: any, details: string[]): void {
    if (record.Name) details.push(`Name: ${record.Name}`)
    
    // Include any other fields for unknown object types
    Object.entries(record).forEach(([key, value]) => {
      if (key !== 'Id' && key !== 'Name' && key !== 'attributes' && value) {
        details.push(`${key}: ${value}`)
      }
    })
  }
}