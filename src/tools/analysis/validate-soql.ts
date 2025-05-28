/*
 * Copyright (C) 2025 Ontic. Pte. Ltd. (realfast.ai)
 * Use of this software is governed by the Business Source License included in the LICENSE.TXT file and at www.mariadb.com/bsl11.
 */

import { Tool, type ToolDefinition, type ToolExecutionContext, type ToolResult } from '../base/index.js'
import { ToolError, ErrorCode, handleCaughtError } from '../../errors.js'
import { createChildLogger } from '../../logger.js'

export class ValidateSoqlTool extends Tool {
  readonly definition: ToolDefinition = {
    name: 'validate_soql',
    description: 'Validate SOQL syntax and analyze query structure without execution, with injection prevention and security analysis',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The SOQL query to validate and analyze',
          minLength: 5
        }
      },
      required: ['query']
    },
    annotations: {
      readOnlyHint: true,
      idempotentHint: true
    }
  }

  async execute(input: any, context: ToolExecutionContext): Promise<ToolResult> {
    // Input validation
    if (input.query === undefined || input.query === null) {
      throw new ToolError('query is required', ErrorCode.INVALID_PARAMS, 'validate_soql')
    }
    if (typeof input.query !== 'string') {
      throw new ToolError('query must be a string', ErrorCode.INVALID_PARAMS, 'validate_soql')
    }
    if (input.query.trim() === '' || input.query.length < 5) {
      throw new ToolError('query must be at least 5 characters', ErrorCode.INVALID_PARAMS, 'validate_soql')
    }

    const query = input.query.trim()

    this.logger.info({ queryLength: query.length }, 'Validating SOQL query')

    // Validate Salesforce connection (though we won't execute)
    if (!context.salesforceClient.isConnected()) {
      await context.salesforceClient.connect()
    }
    
    const connection = context.salesforceClient.getConnection()
    if (!connection) {
      throw new ToolError('No Salesforce connection available', ErrorCode.CONNECTION_FAILED, 'validate_soql')
    }

    try {
      // Perform comprehensive SOQL analysis
      const analysis = this.analyzeQuery(query)

      this.logger.info({ 
        isValid: analysis.isValid,
        queryType: analysis.queryType,
        securityIssuesCount: analysis.securityIssues.length,
        syntaxErrorsCount: analysis.syntaxErrors.length
      }, 'SOQL validation completed')

      return {
        content: [{
          type: 'text',
          text: JSON.stringify(analysis, null, 2)
        }]
      }

    } catch (error: unknown) {
      // Wrap other errors
      const typedError = handleCaughtError(error)
      this.logger.error({ error: typedError, queryLength: query.length }, 'Failed to validate SOQL query')
      throw new ToolError(`Failed to validate SOQL query: ${typedError.message}`, ErrorCode.INTERNAL_ERROR, 'validate_soql', undefined, typedError)
    }
  }

  /**
   * Comprehensive SOQL query analysis
   */
  private analyzeQuery(query: string): any {
    const result = {
      query,
      isValid: true,
      queryType: this.detectQueryType(query),
      objects: this.extractObjects(query),
      fields: this.extractFields(query),
      hasWhereClause: this.hasClause(query, 'WHERE'),
      whereFields: this.extractWhereFields(query),
      hasOrderBy: this.hasClause(query, 'ORDER BY'),
      orderByFields: this.extractOrderByFields(query),
      hasLimit: this.hasClause(query, 'LIMIT'),
      limitValue: this.extractLimitValue(query),
      securityIssues: this.detectSecurityIssues(query),
      syntaxErrors: this.detectSyntaxErrors(query),
      complexity: this.analyzeComplexity(query),
      recommendations: this.generateRecommendations(query)
    }

    // Mark as invalid if there are security issues or syntax errors
    result.isValid = result.securityIssues.length === 0 && result.syntaxErrors.length === 0

    return result
  }

  /**
   * Detect the type of SOQL query
   */
  private detectQueryType(query: string): string {
    const upperQuery = query.toUpperCase().trim()
    if (upperQuery.startsWith('SELECT')) return 'SELECT'
    if (upperQuery.startsWith('UPDATE')) return 'UPDATE'
    if (upperQuery.startsWith('DELETE')) return 'DELETE'
    if (upperQuery.startsWith('INSERT')) return 'INSERT'
    return 'UNKNOWN'
  }

  /**
   * Extract object names from the query
   */
  private extractObjects(query: string): string[] {
    const objects: string[] = []
    
    // Extract main FROM object (preserve original case)
    const fromMatch = query.match(/FROM\s+(\w+)/i)
    if (fromMatch?.[1]) {
      objects.push(fromMatch[1])
    }

    // Extract subquery objects (preserve original case)
    const subqueryMatches = query.matchAll(/\(\s*SELECT\s+.*?\s+FROM\s+(\w+)/gi)
    for (const match of subqueryMatches) {
      if (match[1]) {
        objects.push(match[1])
      }
    }

    return objects
  }

  /**
   * Extract field names from SELECT clause
   */
  private extractFields(query: string): string[] {
    const selectMatch = query.match(/SELECT\s+(.*?)\s+FROM/i)
    if (!selectMatch?.[1]) return []

    const fieldsPart = selectMatch[1]
    if (fieldsPart.trim() === '*') return ['*']

    // Simple field extraction (handles basic cases)
    const fields = fieldsPart.split(',').map(field => {
      // Remove subqueries and functions, extract basic field name
      const cleanField = field.trim().replace(/\(.*?\)/g, '').split('.').pop() || ''
      return cleanField.trim()
    }).filter(field => field.length > 0)

    return fields
  }

  /**
   * Check if query has a specific clause
   */
  private hasClause(query: string, clause: string): boolean {
    const regex = new RegExp(`\\b${clause}\\b`, 'i')
    return regex.test(query)
  }

  /**
   * Extract fields referenced in WHERE clause
   */
  private extractWhereFields(query: string): string[] {
    const whereMatch = query.match(/WHERE\s+(.*?)(?:\s+ORDER\s+BY|\s+GROUP\s+BY|\s+LIMIT|$)/i)
    if (!whereMatch?.[1]) return []

    const whereClause = whereMatch[1]
    // Simple field extraction from WHERE clause
    const fieldMatches = whereClause.match(/\b[A-Za-z_][A-Za-z0-9_]*\b/g) || []
    return fieldMatches.filter(field => 
      !['AND', 'OR', 'NOT', 'IN', 'LIKE', 'NULL', 'TRUE', 'FALSE'].includes(field.toUpperCase())
    )
  }

  /**
   * Extract fields from ORDER BY clause
   */
  private extractOrderByFields(query: string): string[] {
    const orderByMatch = query.match(/ORDER\s+BY\s+(.*?)(?:\s+LIMIT|$)/i)
    if (!orderByMatch?.[1]) return []

    const orderByClause = orderByMatch[1]
    return orderByClause.split(',').map(field => {
      return field.trim().replace(/\s+(ASC|DESC)$/i, '').trim()
    }).filter(field => field.length > 0)
  }

  /**
   * Extract LIMIT value
   */
  private extractLimitValue(query: string): number | null {
    const limitMatch = query.match(/LIMIT\s+(\d+)/i)
    return limitMatch?.[1] ? parseInt(limitMatch[1], 10) : null
  }

  /**
   * Detect security issues and injection attempts
   */
  private detectSecurityIssues(query: string): string[] {
    const issues: string[] = []
    const upperQuery = query.toUpperCase()

    // Check for UNION attacks
    if (upperQuery.includes('UNION')) {
      issues.push('UNION statement detected')
    }

    // Check for multiple statements
    if (query.includes(';') && query.split(';').length > 1) {
      issues.push('Multiple statements detected')
    }

    // Check for dangerous functions
    const dangerousFunctions = ['EVAL', 'EXEC', 'EXECUTE', 'SCRIPT']
    for (const func of dangerousFunctions) {
      if (upperQuery.includes(func + '(')) {
        issues.push('Dangerous function detected')
        break
      }
    }

    // Check for excessive subquery nesting
    const subqueryDepth = this.calculateSubqueryDepth(query)
    if (subqueryDepth > 2) {
      issues.push('Excessive subquery nesting')
    }

    return issues
  }

  /**
   * Detect syntax errors
   */
  private detectSyntaxErrors(query: string): string[] {
    const errors: string[] = []
    const upperQuery = query.toUpperCase().trim()

    // Check for valid SELECT statement
    if (!upperQuery.startsWith('SELECT')) {
      errors.push('Invalid SELECT statement')
    }

    // Check for FROM clause
    if (!upperQuery.includes('FROM')) {
      errors.push('Missing FROM clause')
    }

    // Check for invalid field list syntax
    if (query.includes(',,') || query.match(/,\s*FROM/i)) {
      errors.push('Invalid field list syntax')
    }

    // Check for unmatched parentheses
    const openParens = (query.match(/\(/g) || []).length
    const closeParens = (query.match(/\)/g) || []).length
    if (openParens !== closeParens) {
      errors.push('Unmatched parentheses')
    }

    // Check for incomplete WHERE clause
    if (upperQuery.includes('WHERE')) {
      const wherePattern = /WHERE\s*$/i
      if (wherePattern.test(query.trim())) {
        errors.push('Incomplete WHERE clause')
      }
      
      // Check for WHERE followed only by keywords without conditions
      const incompleteWherePattern = /WHERE\s+(ORDER\s+BY|GROUP\s+BY|LIMIT|$)/i
      if (incompleteWherePattern.test(query)) {
        errors.push('WHERE clause missing conditions')
      }
    }

    // Check for incomplete ORDER BY clause
    const incompleteOrderByPattern = /ORDER\s+BY\s*$/i
    if (incompleteOrderByPattern.test(query.trim())) {
      errors.push('Incomplete ORDER BY clause')
    }

    return errors
  }

  /**
   * Calculate subquery nesting depth
   */
  private calculateSubqueryDepth(query: string): number {
    // Count actual nesting depth of SELECT statements
    let currentDepth = 0
    let maxDepth = 0
    let i = 0
    
    while (i < query.length) {
      if (query[i] === '(') {
        // Look ahead to see if this is a SELECT subquery
        let j = i + 1
        while (j < query.length) {
          const char = query[j]
          if (char && /\s/.test(char)) {
            j++
          } else {
            break
          }
        }
        
        if (query.slice(j, j + 6).toUpperCase() === 'SELECT') {
          currentDepth++
          maxDepth = Math.max(maxDepth, currentDepth)
        }
      } else if (query[i] === ')') {
        if (currentDepth > 0) {
          currentDepth--
        }
      }
      i++
    }
    
    return maxDepth
  }

  /**
   * Analyze query complexity
   */
  private analyzeComplexity(query: string): any {
    const factors = {
      fieldCount: this.extractFields(query).length,
      objectCount: this.extractObjects(query).length,
      subqueryCount: (query.match(/\(\s*SELECT/gi) || []).length,
      joinCount: (query.match(/\bJOIN\b/gi) || []).length,
      whereConditions: this.extractWhereFields(query).length
    }

    // Calculate complexity score
    let score = factors.fieldCount * 0.1 +
                factors.objectCount * 0.5 +
                factors.subqueryCount * 2 +
                factors.joinCount * 1.5 +
                factors.whereConditions * 0.2

    score = Math.max(1, Math.round(score))

    let level = 'simple'
    if (score > 10) level = 'very complex'
    else if (score > 5) level = 'complex'
    else if (score > 2) level = 'moderate'

    return {
      score,
      level,
      factors
    }
  }

  /**
   * Generate optimization recommendations
   */
  private generateRecommendations(query: string): string[] {
    const recommendations: string[] = []

    // Check for SELECT *
    if (query.includes('SELECT *')) {
      recommendations.push('Avoid SELECT * for better performance')
    }

    // Check for missing LIMIT on potentially large queries
    if (!this.hasClause(query, 'LIMIT') && 
        (query.includes('LAST_N_DAYS') || query.includes('THIS_YEAR') || 
         query.includes('LAST_N_MONTHS') || this.extractWhereFields(query).length > 3)) {
      recommendations.push('Consider adding LIMIT clause')
    }

    // Check for complex WHERE conditions without indexes
    const whereFields = this.extractWhereFields(query)
    if (whereFields.length > 5) {
      recommendations.push('Consider indexing frequently queried fields')
    }

    // Check for subquery optimization
    const subqueryCount = (query.match(/\(\s*SELECT/gi) || []).length
    if (subqueryCount > 2) {
      recommendations.push('Consider optimizing subqueries or using relationships')
    }

    return recommendations
  }
}