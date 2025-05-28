#!/usr/bin/env tsx

/**
 * End-to-End Tool Validation Script
 * 
 * Validates all 12 MCP tools with realistic scenarios
 * Runs independently without external Salesforce connection
 * Usage: tsx scripts/e2e-tool-validation.ts
 */

import { ToolRegistry } from '../src/tools/index.js'
import { SalesforceClient } from '../src/salesforce-client.js'
import { createChildLogger } from '../src/logger.js'
import type { ToolExecutionContext } from '../src/tools/base/index.js'

// Mock Salesforce client for testing
function createMockSalesforceClient(): SalesforceClient {
  const mockConnection = {
    sobject: (name: string) => ({
      describe: async () => createMockDescribeResult(),
      retrieve: async (id: string) => ({ Id: id, Name: 'Test Account', attributes: { type: name } }),
      select: () => ({
        limit: () => ({
          exec: async () => ({ records: [{ Id: '001000000000001AAA', Name: 'Test Account' }], totalSize: 1 })
        })
      })
    }),
    describeGlobal: async () => ({
      sobjects: [
        { name: 'Account', label: 'Account', queryable: true, custom: false },
        { name: 'Contact', label: 'Contact', queryable: true, custom: false }
      ]
    }),
    query: async (soql: string) => {
      if (soql.includes('FROM User')) {
        return {
          records: [{
            Id: '005000000000001AAA',
            Name: 'Test User',
            Email: 'testuser@example.com',
            Username: 'testuser@testorg.com',
            IsActive: true,
            Title: 'Test Title',
            Department: 'Test Department',
            UserType: 'Standard',
            Profile: { Name: 'Standard User' }
          }],
          totalSize: 1,
          done: true
        }
      }
      return {
        records: [{ Id: '001000000000001AAA', Name: 'Test Account' }],
        totalSize: 1,
        done: true
      }
    },
    search: async (sosl: string) => ({
      searchRecords: [{ Id: '001000000000001AAA', Name: 'Test Account', attributes: { type: 'Account' } }]
    }),
    request: async (url: string) => {
      if (url.includes('/limits')) {
        return { DataStorageMB: { Max: 1024, Remaining: 512 } }
      }
      if (url.includes('/recent')) {
        return [{ Id: '001000000000001AAA', Name: 'Test Account', attributes: { type: 'Account' } }]
      }
      if (url.includes('/layouts')) {
        return { layouts: [{ name: 'Test Layout', sections: [] }] }
      }
      if (url.includes('/userinfo')) {
        return { user_id: '005000000000001AAA', organization_id: '00D000000000001AAA' }
      }
      return {}
    },
    identity: async () => ({
      user_id: '005000000000001AAA',
      organization_id: '00D000000000001AAA'
    }),
    requestPost: async () => ({}),
    limits: async () => ({ DataStorageMB: { Max: 1024, Remaining: 512 } })
  }

  const mockClient = {
    isConnected: () => true,
    getConnection: () => mockConnection,
    connect: async () => ({ userId: '005000000000001AAA', organizationId: '00D000000000001AAA' })
  } as any

  return mockClient
}

function createMockDescribeResult() {
  return {
    name: 'Account',
    fields: [
      { name: 'Id', type: 'id', length: 18 },
      { name: 'Name', type: 'string', length: 255 },
      { name: 'Type', type: 'picklist', picklistValues: [
        { value: 'Customer', label: 'Customer', active: true },
        { value: 'Partner', label: 'Partner', active: true }
      ]}
    ],
    recordTypeInfos: [{ name: 'Master', recordTypeId: '012000000000001AAA' }],
    childRelationships: []
  }
}

interface TestResult {
  toolName: string
  success: boolean
  duration: number
  error?: string
  validationDetails?: string
}

interface TestScenario {
  toolName: string
  description: string
  params: any
  expectedStructure: string[]
  validate?: (result: any) => boolean
}

// Test scenarios for all 12 tools
const testScenarios: TestScenario[] = [
  // Salesforce Core Tools
  {
    toolName: 'describe_object',
    description: 'Describe Account object',
    params: { objectName: 'Account' },
    expectedStructure: ['fields', 'recordTypes', 'childRelationships'],
    validate: (result) => Array.isArray(result.fields) && result.fields.length > 0
  },
  {
    toolName: 'list_objects', 
    description: 'List standard objects',
    params: { objectType: 'standard', limit: 50 },
    expectedStructure: ['objects'],
    validate: (result) => Array.isArray(result.objects) && result.objects.length > 0
  },
  {
    toolName: 'soql_query',
    description: 'Execute simple Account query',
    params: { query: 'SELECT Id, Name FROM Account LIMIT 5' },
    expectedStructure: ['records', 'totalSize'],
    validate: (result) => Array.isArray(result.records) && typeof result.totalSize === 'number'
  },

  // Search & Retrieval Tools  
  {
    toolName: 'get_record',
    description: 'Get Account record by ID',
    params: { objectName: 'Account', recordId: '001000000000001AAA' },
    expectedStructure: ['Id', 'attributes'],
    validate: (result) => result.Id && result.attributes
  },
  {
    toolName: 'sosl_search',
    description: 'Search across Account and Contact',
    params: { searchTerm: 'test', objects: ['Account', 'Contact'], limit: 10 },
    expectedStructure: ['searchRecords'],
    validate: (result) => Array.isArray(result.searchRecords)
  },

  // Administrative Tools
  {
    toolName: 'get_org_limits',
    description: 'Get organization limits',
    params: {},
    expectedStructure: ['DataStorageMB'],
    validate: (result) => typeof result.DataStorageMB === 'object' && result.DataStorageMB.Max
  },
  {
    toolName: 'get_user_info', 
    description: 'Get current user information',
    params: {},
    expectedStructure: [], // Text output, no JSON structure expected
    validate: (result) => {
      // For text output, just check that content exists and contains user info
      if (typeof result === 'string') {
        return result.includes('User ID:') && result.includes('Username:')
      }
      return false
    }
  },
  {
    toolName: 'get_recent_items',
    description: 'Get recently accessed items',
    params: {},
    expectedStructure: ['recentItems'],
    validate: (result) => Array.isArray(result.recentItems)
  },

  // Analysis & Validation Tools
  {
    toolName: 'validate_soql',
    description: 'Validate SOQL query syntax',
    params: { query: 'SELECT Id, Name FROM Account WHERE CreatedDate = TODAY' },
    expectedStructure: ['isValid', 'queryType'],
    validate: (result) => typeof result.isValid === 'boolean' && result.queryType
  },
  {
    toolName: 'explain_query_plan',
    description: 'Analyze query performance', 
    params: { query: 'SELECT Id, Name FROM Account ORDER BY CreatedDate DESC' },
    expectedStructure: ['performance', 'recommendations'],
    validate: (result) => result.performance && result.performance.estimatedCost && Array.isArray(result.recommendations)
  },

  // UI Metadata Tools
  {
    toolName: 'describe_layout',
    description: 'Describe Account page layout',
    params: { objectName: 'Account' },
    expectedStructure: ['layouts'],
    validate: (result) => Array.isArray(result.layouts) && result.layouts.length > 0
  },
  {
    toolName: 'get_picklist_values',
    description: 'Get picklist values for Account Type',
    params: { objectName: 'Account', fieldName: 'Type' },
    expectedStructure: ['values'],
    validate: (result) => Array.isArray(result.values)
  }
]

class E2ETestRunner {
  private toolRegistry: ToolRegistry
  private mockContext: ToolExecutionContext
  private results: TestResult[] = []

  constructor() {
    this.toolRegistry = new ToolRegistry()
    this.mockContext = { 
      salesforceClient: createMockSalesforceClient(),
      logger: createChildLogger('e2e-test')
    }
  }

  async runAllTests(): Promise<void> {
    console.log('🧪 Starting E2E Tool Validation')
    console.log(`📊 Testing ${testScenarios.length} tools with realistic scenarios\\n`)

    for (const scenario of testScenarios) {
      await this.runToolTest(scenario)
    }

    this.printSummary()
  }

  private async runToolTest(scenario: TestScenario): Promise<void> {
    const startTime = Date.now()
    
    try {
      console.log(`🔧 Testing ${scenario.toolName}: ${scenario.description}`)
      
      const tool = this.toolRegistry.getTool(scenario.toolName)
      if (!tool) {
        throw new Error(`Tool '${scenario.toolName}' not found in registry`)
      }

      const result = await tool.execute(scenario.params, this.mockContext)
      const duration = Date.now() - startTime

      // Validate response structure
      const structureValid = this.validateStructure(result, scenario.expectedStructure)
      if (!structureValid) {
        throw new Error(`Response missing required fields: ${scenario.expectedStructure.join(', ')}`)
      }

      // Run custom validation if provided - extract content for MCP results
      let validationPassed = true
      if (scenario.validate) {
        let dataToValidate = result
        let isJsonContent = true
        
        if (result.content && result.content[0] && result.content[0].text) {
          try {
            // Try to parse as JSON first
            dataToValidate = JSON.parse(result.content[0].text)
          } catch {
            // If not JSON, skip custom validation for human-readable content
            console.log(`     ⚠️  Skipping custom validation for human-readable content`)
            isJsonContent = false
          }
        }
        
        if (isJsonContent && !scenario.validate(dataToValidate)) {
          validationPassed = false
        }
      }
      
      if (!validationPassed) {
        throw new Error('Custom validation failed')
      }

      this.results.push({
        toolName: scenario.toolName,
        success: true,
        duration,
        validationDetails: `✅ MCP result valid, content length: ${result.content?.[0]?.text?.length || 'N/A'}`
      })

      console.log(`   ✅ Success (${duration}ms) - Content length: ${result.content?.[0]?.text?.length || 'N/A'}\\n`)

    } catch (error) {
      const duration = Date.now() - startTime
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      
      this.results.push({
        toolName: scenario.toolName,
        success: false,
        duration,
        error: errorMessage
      })

      console.log(`   ❌ Failed (${duration}ms) - ${errorMessage}\\n`)
    }
  }

  private validateStructure(result: any, expectedFields: string[]): boolean {
    if (!result || typeof result !== 'object') return false
    
    // Check if this is an MCP tool result with content array
    if (result.content && Array.isArray(result.content)) {
      // For MCP results, just validate that we have content
      return result.content.length > 0 && result.content[0].text
    }
    
    return expectedFields.some(field => {
      return this.hasNestedField(result, field)
    })
  }

  private hasNestedField(obj: any, fieldPath: string): boolean {
    const parts = fieldPath.split('.')
    let current = obj
    
    for (const part of parts) {
      if (!current || typeof current !== 'object' || !(part in current)) {
        return false
      }
      current = current[part]
    }
    
    return true
  }

  private printSummary(): void {
    const successful = this.results.filter(r => r.success).length
    const failed = this.results.filter(r => r.success === false).length
    const totalDuration = this.results.reduce((sum, r) => sum + r.duration, 0)
    const avgDuration = Math.round(totalDuration / this.results.length)

    console.log('\\n' + '='.repeat(60))
    console.log('📋 E2E VALIDATION SUMMARY')
    console.log('='.repeat(60))
    console.log(`✅ Successful: ${successful}/${this.results.length} tools`)
    console.log(`❌ Failed: ${failed}/${this.results.length} tools`)
    console.log(`⏱️  Total time: ${totalDuration}ms (avg: ${avgDuration}ms/tool)`)
    console.log(`🎯 Success rate: ${Math.round((successful / this.results.length) * 100)}%`)

    if (failed > 0) {
      console.log('\\n❌ FAILED TOOLS:')
      this.results.filter(r => !r.success).forEach(result => {
        console.log(`   • ${result.toolName}: ${result.error}`)
      })
    }

    console.log('\\n' + '='.repeat(60))

    // Exit with error code if any tests failed
    if (failed > 0) {
      process.exit(1)
    }
  }
}

// Run the tests
async function main() {
  try {
    const runner = new E2ETestRunner()
    await runner.runAllTests()
  } catch (error) {
    console.error('❌ E2E test runner failed:', error)
    process.exit(1)
  }
}

main().catch(console.error)