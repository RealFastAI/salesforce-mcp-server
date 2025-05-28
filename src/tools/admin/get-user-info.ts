/*
 * Copyright (C) 2025 Ontic. Pte. Ltd. (realfast.ai)
 * Use of this software is governed by the Business Source License included in the LICENSE.TXT file and at www.mariadb.com/bsl11.
 */

import { Tool, type ToolDefinition, type ToolExecutionContext, type ToolResult } from '../base/index.js'
import { ToolError, ErrorCode, handleCaughtError, getErrorMessage } from '../../errors.js'

export class GetUserInfoTool extends Tool {
  readonly definition: ToolDefinition = {
    name: 'get_user_info',
    description: 'Retrieve current user profile information including name, email, profile, and organizational details',
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

    this.logger.info('Getting current user information')

    const connection = salesforceClient.getConnection()
    if (!connection) {
      this.logger.error('No Salesforce connection available')
      throw new ToolError('No Salesforce connection available', ErrorCode.CONNECTION_FAILED, 'get_user_info')
    }

    try {
      // First get current user ID using REST API userinfo endpoint
      const userInfo = await connection.request('/services/oauth2/userinfo') as any
      const currentUserId = userInfo?.user_id
      
      if (!currentUserId) {
        throw new ToolError('Unable to determine current user ID', ErrorCode.INTERNAL_ERROR, 'get_user_info')
      }
      
      // Query current user information using the retrieved user ID
      const query = `SELECT Id, Name, Email, Username, IsActive, Title, Department, Division, CompanyName, Phone, MobilePhone, Alias, TimeZoneSidKey, LocaleSidKey, LanguageLocaleKey, EmailEncodingKey, UserType, Profile.Name FROM User WHERE Id = '${currentUserId}'`
      
      const result = await connection.query(query)
      
      if (!result.records || result.records.length === 0) {
        this.logger.warn('No user records found for current user')
        throw new ToolError('Current user information not found', ErrorCode.RESOURCE_NOT_FOUND, 'get_user_info')
      }

      if (result.records.length > 1) {
        this.logger.error(`Multiple user records returned: ${result.records.length}`)
        throw new ToolError('Multiple user records returned for current user', ErrorCode.INTERNAL_ERROR, 'get_user_info')
      }

      const userRecord = result.records[0]
      if (!userRecord) {
        throw new ToolError('Current user information not found', ErrorCode.RESOURCE_NOT_FOUND, 'get_user_info')
      }
      
      this.logger.info({ 
        userId: this.sanitizeIdForLogging(userRecord.Id || 'unknown'),
        userType: userRecord.UserType,
        isActive: userRecord.IsActive
      }, 'Successfully retrieved user information')

      return {
        content: [{
          type: 'text',
          text: this.formatUserOutput(userRecord)
        }]
      }
    } catch (error: unknown) {
      if (error instanceof ToolError) {
        throw error
      }
      
      const typedError = handleCaughtError(error)
      this.logger.error({ 
        error: getErrorMessage(error) 
      }, 'Failed to get user information')
      
      throw new ToolError(
        `Failed to get user information: ${typedError.message}`,
        ErrorCode.INTERNAL_ERROR,
        'get_user_info'
      )
    }
  }

  private formatUserOutput(userRecord: any): string {
    let output = `Current User Information:\n\n`
    
    // Core identity fields
    output += `User ID: ${this.sanitizeIdForLogging(userRecord.Id)}\n`
    output += `Name: ${userRecord.Name || '[Not provided]'}\n`
    output += `Email: ${userRecord.Email || '[Not provided]'}\n`
    output += `Username: ${userRecord.Username || '[Not provided]'}\n`
    output += `Active: ${userRecord.IsActive ? 'Yes' : 'No'}\n`
    
    // Profile information
    const profileName = userRecord.Profile?.Name || '[Unknown]'
    output += `Profile: ${profileName}\n`
    output += `User Type: ${userRecord.UserType || '[Not specified]'}\n`
    
    // Optional organizational fields
    if (userRecord.Title) {
      output += `Title: ${userRecord.Title}\n`
    }
    if (userRecord.Department) {
      output += `Department: ${userRecord.Department}\n`
    }
    if (userRecord.Division) {
      output += `Division: ${userRecord.Division}\n`
    }
    if (userRecord.CompanyName) {
      output += `Company: ${userRecord.CompanyName}\n`
    }
    
    // Contact information
    if (userRecord.Phone) {
      output += `Phone: ${userRecord.Phone}\n`
    }
    if (userRecord.MobilePhone) {
      output += `Mobile: ${userRecord.MobilePhone}\n`
    }
    
    // System information
    if (userRecord.Alias) {
      output += `Alias: ${userRecord.Alias}\n`
    }
    if (userRecord.TimeZoneSidKey) {
      output += `Time Zone: ${userRecord.TimeZoneSidKey}\n`
    }
    if (userRecord.LocaleSidKey) {
      output += `Locale: ${userRecord.LocaleSidKey}\n`
    }
    if (userRecord.LanguageLocaleKey) {
      output += `Language: ${userRecord.LanguageLocaleKey}\n`
    }
    if (userRecord.EmailEncodingKey) {
      output += `Email Encoding: ${userRecord.EmailEncodingKey}\n`
    }
    
    return output
  }

  private sanitizeIdForLogging(id: string): string {
    // Show first 3 and last 3 characters for debugging while maintaining privacy
    if (id && id.length >= 6) {
      return `${id.substring(0, 3)}...${id.substring(id.length - 3)}`
    }
    return '[ID_REDACTED]'
  }
}