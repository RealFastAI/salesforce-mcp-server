/*
 * Copyright (C) 2025 Ontic. Pte. Ltd. (realfast.ai)
 * Use of this software is governed by the Business Source License included in the LICENSE.TXT file and at www.mariadb.com/bsl11.
 */

import { Tool, type ToolDefinition, type ToolExecutionContext, type ToolResult } from '../base/index.js'
import { ToolError, ErrorCode, handleCaughtError, getErrorMessage } from '../../errors.js'

export class DescribeLayoutTool extends Tool {
  readonly definition: ToolDefinition = {
    name: 'describe_layout',
    description: 'Describes page layouts for a Salesforce object including sections, fields, and positioning',
    inputSchema: {
      type: 'object',
      properties: {
        objectName: {
          type: 'string',
          description: 'The API name of the Salesforce object (e.g., Account, Contact, Custom__c)'
        },
        recordTypeId: {
          type: 'string',
          description: 'Optional record type ID to get layout for specific record type'
        }
      },
      required: ['objectName']
    },
    annotations: {
      title: 'Describe Salesforce Object Layout',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  }

  async execute(params: any, context: ToolExecutionContext): Promise<ToolResult> {
    // Input validation
    if (!params.objectName || typeof params.objectName !== 'string' || params.objectName.trim() === '') {
      throw new ToolError('objectName is required and must be a non-empty string', ErrorCode.INVALID_PARAMS, 'describe_layout')
    }

    if (params.recordTypeId && typeof params.recordTypeId !== 'string') {
      throw new ToolError('recordTypeId must be a string when provided', ErrorCode.INVALID_PARAMS, 'describe_layout')
    }

    const { objectName, recordTypeId } = params
    
    this.logger.info({ objectName, recordTypeId }, 'Describing Salesforce object layout')
    
    try {
      // Ensure client is connected
      if (!context.salesforceClient.isConnected()) {
        await context.salesforceClient.connect()
      }
      
      const connection = context.salesforceClient.getConnection()
      if (!connection) {
        throw new ToolError('No Salesforce connection available', ErrorCode.CONNECTION_FAILED, 'describe_layout')
      }
      
      // Build API endpoint
      let endpoint = `/services/data/v59.0/sobjects/${objectName}/describe/layouts`
      if (recordTypeId) {
        endpoint += `/${recordTypeId}`
      }
      
      // Call Salesforce layout API
      const layoutResult = await connection.request(endpoint) as any
      
      // Debug logging to understand actual API response structure
      this.logger.info({ 
        objectName, 
        layoutCount: layoutResult?.layouts?.length || 0,
        rawResponseKeys: Object.keys(layoutResult || {}),
        firstLayoutKeys: layoutResult?.layouts?.[0] ? Object.keys(layoutResult.layouts[0]) : [],
        sectionsCount: layoutResult?.layouts?.[0]?.sections?.length || 0,
        detailLayoutSectionsCount: layoutResult?.layouts?.[0]?.detailLayoutSections?.length || 0,
        sampleSectionStructure: layoutResult?.layouts?.[0]?.detailLayoutSections?.[0] ? Object.keys(layoutResult.layouts[0].detailLayoutSections[0]) : [],
        sampleLayoutRowStructure: layoutResult?.layouts?.[0]?.detailLayoutSections?.[0]?.layoutRows?.[0] ? Object.keys(layoutResult.layouts[0].detailLayoutSections[0].layoutRows[0]) : []
      }, 'Successfully retrieved layout information')
      
      return {
        content: [{
          type: 'text',
          text: this.formatLayoutOutput(objectName, layoutResult)
        }]
      }
    } catch (error: unknown) {
      const errorMessage = getErrorMessage(error)
      this.logger.error({ objectName, error: errorMessage }, 'Failed to describe layout')
      
      if (error instanceof ToolError) {
        throw error
      }
      
      // Map common API errors
      if (errorMessage.includes('INVALID_TYPE')) {
        throw new ToolError(`Invalid object name: ${objectName}`, ErrorCode.INVALID_PARAMS, 'describe_layout')
      }
      
      if (errorMessage.includes('NOT_FOUND')) {
        throw new ToolError(`Object or layout not found: ${objectName}`, ErrorCode.RESOURCE_NOT_FOUND, 'describe_layout')
      }
      
      if (errorMessage.includes('INSUFFICIENT_ACCESS')) {
        throw new ToolError(`Insufficient permissions to access layout for ${objectName}`, ErrorCode.AUTHENTICATION_FAILED, 'describe_layout')
      }
      
      const typedError = handleCaughtError(error)
      throw new ToolError(`Failed to describe layout: ${typedError.message}`, ErrorCode.INTERNAL_ERROR, 'describe_layout')
    }
  }

  private formatLayoutOutput(objectName: string, layoutResult: any): string {
    const output: string[] = []
    
    output.push(`${objectName} Layout Information`)
    output.push('='.repeat(objectName.length + 20))
    output.push('')
    
    if (!layoutResult?.layouts || layoutResult.layouts.length === 0) {
      output.push('No layouts available for this object.')
      return output.join('\n')
    }
    
    layoutResult.layouts.forEach((layout: any, index: number) => {
      if (index > 0) output.push('')
      
      output.push(`Layout: ${layout.name || 'Unnamed Layout'}`)
      if (layout.recordTypeName) {
        output.push(`Record Type: ${layout.recordTypeName}`)
      }
      output.push('')
      
      // Check for detailLayoutSections (actual API response structure)
      const sections = layout.detailLayoutSections || layout.sections || []
      
      if (sections.length === 0) {
        output.push('No sections available for this layout.')
        return
      }
      
      output.push('Sections:')
      sections.forEach((section: any) => {
        output.push(`- ${section.label || 'Unnamed Section'}`)
        
        if (section.columns) {
          output.push(`  Columns: ${section.columns}`)
        }
        
        // Extract field names from layout structure
        const fields = this.extractFieldsFromSection(section)
        if (fields.length > 0) {
          output.push(`  Fields: ${fields.join(', ')}`)
        }
      })
    })
    
    // Add record type mappings if present
    if (layoutResult.recordTypeMappings && layoutResult.recordTypeMappings.length > 0) {
      output.push('')
      output.push('Record Type Mappings:')
      layoutResult.recordTypeMappings.forEach((mapping: any) => {
        const sanitizedRecordTypeId = this.sanitizeIdForLogging(mapping.recordTypeId || '')
        const sanitizedLayoutId = this.sanitizeIdForLogging(mapping.layoutId || '')
        output.push(`- Record Type ID: ${sanitizedRecordTypeId} → Layout ID: ${sanitizedLayoutId}`)
      })
    }
    
    return output.join('\n')
  }
  
  private extractFieldsFromSection(section: any): string[] {
    const fields: string[] = []
    
    if (section.layoutRows) {
      section.layoutRows.forEach((row: any) => {
        if (row.layoutItems) {
          row.layoutItems.forEach((item: any) => {
            if (item.layoutComponents) {
              item.layoutComponents.forEach((component: any) => {
                if (component.type === 'Field' && component.value) {
                  fields.push(component.value)
                }
              })
            }
          })
        }
      })
    }
    
    return fields
  }
  
  private sanitizeIdForLogging(id: string): string {
    if (!id || id.length < 15) return id
    // Show first 3 and last 3 characters of Salesforce IDs
    return `${id.substring(0, 3)}...${id.substring(id.length - 3)}`
  }
}