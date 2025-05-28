/*
 * Copyright (C) 2025 Ontic Pte. Ltd. (realfast.ai)
 * Use of this software is governed by the Business Source License included in the LICENSE.TXT file and at www.mariadb.com/bsl11.
 */

import { Tool, type ToolDefinition, type ToolExecutionContext, type ToolResult } from '../base/index.js'
import { ToolError, ErrorCode, handleCaughtError } from '../../errors.js'
import { createChildLogger } from '../../logger.js'

/**
 * Tool for analyzing SOQL query performance and providing execution plan insights
 * Provides performance analysis, optimization recommendations, and execution planning without query execution
 */
export class ExplainQueryPlanTool extends Tool {
  readonly definition: ToolDefinition = {
    name: 'explain_query_plan',
    description: 'Analyze SOQL query performance characteristics and provide execution plan insights without executing the query',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The SOQL query to analyze for performance characteristics',
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
      throw new ToolError('query is required', ErrorCode.INVALID_PARAMS, 'explain_query_plan')
    }
    if (typeof input.query !== 'string') {
      throw new ToolError('query must be a string', ErrorCode.INVALID_PARAMS, 'explain_query_plan')
    }
    if (input.query.trim() === '' || input.query.length < 5) {
      throw new ToolError('query must be at least 5 characters', ErrorCode.INVALID_PARAMS, 'explain_query_plan')
    }

    const query = input.query.trim()

    this.logger.info({ queryLength: query.length }, 'Analyzing SOQL query performance')

    // Validate Salesforce connection (for metadata access)
    if (!context.salesforceClient.isConnected()) {
      await context.salesforceClient.connect()
    }
    
    const connection = context.salesforceClient.getConnection()
    if (!connection) {
      throw new ToolError('No Salesforce connection available', ErrorCode.CONNECTION_FAILED, 'explain_query_plan')
    }

    try {
      // First validate the query syntax
      const validation = this.validateQuery(query)
      if (!validation.isValid) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              query,
              isValid: false,
              errors: validation.errors,
              message: 'Query has syntax errors. Please fix before analyzing performance.'
            }, null, 2)
          }]
        }
      }

      // Perform comprehensive performance analysis
      const analysis = await this.analyzeQueryPerformance(query, connection)

      this.logger.info({ 
        estimatedCost: analysis.performance.estimatedCost,
        hasSubqueries: analysis.performance.hasSubqueries,
        recommendationCount: analysis.recommendations.length
      }, 'SOQL performance analysis completed')

      return {
        content: [{
          type: 'text',
          text: JSON.stringify(analysis, null, 2)
        }]
      }

    } catch (error: unknown) {
      const typedError = handleCaughtError(error)
      this.logger.error({ error: typedError, queryLength: query.length }, 'Failed to analyze SOQL query performance')
      throw new ToolError(`Failed to analyze query performance: ${typedError.message}`, ErrorCode.INTERNAL_ERROR, 'explain_query_plan', undefined, typedError)
    }
  }

  /**
   * Comprehensive query validation before performance analysis
   * Reuses validation logic from ValidateSoqlTool for consistency
   */
  private validateQuery(query: string): { isValid: boolean; errors: string[] } {
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

    // Check for invalid field list syntax (missing commas)
    if (query.includes(',,') || query.match(/,\s*FROM/i)) {
      errors.push('Invalid field list syntax')
    }

    // Check for missing commas between fields (common error)
    const selectMatch = query.match(/SELECT\s+(.*?)\s+FROM/i)
    if (selectMatch?.[1]) {
      const fieldsString = selectMatch[1].trim()
      // Check for missing commas: two words next to each other without comma
      if (/\b\w+\s+\w+\b/.test(fieldsString) && !fieldsString.includes(',') && fieldsString !== '*') {
        // Exclude valid cases like "COUNT(Id)", "MAX(Amount)", etc.
        if (!/\w+\s*\(/.test(fieldsString)) {
          errors.push('Missing comma between field names')
        }
      }
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

    return {
      isValid: errors.length === 0,
      errors
    }
  }

  /**
   * Comprehensive SOQL performance analysis
   */
  private async analyzeQueryPerformance(query: string, connection: any): Promise<any> {
    // Extract query components
    const components = this.extractQueryComponents(query)
    
    // Get object metadata for analysis
    const objectMetadata = await this.getObjectMetadata(components.objects, connection)
    
    // Analyze performance characteristics
    const performance = this.analyzePerformanceCharacteristics(components, objectMetadata)
    
    // Generate execution plan
    const executionPlan = this.generateExecutionPlan(components, performance)
    
    // Analyze subqueries if present
    const subqueries = this.analyzeSubqueries(components.subqueries, connection)
    
    // Generate recommendations
    const recommendations = this.generatePerformanceRecommendations(components, performance, objectMetadata)
    
    // Generate warnings
    const warnings = this.generatePerformanceWarnings(components, performance)

    return {
      query,
      isValid: true,
      performance,
      executionPlan,
      subqueries: await subqueries,
      recommendations,
      warnings,
      metadata: {
        objectsAnalyzed: components.objects,
        fieldsAnalyzed: components.fields,
        hasSubqueries: components.subqueries.length > 0,
        analysisTimestamp: new Date().toISOString()
      }
    }
  }

  /**
   * Extract query components for analysis
   */
  private extractQueryComponents(query: string): any {
    return {
      query,
      objects: this.extractObjects(query),
      fields: this.extractFields(query),
      whereFields: this.extractWhereFields(query),
      orderByFields: this.extractOrderByFields(query),
      limitValue: this.extractLimitValue(query),
      subqueries: this.extractSubqueries(query),
      hasWhere: /\bWHERE\b/i.test(query),
      hasOrderBy: /\bORDER\s+BY\b/i.test(query),
      hasLimit: /\bLIMIT\b/i.test(query),
      hasGroupBy: /\bGROUP\s+BY\b/i.test(query),
      hasHaving: /\bHAVING\b/i.test(query)
    }
  }

  /**
   * Get metadata for objects referenced in query
   */
  private async getObjectMetadata(objects: string[], connection: any): Promise<Map<string, any>> {
    const metadata = new Map()
    
    for (const objectName of objects) {
      try {
        const describe = await connection.sobject(objectName).describe()
        metadata.set(objectName, {
          name: describe.name,
          recordCount: this.estimateRecordCount(describe),
          indexedFields: this.identifyIndexedFields(describe),
          customFields: describe.fields?.filter((f: any) => f.custom) || []
        })
      } catch (error) {
        // If we can't describe the object, use defaults
        metadata.set(objectName, {
          name: objectName,
          recordCount: 10000, // Default estimate
          indexedFields: ['Id'], // Only ID is guaranteed
          customFields: []
        })
      }
    }
    
    return metadata
  }

  /**
   * Analyze performance characteristics
   */
  private analyzePerformanceCharacteristics(components: any, metadata: Map<string, any>): any {
    // Calculate selectivity
    const selectivity = this.calculateSelectivity(components, metadata)
    
    // Identify indexed fields being used
    const indexedFields = this.identifyUsedIndexes(components, metadata)
    
    // Estimate query cost
    const estimatedCost = this.estimateQueryCost(components, selectivity, indexedFields)
    
    // Analyze sorting cost
    const sortingCost = this.analyzeSortingCost(components, metadata)

    return {
      estimatedCost,
      selectivity,
      indexedFields,
      sortingCost,
      hasSubqueries: components.subqueries.length > 0,
      estimatedRows: this.estimateResultRows(components, metadata),
      scanType: indexedFields.length > 0 ? 'INDEX_SCAN' : 'TABLE_SCAN'
    }
  }

  /**
   * Generate execution plan steps
   */
  private generateExecutionPlan(components: any, performance: any): any {
    const steps = []
    const estimatedRows = {
      initial: performance.estimatedRows.total,
      afterFilter: performance.estimatedRows.afterFilter,
      final: performance.estimatedRows.final
    }

    // Filter step (WHERE clause)
    if (components.hasWhere) {
      steps.push({
        step: 1,
        operation: 'FILTER',
        description: `Apply WHERE conditions on ${components.whereFields.join(', ')}`,
        estimatedRows: estimatedRows.afterFilter,
        cost: performance.selectivity < 0.1 ? 'LOW' : performance.selectivity < 0.5 ? 'MEDIUM' : 'HIGH'
      })
    }

    // Sort step (ORDER BY clause)
    if (components.hasOrderBy) {
      steps.push({
        step: steps.length + 1,
        operation: 'SORT',
        description: `Sort by ${components.orderByFields.join(', ')}`,
        estimatedRows: estimatedRows.afterFilter,
        cost: performance.sortingCost
      })
    }

    // Limit step
    if (components.hasLimit) {
      steps.push({
        step: steps.length + 1,
        operation: 'LIMIT',
        description: `Limit results to ${components.limitValue} rows`,
        estimatedRows: Math.min(components.limitValue, estimatedRows.afterFilter),
        cost: 'LOW'
      })
    }

    // Select step (field projection)
    steps.push({
      step: steps.length + 1,
      operation: 'SELECT',
      description: `Project fields: ${components.fields.join(', ')}`,
      estimatedRows: estimatedRows.final,
      cost: 'LOW'
    })

    return {
      steps,
      estimatedRows,
      totalSteps: steps.length
    }
  }

  /**
   * Analyze subqueries performance
   */
  private async analyzeSubqueries(subqueries: string[], connection: any): Promise<any[]> {
    const analyses = []
    
    for (const subquery of subqueries) {
      try {
        const subComponents = this.extractQueryComponents(subquery)
        const subMetadata = await this.getObjectMetadata(subComponents.objects, connection)
        const subPerformance = this.analyzePerformanceCharacteristics(subComponents, subMetadata)
        
        analyses.push({
          query: subquery,
          performance: subPerformance,
          objects: subComponents.objects
        })
      } catch (error) {
        analyses.push({
          query: subquery,
          error: 'Unable to analyze subquery',
          performance: { estimatedCost: 'UNKNOWN' }
        })
      }
    }
    
    return analyses
  }

  /**
   * Generate performance recommendations
   */
  private generatePerformanceRecommendations(components: any, performance: any, metadata: Map<string, any>): string[] {
    const recommendations = []

    // SELECT * recommendation
    if (components.fields.includes('*')) {
      recommendations.push('Avoid SELECT * - specify only needed fields')
    }

    // LIMIT recommendation
    if (!components.hasLimit && performance.estimatedRows.total > 1000) {
      recommendations.push('Add LIMIT clause to control result size')
    }

    // Index recommendations for WHERE fields
    components.whereFields.forEach((field: string) => {
      if (!performance.indexedFields.includes(field)) {
        recommendations.push(`Consider creating index on ${field} field`)
      }
    })

    // ORDER BY index recommendations
    if (components.hasOrderBy && components.orderByFields.length > 0) {
      const orderField = components.orderByFields[0]
      if (!performance.indexedFields.includes(orderField)) {
        recommendations.push(`Consider adding index on ${orderField} field for ORDER BY`)
      }
    }

    // Subquery recommendations
    if (components.subqueries.length > 1) {
      recommendations.push('Multiple subqueries may impact performance')
    }

    // Selectivity recommendations
    if (performance.selectivity > 0.7) {
      recommendations.push('Query may return large result set - consider adding more selective filters')
    }

    return recommendations
  }

  /**
   * Generate performance warnings
   */
  private generatePerformanceWarnings(components: any, performance: any): string[] {
    const warnings = []

    // Large date range warnings
    if (components.whereFields.some((field: string) => /date/i.test(field))) {
      const hasLargeDateRange = /LAST_N_DAYS:\s*([3-9]\d{2,}|\d{4,})/i.test(components.query) ||
                               /LAST_N_MONTHS:\s*([2-9]\d+|\d{3,})/i.test(components.query)
      if (hasLargeDateRange) {
        warnings.push('Large date range query may be slow')
      }
    }

    // High cost warnings
    if (performance.estimatedCost === 'HIGH') {
      warnings.push('Query estimated to have high execution cost')
    }

    // Large result set warnings
    if (performance.estimatedRows.total > 10000 && !components.hasLimit) {
      warnings.push('Query may return very large result set')
    }

    return warnings
  }

  // Helper methods (reusing some from ValidateSoqlTool but with performance focus)
  
  private extractObjects(query: string): string[] {
    const objects: string[] = []
    const fromMatch = query.match(/FROM\s+(\w+)/i)
    if (fromMatch?.[1]) {
      objects.push(fromMatch[1])
    }
    return objects
  }

  private extractFields(query: string): string[] {
    const selectMatch = query.match(/SELECT\s+(.*?)\s+FROM/i)
    if (!selectMatch?.[1]) return []

    const fieldsPart = selectMatch[1]
    if (fieldsPart.trim() === '*') return ['*']

    return fieldsPart.split(',').map(field => {
      const cleanField = field.trim().replace(/\(.*?\)/g, '').split('.').pop() || ''
      return cleanField.trim()
    }).filter(field => field.length > 0)
  }

  private extractWhereFields(query: string): string[] {
    const whereMatch = query.match(/WHERE\s+(.*?)(?:\s+ORDER\s+BY|\s+GROUP\s+BY|\s+LIMIT|$)/i)
    if (!whereMatch?.[1]) return []

    const whereClause = whereMatch[1]
    const fieldMatches = whereClause.match(/\b[A-Za-z_][A-Za-z0-9_]*\b/g) || []
    return fieldMatches.filter(field => 
      !['AND', 'OR', 'NOT', 'IN', 'LIKE', 'NULL', 'TRUE', 'FALSE'].includes(field.toUpperCase())
    )
  }

  private extractOrderByFields(query: string): string[] {
    const orderByMatch = query.match(/ORDER\s+BY\s+(.*?)(?:\s+LIMIT|$)/i)
    if (!orderByMatch?.[1]) return []

    const orderByClause = orderByMatch[1]
    return orderByClause.split(',').map(field => {
      return field.trim().replace(/\s+(ASC|DESC)$/i, '').trim()
    }).filter(field => field.length > 0)
  }

  private extractLimitValue(query: string): number | null {
    const limitMatch = query.match(/LIMIT\s+(\d+)/i)
    return limitMatch?.[1] ? parseInt(limitMatch[1], 10) : null
  }

  private extractSubqueries(query: string): string[] {
    const subqueries: string[] = []
    const subqueryMatches = query.matchAll(/\(\s*(SELECT[^)]+)\)/gi)
    for (const match of subqueryMatches) {
      if (match[1]) {
        subqueries.push(match[1])
      }
    }
    return subqueries
  }

  private estimateRecordCount(describe: any): number {
    // This is a simplified estimation - in reality you'd query for actual counts
    // or use org statistics if available
    if (describe.name === 'Account') return 50000
    if (describe.name === 'Contact') return 100000
    if (describe.name === 'Lead') return 75000
    if (describe.name === 'Opportunity') return 25000
    return 10000 // Default estimate
  }

  private identifyIndexedFields(describe: any): string[] {
    const indexed = ['Id'] // ID is always indexed
    
    // Common indexed fields (this would be more sophisticated in practice)
    const commonIndexed = ['Name', 'Email', 'CreatedDate', 'LastModifiedDate', 'OwnerId']
    
    if (describe.fields) {
      describe.fields.forEach((field: any) => {
        if (field.type === 'reference' || field.unique || commonIndexed.includes(field.name)) {
          indexed.push(field.name)
        }
      })
    }
    
    return indexed
  }

  private calculateSelectivity(components: any, metadata: Map<string, any>): number {
    // If there's no WHERE clause, selectivity is based on result size needs
    if (components.whereFields.length === 0) {
      // No filtering means returning many records, but that's not necessarily bad performance
      return components.hasLimit ? Math.min(0.1, components.limitValue / 10000) : 0.5
    }
    
    // Simplified selectivity calculation for WHERE clauses
    let selectivity = 1.0 // Start with 100% (all records)
    
    components.whereFields.forEach((field: string) => {
      // Reduce selectivity based on field type and common patterns
      if (field === 'Id') selectivity *= 0.001 // Very selective
      else if (field.includes('Date')) selectivity *= 0.1
      else if (field === 'Type' || field === 'Status') selectivity *= 0.2
      else selectivity *= 0.3 // Generic field
    })
    
    return Math.max(0.001, selectivity) // Minimum 0.1% selectivity
  }

  private identifyUsedIndexes(components: any, metadata: Map<string, any>): string[] {
    const usedIndexes: string[] = []
    
    for (const [objectName, objMetadata] of metadata) {
      const indexedFields = objMetadata.indexedFields || []
      components.whereFields.forEach((field: string) => {
        if (indexedFields.includes(field)) {
          usedIndexes.push(field)
        }
      })
    }
    
    return [...new Set(usedIndexes)]
  }

  private estimateQueryCost(components: any, selectivity: number, indexedFields: string[]): string {
    let cost = 0
    
    // Base cost for table scan vs index scan
    cost += indexedFields.length > 0 ? 0 : 1
    
    // Selectivity impact (but not for simple queries without WHERE)
    if (components.whereFields.length > 0) {
      if (selectivity > 0.5) cost += 3
      else if (selectivity > 0.1) cost += 1
    }
    
    // Sorting cost
    if (components.hasOrderBy && !indexedFields.some(field => components.orderByFields.includes(field))) {
      cost += 2
    }
    
    // Subquery cost
    cost += components.subqueries.length * 2
    
    // Field count impact
    if (components.fields.includes('*')) cost += 1
    else if (components.fields.length > 10) cost += 1
    
    // Date range queries
    if (components.whereFields.some((field: string) => /date/i.test(field))) {
      const hasLargeDateRange = /LAST_N_DAYS:\s*([3-9]\d{2,}|\d{4,})/i.test(components.query) ||
                               /LAST_N_MONTHS:\s*([2-9]\d+|\d{3,})/i.test(components.query)
      if (hasLargeDateRange) cost += 3
    }
    
    // Large result set without LIMIT (only if selecting many fields)
    if (!components.hasLimit && components.whereFields.length === 0 && 
        (components.fields.includes('*') || components.fields.length > 5)) {
      cost += 1 // Add some cost for potentially large result sets
    }
    
    if (cost <= 1) return 'LOW'
    if (cost <= 3) return 'MEDIUM'
    return 'HIGH'
  }

  private analyzeSortingCost(components: any, metadata: Map<string, any>): string {
    if (!components.hasOrderBy) return 'NONE'
    
    const orderField = components.orderByFields[0]
    let isIndexed = false
    
    for (const [, objMetadata] of metadata) {
      if (objMetadata.indexedFields?.includes(orderField)) {
        isIndexed = true
        break
      }
    }
    
    return isIndexed ? 'LOW' : 'MEDIUM'
  }

  private estimateResultRows(components: any, metadata: Map<string, any>): any {
    let totalRows = 0
    
    // Sum up estimated rows from all objects
    for (const [, objMetadata] of metadata) {
      totalRows += objMetadata.recordCount || 10000
    }
    
    const afterFilter = Math.ceil(totalRows * this.calculateSelectivity(components, metadata))
    const final = components.hasLimit ? Math.min(components.limitValue, afterFilter) : afterFilter
    
    return {
      total: totalRows,
      afterFilter,
      final
    }
  }
}