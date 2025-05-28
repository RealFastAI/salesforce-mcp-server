/*
 * Copyright (C) 2025 Ontic. Pte. Ltd. (realfast.ai)
 * Use of this software is governed by the Business Source License included in the LICENSE.TXT file and at www.mariadb.com/bsl11.
 */

import { Tool, type ToolDefinition, type ToolExecutionContext, type ToolResult } from '../base/index.js'
import { ToolError, ErrorCode } from '../../errors.js'

export class DescribeObjectTool extends Tool {
  readonly definition: ToolDefinition = {
    name: 'describe_object',
    description: 'Describes a Salesforce object, returning field metadata and properties',
    inputSchema: {
      type: 'object',
      properties: {
        objectName: {
          type: 'string',
          description: 'The API name of the Salesforce object to describe (e.g., Account, Contact, Custom__c)'
        }
      },
      required: ['objectName']
    },
    annotations: {
      title: 'Describe Salesforce Object',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  }

  async execute(params: any, context: ToolExecutionContext): Promise<ToolResult> {
    const { objectName } = params
    
    this.logger.info({ objectName }, 'Describing Salesforce object')
    
    try {
      // Ensure client is connected
      if (!context.salesforceClient.isConnected()) {
        await context.salesforceClient.connect()
      }
      
      const connection = context.salesforceClient.getConnection()
      if (!connection) {
        throw new ToolError('No Salesforce connection available', ErrorCode.CONNECTION_FAILED, 'describe_object')
      }
      
      // Call Salesforce describe API
      const describeResult = await connection.sobject(objectName).describe()
      
      // Format the result
      const result = {
        name: describeResult.name,
        label: describeResult.label,
        labelPlural: describeResult.labelPlural,
        keyPrefix: describeResult.keyPrefix,
        createable: describeResult.createable,
        updateable: describeResult.updateable,
        deletable: describeResult.deletable,
        queryable: describeResult.queryable,
        searchable: describeResult.searchable,
        custom: describeResult.custom,
        recordTypeInfos: describeResult.recordTypeInfos?.map(rt => ({
          name: rt.name,
          recordTypeId: rt.recordTypeId,
          defaultRecordTypeMapping: rt.defaultRecordTypeMapping,
          master: rt.master,
          available: rt.available
        })),
        fields: describeResult.fields?.slice(0, 10).map(field => ({
          name: field.name,
          label: field.label,
          type: field.type,
          length: field.length,
          precision: field.precision,
          scale: field.scale,
          createable: field.createable,
          updateable: field.updateable,
          nillable: field.nillable,
          unique: field.unique,
          custom: field.custom,
          defaultValue: field.defaultValue,
          referenceTo: field.referenceTo,
          relationshipName: field.relationshipName
        }))
      }
      
      this.logger.info({ 
        objectName, 
        fieldCount: describeResult.fields?.length,
        recordTypeCount: describeResult.recordTypeInfos?.length 
      }, 'Successfully described Salesforce object')
      
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(result, null, 2)
        }]
      }
    } catch (error) {
      this.logger.error({ 
        error, 
        objectName 
      }, 'Failed to describe Salesforce object')
      
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
      return {
        content: [{
          type: 'text',
          text: `Error describing object ${objectName}: ${errorMessage}`
        }]
      }
    }
  }
}