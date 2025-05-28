/*
 * Copyright (C) 2025 Ontic Pte. Ltd. (realfast.ai)
 * Use of this software is governed by the Business Source License included in the LICENSE.TXT file and at www.mariadb.com/bsl11.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { ToolRegistry, DescribeObjectTool, ListObjectsTool, SoqlQueryTool, GetRecordTool, SoslSearchTool, GetPicklistValuesTool, ValidateSoqlTool, ExplainQueryPlanTool, GetOrgLimitsTool, GetUserInfoTool, GetRecentItemsTool, DescribeLayoutTool, SearchResultFormatter, RecordSummaryFormatter, type ToolExecutionContext } from './tools.js'
import { SalesforceClient } from './salesforce-client.js'
import { SalesforceConfig } from './config.js'
import { createChildLogger } from './logger.js'
import { ToolError } from './errors.js'

describe('ToolRegistry', () => {
  let toolRegistry: ToolRegistry

  beforeEach(() => {
    toolRegistry = new ToolRegistry()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('should register tools by default', () => {
    const tools = toolRegistry.listTools()
    
    expect(tools).toHaveLength(12)
    
    const describeObjectTool = tools.find(t => t.name === 'describe_object')
    expect(describeObjectTool).toBeDefined()
    expect(describeObjectTool?.description).toContain('Describes a Salesforce object')
    
    const listObjectsTool = tools.find(t => t.name === 'list_objects')
    expect(listObjectsTool).toBeDefined()
    expect(listObjectsTool?.description).toContain('Lists all available Salesforce objects')
    
    const getPicklistValuesTool = tools.find(t => t.name === 'get_picklist_values')
    expect(getPicklistValuesTool).toBeDefined()
    expect(getPicklistValuesTool?.description).toContain('picklist values')
    
    const validateSoqlTool = tools.find(t => t.name === 'validate_soql')
    expect(validateSoqlTool).toBeDefined()
    expect(validateSoqlTool?.description).toContain('Validate SOQL syntax')
    
    const explainQueryPlanTool = tools.find(t => t.name === 'explain_query_plan')
    expect(explainQueryPlanTool).toBeDefined()
    expect(explainQueryPlanTool?.description).toContain('Analyze SOQL query performance')
  })

  test('should get tool by name', () => {
    const tool = toolRegistry.getTool('describe_object')
    
    expect(tool).toBeDefined()
    expect(tool).toBeInstanceOf(DescribeObjectTool)
  })

  test('should return undefined for unknown tool', () => {
    const tool = toolRegistry.getTool('unknown_tool')
    
    expect(tool).toBeUndefined()
  })

  test('should throw error when executing unknown tool', async () => {
    const mockClient = createMockSalesforceClient()
    
    await expect(
      toolRegistry.executeTool('unknown_tool', {}, { salesforceClient: mockClient })
    ).rejects.toThrow("Tool 'unknown_tool' not found")
  })
})

describe('DescribeObjectTool', () => {
  let tool: DescribeObjectTool
  let mockClient: SalesforceClient

  beforeEach(() => {
    tool = new DescribeObjectTool()
    mockClient = createMockSalesforceClient()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('should have correct tool definition', () => {
    const definition = tool.definition
    
    expect(definition.name).toBe('describe_object')
    expect(definition.description).toContain('Describes a Salesforce object')
    expect(definition.inputSchema.type).toBe('object')
    expect(definition.inputSchema.properties.objectName).toBeDefined()
    expect(definition.inputSchema.required).toEqual(['objectName'])
    expect(definition.annotations?.readOnlyHint).toBe(true)
    expect(definition.annotations?.destructiveHint).toBe(false)
  })

  test('should connect to Salesforce if not connected', async () => {
    const mockConnection = {
      sobject: vi.fn().mockReturnValue({
        describe: vi.fn().mockResolvedValue(createMockDescribeResult())
      })
    }
    
    vi.spyOn(mockClient, 'isConnected').mockReturnValue(false)
    vi.spyOn(mockClient, 'connect').mockResolvedValue()
    vi.spyOn(mockClient, 'getConnection').mockReturnValue(mockConnection as any)
    
    await tool.execute({ objectName: 'Account' }, { salesforceClient: mockClient })
    
    expect(mockClient.connect).toHaveBeenCalled()
    expect(mockClient.getConnection).toHaveBeenCalled()
  })

  test('should describe Salesforce object successfully', async () => {
    const mockDescribeResult = createMockDescribeResult()
    const mockConnection = {
      sobject: vi.fn().mockReturnValue({
        describe: vi.fn().mockResolvedValue(mockDescribeResult)
      })
    }
    
    vi.spyOn(mockClient, 'isConnected').mockReturnValue(true)
    vi.spyOn(mockClient, 'getConnection').mockReturnValue(mockConnection as any)
    
    const result = await tool.execute({ objectName: 'Account' }, { salesforceClient: mockClient })
    
    expect(mockConnection.sobject).toHaveBeenCalledWith('Account')
    expect(result.content).toHaveLength(1)
    expect(result.content[0].type).toBe('text')
    
    const parsedResult = JSON.parse(result.content[0].text)
    expect(parsedResult.name).toBe('Account')
    expect(parsedResult.label).toBe('Account')
    expect(parsedResult.fields).toHaveLength(2)
  })

  test('should handle error when no connection available', async () => {
    vi.spyOn(mockClient, 'isConnected').mockReturnValue(true)
    vi.spyOn(mockClient, 'getConnection').mockReturnValue(null)
    
    const result = await tool.execute({ objectName: 'Account' }, { salesforceClient: mockClient })
    
    expect(result.content[0].text).toContain('Error describing object Account')
    expect(result.content[0].text).toContain('No Salesforce connection available')
  })

  test('should handle Salesforce API error', async () => {
    const mockConnection = {
      sobject: vi.fn().mockReturnValue({
        describe: vi.fn().mockRejectedValue(new Error('INVALID_TYPE: sobject type Account does not exist'))
      })
    }
    
    vi.spyOn(mockClient, 'isConnected').mockReturnValue(true)
    vi.spyOn(mockClient, 'getConnection').mockReturnValue(mockConnection as any)
    
    const result = await tool.execute({ objectName: 'InvalidObject' }, { salesforceClient: mockClient })
    
    expect(result.content[0].text).toContain('Error describing object InvalidObject')
    expect(result.content[0].text).toContain('INVALID_TYPE')
  })

  test('should limit fields to first 10 in response', async () => {
    const mockDescribeResult = {
      ...createMockDescribeResult(),
      fields: Array.from({ length: 15 }, (_, i) => ({
        name: `Field${i}`,
        label: `Field ${i}`,
        type: 'string',
        createable: true,
        updateable: true,
        nillable: true,
        unique: false,
        custom: false
      }))
    }
    
    const mockConnection = {
      sobject: vi.fn().mockReturnValue({
        describe: vi.fn().mockResolvedValue(mockDescribeResult)
      })
    }
    
    vi.spyOn(mockClient, 'isConnected').mockReturnValue(true)
    vi.spyOn(mockClient, 'getConnection').mockReturnValue(mockConnection as any)
    
    const result = await tool.execute({ objectName: 'Account' }, { salesforceClient: mockClient })
    const parsedResult = JSON.parse(result.content[0].text)
    
    expect(parsedResult.fields).toHaveLength(10)
  })
})

describe('ListObjectsTool', () => {
  let tool: ListObjectsTool
  let mockClient: SalesforceClient

  beforeEach(() => {
    tool = new ListObjectsTool()
    mockClient = createMockSalesforceClient()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('should have correct tool definition', () => {
    const definition = tool.definition
    
    expect(definition.name).toBe('list_objects')
    expect(definition.description).toContain('Lists all available Salesforce objects')
    expect(definition.inputSchema.properties.objectType).toBeDefined()
    expect(definition.inputSchema.properties.limit).toBeDefined()
    expect(definition.inputSchema.required).toEqual([])
    expect(definition.annotations?.readOnlyHint).toBe(true)
    expect(definition.annotations?.destructiveHint).toBe(false)
  })

  test('should list all objects with default parameters', async () => {
    // Mock successful connection and describe global
    vi.spyOn(mockClient, 'isConnected').mockReturnValue(true)
    vi.spyOn(mockClient, 'getConnection').mockReturnValue({
      describeGlobal: vi.fn().mockResolvedValue({
        sobjects: [
          {
            name: 'Account',
            label: 'Account',
            labelPlural: 'Accounts',
            keyPrefix: '001',
            createable: true,
            updateable: true,
            deletable: true,
            queryable: true,
            searchable: true,
            custom: false,
            deprecatedAndHidden: false
          },
          {
            name: 'Custom__c',
            label: 'Custom Object',
            labelPlural: 'Custom Objects',
            keyPrefix: 'a00',
            createable: true,
            updateable: true,
            deletable: true,
            queryable: true,
            searchable: true,
            custom: true,
            deprecatedAndHidden: false
          }
        ]
      })
    } as any)

    const result = await tool.execute({}, { salesforceClient: mockClient })
    
    expect(result.content).toHaveLength(1)
    expect(result.content[0].type).toBe('text')
    
    const parsedResult = JSON.parse(result.content[0].text)
    expect(parsedResult.totalCount).toBe(2)
    expect(parsedResult.returnedCount).toBe(2)
    expect(parsedResult.objectType).toBe('all')
    expect(parsedResult.objects).toHaveLength(2)
    
    const account = parsedResult.objects.find((obj: any) => obj.name === 'Account')
    expect(account).toBeDefined()
    expect(account.custom).toBe(false)
    
    const customObj = parsedResult.objects.find((obj: any) => obj.name === 'Custom__c')
    expect(customObj).toBeDefined()
    expect(customObj.custom).toBe(true)
  })

  test('should filter standard objects only', async () => {
    // Mock successful connection and describe global
    vi.spyOn(mockClient, 'isConnected').mockReturnValue(true)
    vi.spyOn(mockClient, 'getConnection').mockReturnValue({
      describeGlobal: vi.fn().mockResolvedValue({
        sobjects: [
          { name: 'Account', custom: false, label: 'Account', labelPlural: 'Accounts' },
          { name: 'Custom__c', custom: true, label: 'Custom', labelPlural: 'Customs' }
        ]
      })
    } as any)

    const result = await tool.execute({ objectType: 'standard' }, { salesforceClient: mockClient })
    
    const parsedResult = JSON.parse(result.content[0].text)
    expect(parsedResult.totalCount).toBe(1)
    expect(parsedResult.returnedCount).toBe(1)
    expect(parsedResult.objectType).toBe('standard')
    expect(parsedResult.objects[0].name).toBe('Account')
    expect(parsedResult.objects[0].custom).toBe(false)
  })

  test('should filter custom objects only', async () => {
    // Mock successful connection and describe global
    vi.spyOn(mockClient, 'isConnected').mockReturnValue(true)
    vi.spyOn(mockClient, 'getConnection').mockReturnValue({
      describeGlobal: vi.fn().mockResolvedValue({
        sobjects: [
          { name: 'Account', custom: false, label: 'Account', labelPlural: 'Accounts' },
          { name: 'Custom__c', custom: true, label: 'Custom', labelPlural: 'Customs' }
        ]
      })
    } as any)

    const result = await tool.execute({ objectType: 'custom' }, { salesforceClient: mockClient })
    
    const parsedResult = JSON.parse(result.content[0].text)
    expect(parsedResult.totalCount).toBe(1)
    expect(parsedResult.returnedCount).toBe(1)
    expect(parsedResult.objectType).toBe('custom')
    expect(parsedResult.objects[0].name).toBe('Custom__c')
    expect(parsedResult.objects[0].custom).toBe(true)
  })

  test('should respect limit parameter', async () => {
    // Mock successful connection and describe global with many objects
    const manyObjects = Array.from({ length: 150 }, (_, i) => ({
      name: `Object${i}`,
      custom: false,
      label: `Object ${i}`,
      labelPlural: `Objects ${i}`
    }))

    vi.spyOn(mockClient, 'isConnected').mockReturnValue(true)
    vi.spyOn(mockClient, 'getConnection').mockReturnValue({
      describeGlobal: vi.fn().mockResolvedValue({ sobjects: manyObjects })
    } as any)

    const result = await tool.execute({ limit: 50 }, { salesforceClient: mockClient })
    
    const parsedResult = JSON.parse(result.content[0].text)
    expect(parsedResult.totalCount).toBe(150)
    expect(parsedResult.returnedCount).toBe(50)
    expect(parsedResult.objects).toHaveLength(50)
  })

  test('should handle connection error', async () => {
    vi.spyOn(mockClient, 'isConnected').mockReturnValue(false)
    vi.spyOn(mockClient, 'connect').mockRejectedValue(new Error('Connection failed'))

    const result = await tool.execute({}, { salesforceClient: mockClient })
    
    expect(result.content[0].text).toContain('Error listing objects: Connection failed')
  })

  test('should handle no connection available', async () => {
    vi.spyOn(mockClient, 'isConnected').mockReturnValue(true)
    vi.spyOn(mockClient, 'getConnection').mockReturnValue(null)

    const result = await tool.execute({}, { salesforceClient: mockClient })
    
    expect(result.content[0].text).toContain('Error listing objects: No Salesforce connection available')
  })
})

describe('SoqlQueryTool', () => {
  let tool: SoqlQueryTool
  let mockClient: SalesforceClient
  let context: ToolExecutionContext

  beforeEach(() => {
    tool = new SoqlQueryTool()
    mockClient = createMockSalesforceClient()
    context = { salesforceClient: mockClient }
  })

  test('should have correct tool definition', () => {
    expect(tool.definition.name).toBe('soql_query')
    expect(tool.definition.description).toContain('Execute a SOQL query')
    expect(tool.definition.inputSchema.properties.query).toBeDefined()
    expect(tool.definition.inputSchema.properties.limit).toBeDefined()
    expect(tool.definition.inputSchema.required).toContain('query')
  })

  test('should execute simple SOQL query successfully', async () => {
    const mockQueryResult = {
      totalSize: 2,
      done: true,
      records: [
        { Id: '001000000001', Name: 'Test Account 1', attributes: { type: 'Account' } },
        { Id: '001000000002', Name: 'Test Account 2', attributes: { type: 'Account' } }
      ]
    }

    const mockConnection = {
      query: vi.fn().mockResolvedValue(mockQueryResult)
    }
    
    ;(mockClient as any).connectionHandler = {
      connection: mockConnection
    }
    mockClient.isConnected = vi.fn().mockReturnValue(true)
    mockClient.getConnection = vi.fn().mockReturnValue(mockConnection)

    const result = await tool.execute({ 
      query: 'SELECT Id, Name FROM Account LIMIT 2' 
    }, context)

    expect(result.content).toHaveLength(1)
    expect(result.content[0].text).toContain('Query executed successfully')
    expect(result.content[0].text).toContain('Test Account 1')
    expect(result.content[0].text).toContain('Test Account 2')
    expect(result.content[0].text).toContain('Total records: 2')
  })

  test('should apply pagination limit', async () => {
    const mockQueryResult = {
      totalSize: 1000,
      done: false,
      records: Array.from({ length: 50 }, (_, i) => ({
        Id: `001${String(i).padStart(12, '0')}`,
        Name: `Account ${i + 1}`,
        attributes: { type: 'Account' }
      })),
      nextRecordsUrl: '/services/data/v59.0/query/01g000000000001-2000'
    }

    const mockConnection = {
      query: vi.fn().mockResolvedValue(mockQueryResult)
    }
    
    ;(mockClient as any).connectionHandler = {
      connection: mockConnection
    }
    mockClient.isConnected = vi.fn().mockReturnValue(true)
    mockClient.getConnection = vi.fn().mockReturnValue(mockConnection)

    const result = await tool.execute({ 
      query: 'SELECT Id, Name FROM Account',
      limit: 50
    }, context)

    expect(result.content[0].text).toContain('Showing 50 records')
    expect(result.content[0].text).toContain('1000 total records available')
  })

  test('should prevent SQL injection attempts', async () => {
    const maliciousQuery = "SELECT Id FROM Account; DROP TABLE User__c; --"
    
    await expect(tool.execute({ query: maliciousQuery }, context))
      .rejects.toThrow('SOQL query contains potentially unsafe content')
  })

  test('should validate SOQL syntax', async () => {
    const invalidQuery = "SELCT Id FROM Account"
    
    await expect(tool.execute({ query: invalidQuery }, context))
      .rejects.toThrow('Invalid SOQL query syntax')
  })

  test('should handle query execution errors', async () => {
    const mockConnection = {
      query: vi.fn().mockRejectedValue(new Error('INVALID_FIELD: No such column Name2'))
    }
    
    ;(mockClient as any).connectionHandler = {
      connection: mockConnection
    }
    mockClient.isConnected = vi.fn().mockReturnValue(true)
    mockClient.getConnection = vi.fn().mockReturnValue(mockConnection)

    await expect(tool.execute({ 
      query: 'SELECT Id, Name2 FROM Account' 
    }, context)).rejects.toThrow('SOQL query execution failed')
  })

  test('should handle no connection', async () => {
    mockClient.isConnected = vi.fn().mockReturnValue(false)
    mockClient.getConnection = vi.fn().mockReturnValue(null)
    mockClient.connect = vi.fn().mockRejectedValue(new Error('Connection failed'))

    await expect(tool.execute({ 
      query: 'SELECT Id FROM Account' 
    }, context)).rejects.toThrow('Connection failed')
  })

  test('should handle empty result sets', async () => {
    const mockQueryResult = {
      totalSize: 0,
      done: true,
      records: []
    }

    const mockConnection = {
      query: vi.fn().mockResolvedValue(mockQueryResult)
    }
    
    ;(mockClient as any).connectionHandler = {
      connection: mockConnection
    }
    mockClient.isConnected = vi.fn().mockReturnValue(true)
    mockClient.getConnection = vi.fn().mockReturnValue(mockConnection)

    const result = await tool.execute({ 
      query: 'SELECT Id FROM Account WHERE Name = \'NonExistent\'' 
    }, context)

    expect(result.content[0].text).toContain('No records found')
    expect(result.content[0].text).toContain('Total records: 0')
  })
})

// Helper functions
function createMockSalesforceClient(): SalesforceClient {
  const config: SalesforceConfig = {
    clientId: 'test-client-id',
    instanceUrl: 'https://test.salesforce.com',
    apiVersion: 'v59.0',
    timeout: 30000,
    maxRetries: 3
  }
  
  return new SalesforceClient(config)
}

describe('GetRecordTool', () => {
  let tool: GetRecordTool
  let mockClient: SalesforceClient
  let context: any

  beforeEach(() => {
    tool = new GetRecordTool()
    mockClient = createMockSalesforceClient()
    context = { salesforceClient: mockClient }
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('should have correct tool definition', () => {
    expect(tool.definition.name).toBe('get_record')
    expect(tool.definition.description).toContain('Retrieve a specific record')
    expect(tool.definition.inputSchema.properties.objectName).toBeDefined()
    expect(tool.definition.inputSchema.properties.recordId).toBeDefined()
    expect(tool.definition.inputSchema.properties.fields).toBeDefined()
    expect(tool.definition.inputSchema.required).toEqual(['objectName', 'recordId'])
  })

  test('should retrieve record with specified fields', async () => {
    const mockRecord = {
      Id: '001000000001AAA',
      Name: 'Test Account',
      Type: 'Customer',
      Phone: '555-1234',
      attributes: { type: 'Account', url: '/services/data/v58.0/sobjects/Account/001000000001AAA' }
    }

    const mockConnection = {
      sobject: vi.fn().mockReturnValue({
        retrieve: vi.fn().mockResolvedValue(mockRecord)
      })
    }
    
    mockClient.isConnected = vi.fn().mockReturnValue(true)
    mockClient.getConnection = vi.fn().mockReturnValue(mockConnection)

    const result = await tool.execute({
      objectName: 'Account',
      recordId: '001000000001AAA',
      fields: ['Id', 'Name', 'Type', 'Phone']
    }, context)

    expect(result.content).toHaveLength(1)
    expect(result.content[0].text).toContain('Record retrieved successfully')
    expect(result.content[0].text).toContain('Test Account')
    expect(result.content[0].text).toContain('Customer')
    expect(result.content[0].text).toContain('555-1234')
    expect(mockConnection.sobject).toHaveBeenCalledWith('Account')
  })

  test('should retrieve record with all fields when none specified', async () => {
    const mockRecord = {
      Id: '001000000001AAA',
      Name: 'Test Account',
      CreatedDate: '2023-01-01T10:00:00.000+0000',
      attributes: { type: 'Account' }
    }

    const mockConnection = {
      sobject: vi.fn().mockReturnValue({
        retrieve: vi.fn().mockResolvedValue(mockRecord)
      })
    }
    
    mockClient.isConnected = vi.fn().mockReturnValue(true)
    mockClient.getConnection = vi.fn().mockReturnValue(mockConnection)

    const result = await tool.execute({
      objectName: 'Account',
      recordId: '001000000001AAA'
    }, context)

    expect(result.content).toHaveLength(1)
    expect(result.content[0].text).toContain('Record retrieved successfully')
    expect(result.content[0].text).toContain('Test Account')
    expect(mockConnection.sobject).toHaveBeenCalledWith('Account')
    expect(mockConnection.sobject().retrieve).toHaveBeenCalledWith('001000000001AAA', undefined)
  })

  test('should handle record not found error', async () => {
    const mockConnection = {
      sobject: vi.fn().mockReturnValue({
        retrieve: vi.fn().mockRejectedValue(new Error('NOT_FOUND: The requested resource does not exist'))
      })
    }
    
    mockClient.isConnected = vi.fn().mockReturnValue(true)
    mockClient.getConnection = vi.fn().mockReturnValue(mockConnection)

    const result = await tool.execute({
      objectName: 'Account',
      recordId: '001000000001AAA'
    }, context)

    expect(result.content).toHaveLength(1)
    expect(result.content[0].text).toContain('Error retrieving record')
    expect(result.content[0].text).toContain('NOT_FOUND')
  })

  test('should handle invalid field names', async () => {
    const mockConnection = {
      sobject: vi.fn().mockReturnValue({
        retrieve: vi.fn().mockRejectedValue(new Error('INVALID_FIELD: No such column \'InvalidField\' on entity \'Account\''))
      })
    }
    
    mockClient.isConnected = vi.fn().mockReturnValue(true)
    mockClient.getConnection = vi.fn().mockReturnValue(mockConnection)

    const result = await tool.execute({
      objectName: 'Account',
      recordId: '001000000001AAA',
      fields: ['Id', 'Name', 'InvalidField']
    }, context)

    expect(result.content).toHaveLength(1)
    expect(result.content[0].text).toContain('Error retrieving record')
    expect(result.content[0].text).toContain('INVALID_FIELD')
  })

  test('should handle connection unavailable', async () => {
    mockClient.isConnected = vi.fn().mockReturnValue(false)
    mockClient.getConnection = vi.fn().mockReturnValue(null)

    const result = await tool.execute({
      objectName: 'Account',
      recordId: '001000000001AAA'
    }, context)

    expect(result.content).toHaveLength(1)
    expect(result.content[0].text).toContain('No Salesforce connection available')
  })

  test('should validate Salesforce ID format', async () => {
    const mockConnection = {
      sobject: vi.fn().mockReturnValue({
        retrieve: vi.fn()
      })
    }
    
    mockClient.isConnected = vi.fn().mockReturnValue(true)
    mockClient.getConnection = vi.fn().mockReturnValue(mockConnection)

    const result = await tool.execute({
      objectName: 'Account',
      recordId: 'invalid-id'
    }, context)

    expect(result.content).toHaveLength(1)
    expect(result.content[0].text).toContain('Invalid Salesforce ID format')
    expect(mockConnection.sobject().retrieve).not.toHaveBeenCalled()
  })

  test('should format record output correctly with relationships', async () => {
    const mockRecord = {
      Id: '003000000001AAA',
      Name: 'John Doe',
      AccountId: '001000000001AAA',
      Account: {
        Id: '001000000001AAA',
        Name: 'ACME Corp',
        attributes: { type: 'Account' }
      },
      attributes: { type: 'Contact' }
    }

    const mockConnection = {
      sobject: vi.fn().mockReturnValue({
        retrieve: vi.fn().mockResolvedValue(mockRecord)
      })
    }
    
    mockClient.isConnected = vi.fn().mockReturnValue(true)
    mockClient.getConnection = vi.fn().mockReturnValue(mockConnection)

    const result = await tool.execute({
      objectName: 'Contact',
      recordId: '003000000001AAA',
      fields: ['Id', 'Name', 'Account.Name']
    }, context)

    expect(result.content).toHaveLength(1)
    expect(result.content[0].text).toContain('John Doe')
    expect(result.content[0].text).toContain('ACME Corp')
    expect(result.content[0].text).toContain('Account (Account):')
  })
})

// SOSL Search Tool Tests  
describe('SoslSearchTool', () => {
  let tool: SoslSearchTool
  let mockClient: any
  let context: ToolExecutionContext

  beforeEach(() => {
    tool = new SoslSearchTool()
    mockClient = {
      isConnected: vi.fn(),
      getConnection: vi.fn(),
      connect: vi.fn()
    }
    context = { salesforceClient: mockClient }
  })

  test('should have correct tool definition', () => {
    expect(tool.definition.name).toBe('sosl_search')
    expect(tool.definition.description).toContain('multi-object text search')
    expect(tool.definition.inputSchema.required).toContain('searchTerm')
    expect(tool.definition.inputSchema.properties.searchTerm).toEqual({
      type: 'string',
      description: 'The text to search for across Salesforce objects',
      minLength: 2
    })
    expect(tool.definition.inputSchema.properties.objects).toEqual({
      type: 'array',
      items: { type: 'string' },
      description: 'Optional array of object names to search within (e.g., ["Account", "Contact"])',
      default: []
    })
    expect(tool.definition.inputSchema.properties.limit).toEqual({
      type: 'number',
      minimum: 1,
      maximum: 200,
      description: 'Maximum number of records to return per object (default: 20, max: 200)',
      default: 20
    })
    expect(tool.definition.annotations?.readOnlyHint).toBe(true)
    expect(tool.definition.annotations?.idempotentHint).toBe(true)
  })

  test('should validate search term minimum length', async () => {
    const result = await tool.execute({
      searchTerm: 'x'
    }, context)

    expect(result.content).toHaveLength(1)
    expect(result.content[0].text).toContain('Search term must be at least 2 characters')
    expect(mockClient.getConnection).not.toHaveBeenCalled()
  })

  test('should execute SOSL search with basic parameters', async () => {
    const mockSearchResult = [
      {
        Id: '001000000001AAA',
        Name: 'ACME Corporation',
        attributes: { type: 'Account' }
      },
      {
        Id: '003000000001AAA', 
        FirstName: 'John',
        LastName: 'Doe',
        attributes: { type: 'Contact' }
      }
    ]

    const mockConnection = {
      search: vi.fn().mockResolvedValue({
        searchRecords: mockSearchResult
      })
    }

    mockClient.isConnected = vi.fn().mockReturnValue(true)
    mockClient.getConnection = vi.fn().mockReturnValue(mockConnection)

    const result = await tool.execute({
      searchTerm: 'test search'
    }, context)

    expect(mockConnection.search).toHaveBeenCalledWith("FIND {test search} IN ALL FIELDS RETURNING Account(Id LIMIT 20), Contact(Id LIMIT 20)")
    expect(result.content).toHaveLength(1)
    expect(result.content[0].text).toContain('Search completed successfully')
    expect(result.content[0].text).toContain('ACME Corporation')
    expect(result.content[0].text).toContain('John Doe')
  })

  test('should handle connection errors', async () => {
    mockClient.isConnected = vi.fn().mockReturnValue(false)
    mockClient.getConnection = vi.fn().mockReturnValue(null)

    const result = await tool.execute({
      searchTerm: 'test search'
    }, context)

    expect(result.content).toHaveLength(1)
    expect(result.content[0].text).toContain('No Salesforce connection available')
  })

  test('should handle search with specific objects', async () => {
    const mockConnection = {
      search: vi.fn().mockResolvedValue({
        searchRecords: []
      })
    }

    mockClient.isConnected = vi.fn().mockReturnValue(true)
    mockClient.getConnection = vi.fn().mockReturnValue(mockConnection)

    const result = await tool.execute({
      searchTerm: 'test',
      objects: ['Account', 'Contact'],
      limit: 10
    }, context)

    expect(mockConnection.search).toHaveBeenCalledWith("FIND {test} IN ALL FIELDS RETURNING Account(Id LIMIT 10), Contact(Id LIMIT 10)")
    expect(result.content).toHaveLength(1)
  })

  test('should generate valid SOSL syntax when multiple objects and limit are specified', async () => {
    let actualQuery = ''
    const mockConnection = {
      search: vi.fn().mockImplementation((query) => {
        actualQuery = query
        console.log('ACTUAL QUERY GENERATED:', query)
        return Promise.resolve({ searchRecords: [] })
      })
    }

    mockClient.isConnected = vi.fn().mockReturnValue(true)
    mockClient.getConnection = vi.fn().mockReturnValue(mockConnection)

    // Test multiple objects with limit - let's see what's actually generated
    await tool.execute({
      searchTerm: 'test', 
      objects: ['Account', 'Contact'],
      limit: 5
    }, context)

    // Should generate proper SOSL syntax with parenthetical field specification
    expect(actualQuery).toBe("FIND {test} IN ALL FIELDS RETURNING Account(Id LIMIT 5), Contact(Id LIMIT 5)")
  })

  test('single object with limit works correctly', async () => {
    const mockConnection = {
      search: vi.fn().mockResolvedValue({
        searchRecords: [
          {
            attributes: { type: 'Account' },
            Id: '001000000000001AAA',
            Name: 'Test Account'
          }
        ]
      })
    }

    mockClient.isConnected = vi.fn().mockReturnValue(true)
    mockClient.getConnection = vi.fn().mockReturnValue(mockConnection)

    // Single object with limit should work
    const result = await tool.execute({
      searchTerm: 'Razorpay',
      objects: ['Account'],
      limit: 3
    }, context)

    // This should work with the current implementation
    expect(mockConnection.search).toHaveBeenCalledWith("FIND {Razorpay} IN ALL FIELDS RETURNING Account(Id LIMIT 3)")
    expect(result.content[0].text).toContain('Search completed successfully')
  })

  test('should sanitize search term for security', async () => {
    const mockConnection = {
      search: vi.fn().mockResolvedValue({
        searchRecords: []
      })
    }

    mockClient.isConnected = vi.fn().mockReturnValue(true)
    mockClient.getConnection = vi.fn().mockReturnValue(mockConnection)

    const result = await tool.execute({
      searchTerm: 'test; DROP TABLE'
    }, context)

    // Should reject dangerous patterns
    expect(result.content).toHaveLength(1)
    expect(result.content[0].text).toContain('potentially unsafe content')
    expect(mockConnection.search).not.toHaveBeenCalled()
  })

  test('should enforce search scope limitations', async () => {
    const mockConnection = {
      search: vi.fn().mockResolvedValue({
        searchRecords: []
      })
    }

    mockClient.isConnected = vi.fn().mockReturnValue(true)
    mockClient.getConnection = vi.fn().mockReturnValue(mockConnection)

    const result = await tool.execute({
      searchTerm: 'test',
      objects: ['User', 'Profile', 'PermissionSet']
    }, context)

    // Should reject sensitive objects
    expect(result.content).toHaveLength(1)
    expect(result.content[0].text).toContain('access to restricted objects')
    expect(mockConnection.search).not.toHaveBeenCalled()
  })

  test('should validate field targeting security', async () => {
    const mockConnection = {
      search: vi.fn().mockResolvedValue({
        searchRecords: []
      })
    }

    mockClient.isConnected = vi.fn().mockReturnValue(true)
    mockClient.getConnection = vi.fn().mockReturnValue(mockConnection)

    const result = await tool.execute({
      searchTerm: 'test',
      objects: ['Account'],
      fields: ['Id', 'Name', 'SSN__c', 'CreditCard__c']
    }, context)

    // Should reject sensitive field targeting
    expect(result.content).toHaveLength(1)
    expect(result.content[0].text).toContain('access to sensitive fields')
    expect(mockConnection.search).not.toHaveBeenCalled()
  })

  test('should allow standard object searches', async () => {
    const mockConnection = {
      search: vi.fn().mockResolvedValue({
        searchRecords: []
      })
    }

    mockClient.isConnected = vi.fn().mockReturnValue(true)
    mockClient.getConnection = vi.fn().mockReturnValue(mockConnection)

    const result = await tool.execute({
      searchTerm: 'test',
      objects: ['Account', 'Contact', 'Lead', 'Opportunity']
    }, context)

    expect(mockConnection.search).toHaveBeenCalledWith("FIND {test} IN ALL FIELDS RETURNING Account(Id LIMIT 20), Contact(Id LIMIT 20), Lead(Id LIMIT 20), Opportunity(Id LIMIT 20)")
    expect(result.content).toHaveLength(1)
  })

  test('should validate maximum object count', async () => {
    const mockConnection = {
      search: vi.fn().mockResolvedValue({
        searchRecords: []
      })
    }

    mockClient.isConnected = vi.fn().mockReturnValue(true)
    mockClient.getConnection = vi.fn().mockReturnValue(mockConnection)

    const manyObjects = Array.from({length: 15}, (_, i) => `Object${i}`)

    const result = await tool.execute({
      searchTerm: 'test',
      objects: manyObjects
    }, context)

    // Should reject too many objects
    expect(result.content).toHaveLength(1)
    expect(result.content[0].text).toContain('too many objects')
    expect(mockConnection.search).not.toHaveBeenCalled()
  })

  test('should handle invalid SOSL syntax errors', async () => {
    const mockConnection = {
      search: vi.fn().mockRejectedValue(new Error('INVALID_SEARCH: Invalid search syntax'))
    }

    mockClient.isConnected = vi.fn().mockReturnValue(true)
    mockClient.getConnection = vi.fn().mockReturnValue(mockConnection)

    const result = await tool.execute({
      searchTerm: 'test',
      objects: ['Account']
    }, context)

    expect(result.content).toHaveLength(1)
    expect(result.content[0].text).toContain('Invalid search syntax')
    expect(result.content[0].text).toContain('Check your search term format')
  })

  test('should detect and block SOSL injection attempts', async () => {
    const mockConnection = {
      search: vi.fn().mockResolvedValue({
        searchRecords: []
      })
    }

    mockClient.isConnected = vi.fn().mockReturnValue(true)
    mockClient.getConnection = vi.fn().mockReturnValue(mockConnection)

    const maliciousSearches = [
      'test} RETURNING User',
      'test" OR 1=1',
      'test\' UNION SELECT',
      'test} IN ALL FIELDS RETURNING PermissionSet',
      'test} RETURNING Account, User(Id, Username, Password)',
      'test} LIMIT 2000'
    ]

    for (const maliciousSearch of maliciousSearches) {
      const result = await tool.execute({
        searchTerm: maliciousSearch,
        objects: ['Account']
      }, context)

      expect(result.content).toHaveLength(1)
      expect(result.content[0].text).toContain('potentially unsafe content')
      expect(mockConnection.search).not.toHaveBeenCalled()
    }
  })

  test('should handle empty or invalid search terms', async () => {
    const mockConnection = {
      search: vi.fn().mockResolvedValue({
        searchRecords: []
      })
    }

    mockClient.isConnected = vi.fn().mockReturnValue(true)
    mockClient.getConnection = vi.fn().mockReturnValue(mockConnection)

    // Test empty search term
    let result = await tool.execute({
      searchTerm: '',
      objects: ['Account']
    }, context)

    expect(result.content).toHaveLength(1)
    expect(result.content[0].text).toContain('Search term cannot be empty')
    expect(mockConnection.search).not.toHaveBeenCalled()

    // Test whitespace-only search term
    result = await tool.execute({
      searchTerm: '   ',
      objects: ['Account']
    }, context)

    expect(result.content).toHaveLength(1)
    expect(result.content[0].text).toContain('Search term cannot be empty')
    expect(mockConnection.search).not.toHaveBeenCalled()

    // Test search term that's too short
    result = await tool.execute({
      searchTerm: 'a',
      objects: ['Account']
    }, context)

    expect(result.content).toHaveLength(1)
    expect(result.content[0].text).toContain('Search term must be at least 2 characters')
    expect(mockConnection.search).not.toHaveBeenCalled()
  })

  test('should handle Salesforce API errors gracefully', async () => {
    const mockConnection = {
      search: vi.fn().mockRejectedValue(new Error('INVALID_TYPE: sObject type \'NonExistentObject\' is not supported'))
    }

    mockClient.isConnected = vi.fn().mockReturnValue(true)
    mockClient.getConnection = vi.fn().mockReturnValue(mockConnection)

    const result = await tool.execute({
      searchTerm: 'test',
      objects: ['NonExistentObject']
    }, context)

    expect(result.content).toHaveLength(1)
    expect(result.content[0].text).toContain('Search failed')
    expect(result.content[0].text).toContain('NonExistentObject')
    expect(result.content[0].text).toContain('is not supported')
  })

  test('should handle network timeouts and connection failures', async () => {
    const mockConnection = {
      search: vi.fn().mockRejectedValue(new Error('Request timeout'))
    }

    mockClient.isConnected = vi.fn().mockReturnValue(true)
    mockClient.getConnection = vi.fn().mockReturnValue(mockConnection)

    const result = await tool.execute({
      searchTerm: 'test',
      objects: ['Account']
    }, context)

    expect(result.content).toHaveLength(1)
    expect(result.content[0].text).toContain('Search failed')
    expect(result.content[0].text).toContain('Request timeout')
  })

  test('should sanitize sensitive data from search results', async () => {
    const mockSearchResult = [
      {
        Id: '001000000001AAA',
        Name: 'ACME Corporation',
        SSN__c: '123-45-6789',
        CreditCard__c: '4111-1111-1111-1111',
        Phone: '+1-555-0123',
        Email: 'contact@acme.com',
        attributes: { type: 'Account' }
      },
      {
        Id: '003000000001AAA',
        FirstName: 'John',
        LastName: 'Doe',
        SSN__c: '987-65-4321',
        BirthDate: '1985-03-15',
        attributes: { type: 'Contact' }
      }
    ]

    const mockConnection = {
      search: vi.fn().mockResolvedValue({
        searchRecords: mockSearchResult
      })
    }

    mockClient.isConnected = vi.fn().mockReturnValue(true)
    mockClient.getConnection = vi.fn().mockReturnValue(mockConnection)

    const result = await tool.execute({
      searchTerm: 'test search'
    }, context)

    expect(result.content).toHaveLength(1)
    const resultText = result.content[0].text
    
    // Should sanitize SSN and credit card data
    expect(resultText).not.toContain('123-45-6789')
    expect(resultText).not.toContain('4111-1111-1111-1111')
    expect(resultText).not.toContain('987-65-4321')
    
    // Should contain sanitized versions
    expect(resultText).toContain('***-**-****')
    expect(resultText).toContain('****-****-****-****')
    
    // Should still contain non-sensitive data
    expect(resultText).toContain('ACME Corporation')
    expect(resultText).toContain('John Doe')
    expect(resultText).toContain('contact@acme.com')
  })

  test('should filter results based on field permissions', async () => {
    const mockSearchResult = [
      {
        Id: '001000000001AAA',
        Name: 'ACME Corporation',
        ConfidentialNotes__c: 'Internal sensitive information',
        Revenue: 1000000,
        attributes: { type: 'Account' }
      }
    ]

    const mockFieldDescribe = {
      ConfidentialNotes__c: {
        name: 'ConfidentialNotes__c',
        accessible: false,  // Field not accessible to current user
        type: 'textarea'
      },
      Revenue: {
        name: 'Revenue',
        accessible: true,
        type: 'currency'
      }
    }

    const mockConnection = {
      search: vi.fn().mockResolvedValue({
        searchRecords: mockSearchResult
      }),
      sobject: vi.fn().mockReturnValue({
        describe: vi.fn().mockResolvedValue({
          fields: mockFieldDescribe
        })
      })
    }

    mockClient.isConnected = vi.fn().mockReturnValue(true)
    mockClient.getConnection = vi.fn().mockReturnValue(mockConnection)

    const result = await tool.execute({
      searchTerm: 'test',
      objects: ['Account']
    }, context)

    expect(result.content).toHaveLength(1)
    const resultText = result.content[0].text

    // Should not contain inaccessible field data
    expect(resultText).not.toContain('Internal sensitive information')
    expect(resultText).not.toContain('ConfidentialNotes__c')
    
    // Should contain accessible field data
    expect(resultText).toContain('ACME Corporation')
    expect(resultText).toContain('Revenue')
  })

  test('should respect maximum result limits for sanitization', async () => {
    const largeSearchResult = Array.from({length: 250}, (_, i) => ({
      Id: `001000000${String(i).padStart(6, '0')}`,
      Name: `Account ${i}`,
      SSN__c: `${String(i).padStart(3, '0')}-45-6789`,
      attributes: { type: 'Account' }
    }))

    const mockConnection = {
      search: vi.fn().mockResolvedValue({
        searchRecords: largeSearchResult
      })
    }

    mockClient.isConnected = vi.fn().mockReturnValue(true)
    mockClient.getConnection = vi.fn().mockReturnValue(mockConnection)

    const result = await tool.execute({
      searchTerm: 'test',
      objects: ['Account'],
      limit: 20
    }, context)

    expect(result.content).toHaveLength(1)
    const resultText = result.content[0].text

    // Should respect limit and only process limited results
    expect(resultText).toContain('Found 250 record')
    // Should show sanitized data for returned records
    expect(resultText).toContain('***-**-****')
    // Should not contain raw SSN data
    expect(resultText).not.toContain('-45-6789')
  })

  test('should handle permission errors gracefully', async () => {
    const mockConnection = {
      search: vi.fn().mockResolvedValue({
        searchRecords: [
          {
            Id: '001000000001AAA',
            Name: 'ACME Corporation',
            attributes: { type: 'Account' }
          }
        ]
      }),
      sobject: vi.fn().mockReturnValue({
        describe: vi.fn().mockRejectedValue(new Error('INSUFFICIENT_ACCESS: Field access denied'))
      })
    }

    mockClient.isConnected = vi.fn().mockReturnValue(true)
    mockClient.getConnection = vi.fn().mockReturnValue(mockConnection)

    const result = await tool.execute({
      searchTerm: 'test',
      objects: ['Account']
    }, context)

    expect(result.content).toHaveLength(1)
    const resultText = result.content[0].text

    // Should still return results but with basic sanitization
    expect(resultText).toContain('ACME Corporation')
    expect(resultText).toContain('Search completed successfully')
  })
})

// Search Result Formatting Utilities Tests
describe('SearchResultFormatter', () => {
  test('should group records by object type', () => {
    const records = [
      { Id: '001', Name: 'Account 1', attributes: { type: 'Account' } },
      { Id: '003', FirstName: 'John', attributes: { type: 'Contact' } },
      { Id: '002', Name: 'Account 2', attributes: { type: 'Account' } }
    ]

    const grouped = SearchResultFormatter.groupRecordsByType(records)
    
    expect(grouped.size).toBe(2)
    expect(grouped.get('Account')).toHaveLength(2)
    expect(grouped.get('Contact')).toHaveLength(1)
    expect(grouped.get('Account')?.[0].Name).toBe('Account 1')
  })

  test('should handle records without attributes', () => {
    const records = [
      { Id: '001', Name: 'Test Record' }
    ]

    const grouped = SearchResultFormatter.groupRecordsByType(records)
    
    expect(grouped.size).toBe(1)
    expect(grouped.get('Unknown')).toHaveLength(1)
  })

  test('should format search summary correctly', () => {
    const summary = SearchResultFormatter.formatSearchSummary('test query', 5)
    
    expect(summary).toContain('Search completed successfully')
    expect(summary).toContain('Found 5 records matching "test query"')
  })

  test('should handle singular vs plural record count', () => {
    const summaryOne = SearchResultFormatter.formatSearchSummary('test', 1)
    const summaryMultiple = SearchResultFormatter.formatSearchSummary('test', 3)
    
    expect(summaryOne).toContain('Found 1 record matching')
    expect(summaryMultiple).toContain('Found 3 records matching')
  })

  test('should format object group header correctly', () => {
    const header = SearchResultFormatter.formatObjectGroupHeader('Account', 2)
    
    expect(header).toBe('Account (2 records):')
    
    const headerSingle = SearchResultFormatter.formatObjectGroupHeader('Contact', 1)
    expect(headerSingle).toBe('Contact (1 record):')
  })

  test('should format complete search results', () => {
    const records = [
      { Id: '001', Name: 'ACME Corp', attributes: { type: 'Account' } },
      { Id: '003', FirstName: 'John', LastName: 'Doe', attributes: { type: 'Contact' } }
    ]

    const result = SearchResultFormatter.formatSearchResults(records, 'test search')
    
    expect(result).toContain('Search completed successfully')
    expect(result).toContain('Found 2 records matching "test search"')
    expect(result).toContain('Account (1 record):')
    expect(result).toContain('Contact (1 record):')
    expect(result).toContain('ACME Corp')
    expect(result).toContain('John Doe')
  })

  test('should handle empty search results', () => {
    const result = SearchResultFormatter.formatSearchResults([], 'no results')
    
    expect(result).toBe('No records found matching search term "no results".')
  })
})

// Record Summary Formatter Tests  
describe('RecordSummaryFormatter', () => {
  test('should format Account records correctly', () => {
    const record = {
      Id: '001000000001AAA',
      Name: 'ACME Corporation',
      Type: 'Customer',
      Phone: '+1-555-0123',
      Revenue: 1000000
    }

    const summary = RecordSummaryFormatter.formatRecord(record, 'Account')
    
    expect(summary).toContain('Id: 001000000001AAA')
    expect(summary).toContain('Name: ACME Corporation')
    expect(summary).toContain('Type: Customer')
    expect(summary).toContain('Phone: +1-555-0123')
    expect(summary).toContain('Revenue: 1000000')
  })

  test('should format Contact records correctly', () => {
    const record = {
      Id: '003000000001AAA',
      FirstName: 'John',
      LastName: 'Doe',
      Title: 'VP Sales',
      Email: 'john@acme.com'
    }

    const summary = RecordSummaryFormatter.formatRecord(record, 'Contact')
    
    expect(summary).toContain('Id: 003000000001AAA')
    expect(summary).toContain('Name: John Doe')
    expect(summary).toContain('Title: VP Sales')
    expect(summary).toContain('Email: john@acme.com')
  })

  test('should format Lead records correctly', () => {
    const record = {
      Id: '00Q000000001AAA',
      FirstName: 'Jane',
      LastName: 'Smith',
      Company: 'Tech Corp',
      Phone: '+1-555-0456'
    }

    const summary = RecordSummaryFormatter.formatRecord(record, 'Lead')
    
    expect(summary).toContain('Name: Jane Smith')
    expect(summary).toContain('Company: Tech Corp')
    expect(summary).toContain('Phone: +1-555-0456')
  })

  test('should handle unknown object types', () => {
    const record = {
      Id: 'a01000000001AAA',
      Name: 'Custom Record',
      CustomField__c: 'Custom Value'
    }

    const summary = RecordSummaryFormatter.formatRecord(record, 'CustomObject__c')
    
    expect(summary).toContain('Name: Custom Record')
    expect(summary).toContain('CustomField__c: Custom Value')
  })

  test('should handle records with missing fields gracefully', () => {
    const record = {
      Id: '001000000001AAA'
    }

    const summary = RecordSummaryFormatter.formatRecord(record, 'Account')
    
    expect(summary).toBe('Id: 001000000001AAA')
  })

  test('should include sanitized sensitive fields', () => {
    const record = {
      Id: '003000000001AAA',
      FirstName: 'John',
      LastName: 'Doe',
      SSN__c: '***-**-****',
      CreditCard__c: '****-****-****-****'
    }

    const summary = RecordSummaryFormatter.formatRecord(record, 'Contact')
    
    expect(summary).toContain('SSN: ***-**-****')
    expect(summary).not.toContain('123-45-6789')
  })
})

describe('GetPicklistValuesTool', () => {
  let tool: GetPicklistValuesTool
  let mockContext: ToolExecutionContext
  let mockClient: any
  let mockConnection: any

  beforeEach(() => {
    tool = new GetPicklistValuesTool()
    mockConnection = {
      sobject: vi.fn(),
      describe: vi.fn()
    }
    mockClient = {
      isConnected: vi.fn().mockReturnValue(true),
      getConnection: vi.fn().mockReturnValue(mockConnection),
      connect: vi.fn()
    }
    mockContext = { salesforceClient: mockClient }
  })

  describe('registration', () => {
    it('should register with correct name and schema', () => {
      expect(tool.definition.name).toBe('get_picklist_values')
      expect(tool.definition.description).toContain('picklist values')
      expect(tool.definition.inputSchema.type).toBe('object')
      expect(tool.definition.inputSchema.properties).toHaveProperty('objectName')
      expect(tool.definition.inputSchema.properties).toHaveProperty('fieldName')
      expect(tool.definition.inputSchema.required).toContain('objectName')
      expect(tool.definition.inputSchema.required).toContain('fieldName')
    })
  })

  describe('input validation', () => {
    it('should validate required objectName parameter', async () => {
      await expect(tool.execute({
        fieldName: 'Industry'
      }, mockContext)).rejects.toThrow('objectName is required')
    })

    it('should validate required fieldName parameter', async () => {
      await expect(tool.execute({
        objectName: 'Account'
      }, mockContext)).rejects.toThrow('fieldName is required')
    })

    it('should validate objectName format', async () => {
      await expect(tool.execute({
        objectName: '',
        fieldName: 'Industry'
      }, mockContext)).rejects.toThrow('objectName cannot be empty')
    })

    it('should validate fieldName format', async () => {
      await expect(tool.execute({
        objectName: 'Account',
        fieldName: ''
      }, mockContext)).rejects.toThrow('fieldName cannot be empty')
    })
  })

  describe('successful picklist retrieval', () => {
    it('should retrieve picklist values for standard field', async () => {
      const mockFieldDescribe = {
        name: 'Industry',
        type: 'picklist',
        picklistValues: [
          { value: 'Technology', label: 'Technology', active: true },
          { value: 'Finance', label: 'Finance', active: true },
          { value: 'Healthcare', label: 'Healthcare', active: true }
        ],
        dependentPicklist: false,
        controllerName: null
      }

      mockConnection.sobject = vi.fn().mockReturnValue({
        describe: vi.fn().mockResolvedValue({
          fields: [mockFieldDescribe]
        })
      })

      const result = await tool.execute({
        objectName: 'Account',
        fieldName: 'Industry'
      }, mockContext)

      expect(result.content).toHaveLength(1)
      expect(result.content[0].type).toBe('text')
      
      const parsedResult = JSON.parse(result.content[0].text)
      expect(parsedResult.objectName).toBe('Account')
      expect(parsedResult.fieldName).toBe('Industry')
      expect(parsedResult.fieldType).toBe('picklist')
      expect(parsedResult.values).toHaveLength(3)
      expect(parsedResult.values[0]).toEqual({
        value: 'Technology',
        label: 'Technology',
        active: true
      })
      expect(parsedResult.isDependentPicklist).toBe(false)
      expect(parsedResult.controllerField).toBeNull()
    })

    it('should retrieve values for dependent picklist', async () => {
      const mockFieldDescribe = {
        name: 'BillingState',
        type: 'picklist',
        picklistValues: [
          { value: 'CA', label: 'California', active: true },
          { value: 'NY', label: 'New York', active: true }
        ],
        dependentPicklist: true,
        controllerName: 'BillingCountry'
      }

      mockConnection.sobject = vi.fn().mockReturnValue({
        describe: vi.fn().mockResolvedValue({
          fields: [mockFieldDescribe]
        })
      })

      const result = await tool.execute({
        objectName: 'Account',
        fieldName: 'BillingState'
      }, mockContext)

      expect(result.content).toHaveLength(1)
      expect(result.content[0].type).toBe('text')
      
      const parsedResult = JSON.parse(result.content[0].text)
      expect(parsedResult.isDependentPicklist).toBe(true)
      expect(parsedResult.controllerField).toBe('BillingCountry')
      expect(parsedResult.values).toHaveLength(2)
    })

    it('should filter out inactive picklist values by default', async () => {
      const mockFieldDescribe = {
        name: 'Type',
        type: 'picklist',
        picklistValues: [
          { value: 'Customer', label: 'Customer', active: true },
          { value: 'Prospect', label: 'Prospect', active: true },
          { value: 'Inactive', label: 'Inactive Type', active: false }
        ],
        dependentPicklist: false,
        controllerName: null
      }

      mockConnection.sobject = vi.fn().mockReturnValue({
        describe: vi.fn().mockResolvedValue({
          fields: [mockFieldDescribe]
        })
      })

      const result = await tool.execute({
        objectName: 'Account',
        fieldName: 'Type'
      }, mockContext)

      expect(result.content).toHaveLength(1)
      expect(result.content[0].type).toBe('text')
      
      const parsedResult = JSON.parse(result.content[0].text)
      expect(parsedResult.values).toHaveLength(2)
      expect(parsedResult.values.every(v => v.active)).toBe(true)
    })

    it('should include inactive values when requested', async () => {
      const mockFieldDescribe = {
        name: 'Type',
        type: 'picklist',
        picklistValues: [
          { value: 'Customer', label: 'Customer', active: true },
          { value: 'Inactive', label: 'Inactive Type', active: false }
        ],
        dependentPicklist: false,
        controllerName: null
      }

      mockConnection.sobject = vi.fn().mockReturnValue({
        describe: vi.fn().mockResolvedValue({
          fields: [mockFieldDescribe]
        })
      })

      const result = await tool.execute({
        objectName: 'Account',
        fieldName: 'Type',
        includeInactive: true
      }, mockContext)

      expect(result.content).toHaveLength(1)
      expect(result.content[0].type).toBe('text')
      
      const parsedResult = JSON.parse(result.content[0].text)
      expect(parsedResult.values).toHaveLength(2)
      expect(parsedResult.values.some(v => !v.active)).toBe(true)
    })
  })

  describe('error handling', () => {
    it('should handle connection errors gracefully', async () => {
      mockClient.isConnected.mockReturnValue(false)
      mockClient.getConnection.mockReturnValue(null)

      await expect(tool.execute({
        objectName: 'Account',
        fieldName: 'Industry'
      }, mockContext)).rejects.toThrow('No Salesforce connection available')
    })

    it('should handle invalid object name', async () => {
      mockConnection.sobject = vi.fn().mockReturnValue({
        describe: vi.fn().mockRejectedValue(new Error('INVALID_TYPE: sobject type InvalidObject does not exist'))
      })

      await expect(tool.execute({
        objectName: 'InvalidObject',
        fieldName: 'Industry'
      }, mockContext)).rejects.toThrow('Invalid object name: InvalidObject')
    })

    it('should handle field not found', async () => {
      mockConnection.sobject = vi.fn().mockReturnValue({
        describe: vi.fn().mockResolvedValue({
          fields: [
            { name: 'Name', type: 'string' }
          ]
        })
      })

      await expect(tool.execute({
        objectName: 'Account',
        fieldName: 'NonExistentField'
      }, mockContext)).rejects.toThrow('Field NonExistentField not found on Account object')
    })

    it('should handle non-picklist field', async () => {
      const mockFieldDescribe = {
        name: 'Name',
        type: 'string',
        picklistValues: []
      }

      mockConnection.sobject = vi.fn().mockReturnValue({
        describe: vi.fn().mockResolvedValue({
          fields: [mockFieldDescribe]
        })
      })

      await expect(tool.execute({
        objectName: 'Account',
        fieldName: 'Name'
      }, mockContext)).rejects.toThrow('Field Name is not a picklist field')
    })

    it('should handle network timeouts', async () => {
      mockConnection.sobject = vi.fn().mockReturnValue({
        describe: vi.fn().mockRejectedValue(new Error('Request timeout'))
      })

      await expect(tool.execute({
        objectName: 'Account',
        fieldName: 'Industry'
      }, mockContext)).rejects.toThrow('Failed to retrieve picklist values: Request timeout')
    })
  })

  describe('security validation', () => {
    it('should respect field-level security when field is not accessible', async () => {
      const mockFieldDescribe = {
        name: 'SensitiveField',
        type: 'picklist',
        picklistValues: [],
        accessible: false
      }

      mockConnection.sobject = vi.fn().mockReturnValue({
        describe: vi.fn().mockResolvedValue({
          fields: [mockFieldDescribe]
        })
      })

      await expect(tool.execute({
        objectName: 'Account',
        fieldName: 'SensitiveField'
      }, mockContext)).rejects.toThrow('Access denied: insufficient permissions to read field SensitiveField')
    })

    it('should sanitize sensitive picklist values', async () => {
      const mockFieldDescribe = {
        name: 'SecurityLevel',
        type: 'picklist',
        picklistValues: [
          { value: 'Public', label: 'Public', active: true },
          { value: 'Internal', label: 'Internal', active: true },
          { value: 'SSN_123456789', label: 'SSN: 123-45-6789', active: true }
        ],
        dependentPicklist: false,
        controllerName: null,
        accessible: true
      }

      mockConnection.sobject = vi.fn().mockReturnValue({
        describe: vi.fn().mockResolvedValue({
          fields: [mockFieldDescribe]
        })
      })

      const result = await tool.execute({
        objectName: 'Account',
        fieldName: 'SecurityLevel'
      }, mockContext)

      expect(result.content).toHaveLength(1)
      expect(result.content[0].type).toBe('text')
      
      const parsedResult = JSON.parse(result.content[0].text)
      expect(parsedResult.values).toHaveLength(3)
      const ssnValue = parsedResult.values.find(v => v.value.includes('SSN'))
      expect(ssnValue?.label).toBe('SSN: ***-**-****')
    })
  })
})

describe('ValidateSoqlTool', () => {
  let tool: ValidateSoqlTool
  let mockContext: ToolExecutionContext
  let mockClient: any
  let mockConnection: any

  beforeEach(() => {
    tool = new ValidateSoqlTool()
    mockConnection = {
      query: vi.fn(),
      sobject: vi.fn()
    }
    mockClient = {
      isConnected: vi.fn().mockReturnValue(true),
      getConnection: vi.fn().mockReturnValue(mockConnection),
      connect: vi.fn()
    }
    mockContext = { salesforceClient: mockClient }
  })

  describe('registration', () => {
    it('should register with correct name and schema', () => {
      expect(tool.definition.name).toBe('validate_soql')
      expect(tool.definition.description).toContain('Validate SOQL syntax')
      expect(tool.definition.inputSchema.type).toBe('object')
      expect(tool.definition.inputSchema.properties).toHaveProperty('query')
      expect(tool.definition.inputSchema.required).toContain('query')
      expect(tool.definition.annotations?.readOnlyHint).toBe(true)
      expect(tool.definition.annotations?.idempotentHint).toBe(true)
    })
  })

  describe('input validation', () => {
    it('should validate required query parameter', async () => {
      await expect(tool.execute({}, mockContext)).rejects.toThrow('query is required')
    })

    it('should validate query format', async () => {
      await expect(tool.execute({
        query: ''
      }, mockContext)).rejects.toThrow('query must be at least 5 characters')
    })

    it('should validate query type', async () => {
      await expect(tool.execute({
        query: 123
      }, mockContext)).rejects.toThrow('query must be a string')
    })

    it('should validate minimum query length', async () => {
      await expect(tool.execute({
        query: 'S'
      }, mockContext)).rejects.toThrow('query must be at least 5 characters')
    })
  })

  describe('SOQL syntax validation', () => {
    it('should validate basic SELECT query', async () => {
      const result = await tool.execute({
        query: 'SELECT Id, Name FROM Account'
      }, mockContext)

      expect(result.content).toHaveLength(1)
      expect(result.content[0].type).toBe('text')
      
      const parsedResult = JSON.parse(result.content[0].text)
      expect(parsedResult.isValid).toBe(true)
      expect(parsedResult.query).toBe('SELECT Id, Name FROM Account')
      expect(parsedResult.queryType).toBe('SELECT')
      expect(parsedResult.objects).toEqual(['Account'])
      expect(parsedResult.fields).toEqual(['Id', 'Name'])
    })

    it('should validate query with WHERE clause', async () => {
      const result = await tool.execute({
        query: 'SELECT Id, Name FROM Account WHERE Type = \'Customer\''
      }, mockContext)

      const parsedResult = JSON.parse(result.content[0].text)
      expect(parsedResult.isValid).toBe(true)
      expect(parsedResult.hasWhereClause).toBe(true)
      expect(parsedResult.whereFields).toContain('Type')
    })

    it('should validate query with ORDER BY', async () => {
      const result = await tool.execute({
        query: 'SELECT Id, Name FROM Account ORDER BY Name ASC'
      }, mockContext)

      const parsedResult = JSON.parse(result.content[0].text)
      expect(parsedResult.isValid).toBe(true)
      expect(parsedResult.hasOrderBy).toBe(true)
      expect(parsedResult.orderByFields).toContain('Name')
    })

    it('should validate query with LIMIT', async () => {
      const result = await tool.execute({
        query: 'SELECT Id, Name FROM Account LIMIT 100'
      }, mockContext)

      const parsedResult = JSON.parse(result.content[0].text)
      expect(parsedResult.isValid).toBe(true)
      expect(parsedResult.hasLimit).toBe(true)
      expect(parsedResult.limitValue).toBe(100)
    })
  })

  describe('injection prevention', () => {
    it('should detect SQL injection attempt with UNION', async () => {
      const result = await tool.execute({
        query: 'SELECT Id FROM Account UNION SELECT Id FROM User'
      }, mockContext)

      const parsedResult = JSON.parse(result.content[0].text)
      expect(parsedResult.isValid).toBe(false)
      expect(parsedResult.securityIssues).toContain('UNION statement detected')
    })

    it('should detect SQL injection attempt with semicolon', async () => {
      const result = await tool.execute({
        query: 'SELECT Id FROM Account; DROP TABLE User'
      }, mockContext)

      const parsedResult = JSON.parse(result.content[0].text)
      expect(parsedResult.isValid).toBe(false)
      expect(parsedResult.securityIssues).toContain('Multiple statements detected')
    })

    it('should detect dangerous functions', async () => {
      const result = await tool.execute({
        query: 'SELECT Id, eval(\'malicious\') FROM Account'
      }, mockContext)

      const parsedResult = JSON.parse(result.content[0].text)
      expect(parsedResult.isValid).toBe(false)
      expect(parsedResult.securityIssues).toContain('Dangerous function detected')
    })

    it('should validate against excessive subqueries', async () => {
      const result = await tool.execute({
        query: 'SELECT Id, (SELECT Id FROM (SELECT Id FROM (SELECT Id FROM Contact))) FROM Account'
      }, mockContext)

      const parsedResult = JSON.parse(result.content[0].text)
      expect(parsedResult.isValid).toBe(false)
      expect(parsedResult.securityIssues).toContain('Excessive subquery nesting')
    })
  })

  describe('syntax error detection', () => {
    it('should detect invalid SELECT syntax', async () => {
      const result = await tool.execute({
        query: 'SELCT Id FROM Account'
      }, mockContext)

      const parsedResult = JSON.parse(result.content[0].text)
      expect(parsedResult.isValid).toBe(false)
      expect(parsedResult.syntaxErrors).toContain('Invalid SELECT statement')
    })

    it('should detect missing FROM clause', async () => {
      const result = await tool.execute({
        query: 'SELECT Id, Name'
      }, mockContext)

      const parsedResult = JSON.parse(result.content[0].text)
      expect(parsedResult.isValid).toBe(false)
      expect(parsedResult.syntaxErrors).toContain('Missing FROM clause')
    })

    it('should detect invalid field syntax', async () => {
      const result = await tool.execute({
        query: 'SELECT Id,, Name FROM Account'
      }, mockContext)

      const parsedResult = JSON.parse(result.content[0].text)
      expect(parsedResult.isValid).toBe(false)
      expect(parsedResult.syntaxErrors).toContain('Invalid field list syntax')
    })

    it('should detect incomplete WHERE clause', async () => {
      const result = await tool.execute({
        query: 'SELECT Id FROM Account WHERE'
      }, mockContext)

      const parsedResult = JSON.parse(result.content[0].text)
      expect(parsedResult.isValid).toBe(false)
      expect(parsedResult.syntaxErrors).toContain('Incomplete WHERE clause')
    })

    it('should detect WHERE clause missing conditions', async () => {
      const result = await tool.execute({
        query: 'SELECT Id FROM Account WHERE ORDER BY Name'
      }, mockContext)

      const parsedResult = JSON.parse(result.content[0].text)
      expect(parsedResult.isValid).toBe(false)
      expect(parsedResult.syntaxErrors).toContain('WHERE clause missing conditions')
    })

    it('should detect incomplete ORDER BY clause', async () => {
      const result = await tool.execute({
        query: 'SELECT Id FROM Account ORDER BY'
      }, mockContext)

      const parsedResult = JSON.parse(result.content[0].text)
      expect(parsedResult.isValid).toBe(false)
      expect(parsedResult.syntaxErrors).toContain('Incomplete ORDER BY clause')
    })
  })

  describe('query complexity analysis', () => {
    it('should analyze simple query complexity', async () => {
      const result = await tool.execute({
        query: 'SELECT Id, Name FROM Account'
      }, mockContext)

      const parsedResult = JSON.parse(result.content[0].text)
      expect(parsedResult.complexity).toEqual({
        score: 1,
        level: 'simple',
        factors: {
          fieldCount: 2,
          objectCount: 1,
          subqueryCount: 0,
          joinCount: 0,
          whereConditions: 0
        }
      })
    })

    it('should analyze complex query with high complexity score', async () => {
      const result = await tool.execute({
        query: 'SELECT Id, Name, (SELECT Id FROM Contacts), (SELECT Id FROM Opportunities) FROM Account WHERE Type = \'Customer\' AND Industry IN (\'Technology\', \'Finance\') ORDER BY Name LIMIT 1000'
      }, mockContext)

      const parsedResult = JSON.parse(result.content[0].text)
      expect(parsedResult.complexity.level).toBe('complex')
      expect(parsedResult.complexity.score).toBeGreaterThan(5)
    })
  })

  describe('error handling', () => {
    it('should handle connection errors gracefully', async () => {
      mockClient.isConnected.mockReturnValue(false)
      mockClient.getConnection.mockReturnValue(null)

      await expect(tool.execute({
        query: 'SELECT Id FROM Account'
      }, mockContext)).rejects.toThrow('No Salesforce connection available')
    })
  })

  describe('query recommendations', () => {
    it('should provide recommendations for optimization', async () => {
      const result = await tool.execute({
        query: 'SELECT * FROM Account'
      }, mockContext)

      const parsedResult = JSON.parse(result.content[0].text)
      expect(parsedResult.recommendations).toContain('Avoid SELECT * for better performance')
    })

    it('should recommend using LIMIT for large datasets', async () => {
      const result = await tool.execute({
        query: 'SELECT Id, Name, Description, Industry, Type, BillingAddress FROM Account WHERE CreatedDate = LAST_N_DAYS:365'
      }, mockContext)

      const parsedResult = JSON.parse(result.content[0].text)
      expect(parsedResult.recommendations).toContain('Consider adding LIMIT clause')
    })
  })
})

describe('ExplainQueryPlanTool', () => {
  let tool: ExplainQueryPlanTool
  let mockContext: ToolExecutionContext
  let mockClient: any
  let mockConnection: any

  beforeEach(() => {
    tool = new ExplainQueryPlanTool()
    mockConnection = {
      query: vi.fn(),
      sobject: vi.fn().mockReturnValue({
        describe: vi.fn().mockResolvedValue(createMockDescribeResult())
      })
    }
    mockClient = {
      isConnected: vi.fn().mockReturnValue(true),
      getConnection: vi.fn().mockReturnValue(mockConnection),
      connect: vi.fn()
    }
    mockContext = { salesforceClient: mockClient }
  })

  describe('registration', () => {
    it('should register with correct name and schema', () => {
      expect(tool.definition.name).toBe('explain_query_plan')
      expect(tool.definition.description).toContain('Analyze SOQL query performance')
      expect(tool.definition.inputSchema.type).toBe('object')
      expect(tool.definition.inputSchema.properties).toHaveProperty('query')
      expect(tool.definition.inputSchema.required).toContain('query')
      expect(tool.definition.annotations?.readOnlyHint).toBe(true)
      expect(tool.definition.annotations?.idempotentHint).toBe(true)
    })
  })

  describe('input validation', () => {
    it('should validate required query parameter', async () => {
      await expect(tool.execute({}, mockContext)).rejects.toThrow('query is required')
    })

    it('should validate query format', async () => {
      await expect(tool.execute({
        query: ''
      }, mockContext)).rejects.toThrow('query must be at least 5 characters')
    })

    it('should validate query type', async () => {
      await expect(tool.execute({
        query: 123
      }, mockContext)).rejects.toThrow('query must be a string')
    })
  })

  describe('performance analysis', () => {
    it('should analyze basic query performance', async () => {
      const result = await tool.execute({
        query: 'SELECT Id, Name FROM Account'
      }, mockContext)

      expect(result.content).toHaveLength(1)
      expect(result.content[0].type).toBe('text')
      
      const parsedResult = JSON.parse(result.content[0].text)
      expect(parsedResult.query).toBe('SELECT Id, Name FROM Account')
      expect(parsedResult.performance).toBeDefined()
      expect(parsedResult.performance.estimatedCost).toBe('LOW')
      expect(parsedResult.performance.indexedFields).toBeDefined()
      expect(parsedResult.performance.selectivity).toBeDefined()
    })

    it('should identify indexed fields in WHERE clause', async () => {
      const result = await tool.execute({
        query: 'SELECT Id, Name FROM Account WHERE Id = \'001000000000000\''
      }, mockContext)

      const parsedResult = JSON.parse(result.content[0].text)
      expect(parsedResult.performance.indexedFields).toContain('Id')
      expect(parsedResult.performance.estimatedCost).toBe('LOW')
    })

    it('should detect non-selective queries', async () => {
      const result = await tool.execute({
        query: 'SELECT Id, Name, Industry, Type FROM Account WHERE CreatedDate > LAST_N_DAYS:365'
      }, mockContext)

      const parsedResult = JSON.parse(result.content[0].text)
      expect(parsedResult.performance.estimatedCost).toBe('HIGH')
      expect(parsedResult.warnings).toContain('Large date range query may be slow')
    })

    it('should analyze ORDER BY performance impact', async () => {
      const result = await tool.execute({
        query: 'SELECT Id, Name FROM Account ORDER BY Name'
      }, mockContext)

      const parsedResult = JSON.parse(result.content[0].text)
      expect(parsedResult.performance.sortingCost).toBeDefined()
      expect(parsedResult.recommendations).toContain('Consider adding index on Name field for ORDER BY')
    })
  })

  describe('optimization recommendations', () => {
    it('should recommend LIMIT for potentially large results', async () => {
      const result = await tool.execute({
        query: 'SELECT Id, Name, Industry FROM Account'
      }, mockContext)

      const parsedResult = JSON.parse(result.content[0].text)
      expect(parsedResult.recommendations).toContain('Add LIMIT clause to control result size')
    })

    it('should recommend field selection optimization', async () => {
      const result = await tool.execute({
        query: 'SELECT * FROM Account'
      }, mockContext)

      const parsedResult = JSON.parse(result.content[0].text)
      expect(parsedResult.recommendations).toContain('Avoid SELECT * - specify only needed fields')
    })

    it('should suggest index usage for WHERE conditions', async () => {
      const result = await tool.execute({
        query: 'SELECT Id FROM Account WHERE Industry = \'Technology\''
      }, mockContext)

      const parsedResult = JSON.parse(result.content[0].text)
      expect(parsedResult.recommendations).toContain('Consider creating index on Industry field')
    })
  })

  describe('execution plan analysis', () => {
    it('should provide execution steps breakdown', async () => {
      const result = await tool.execute({
        query: 'SELECT Id, Name FROM Account WHERE Type = \'Customer\' ORDER BY Name LIMIT 10'
      }, mockContext)

      const parsedResult = JSON.parse(result.content[0].text)
      expect(parsedResult.executionPlan).toBeDefined()
      expect(parsedResult.executionPlan.steps).toHaveLength(4) // Filter, Sort, Limit, Select
      expect(parsedResult.executionPlan.steps[0].operation).toBe('FILTER')
      expect(parsedResult.executionPlan.steps[1].operation).toBe('SORT')
      expect(parsedResult.executionPlan.steps[2].operation).toBe('LIMIT')
      expect(parsedResult.executionPlan.steps[3].operation).toBe('SELECT')
    })

    it('should estimate row counts at each step', async () => {
      const result = await tool.execute({
        query: 'SELECT Id FROM Account WHERE Type = \'Customer\' LIMIT 5'
      }, mockContext)

      const parsedResult = JSON.parse(result.content[0].text)
      expect(parsedResult.executionPlan.estimatedRows).toBeDefined()
      expect(parsedResult.executionPlan.estimatedRows.initial).toBeGreaterThan(0)
      expect(parsedResult.executionPlan.estimatedRows.afterFilter).toBeDefined()
      expect(parsedResult.executionPlan.estimatedRows.final).toBe(5)
    })
  })

  describe('subquery analysis', () => {
    it('should analyze subquery performance impact', async () => {
      const result = await tool.execute({
        query: 'SELECT Id, (SELECT Id FROM Contacts) FROM Account'
      }, mockContext)

      const parsedResult = JSON.parse(result.content[0].text)
      expect(parsedResult.subqueries).toHaveLength(1)
      expect(parsedResult.subqueries[0].performance.estimatedCost).toBeDefined()
      expect(parsedResult.performance.hasSubqueries).toBe(true)
    })

    it('should recommend subquery optimization', async () => {
      const result = await tool.execute({
        query: 'SELECT Id, (SELECT Id FROM Contacts), (SELECT Id FROM Opportunities) FROM Account'
      }, mockContext)

      const parsedResult = JSON.parse(result.content[0].text)
      expect(parsedResult.recommendations).toContain('Multiple subqueries may impact performance')
    })
  })

  describe('error handling', () => {
    it('should handle connection errors gracefully', async () => {
      mockClient.isConnected.mockReturnValue(false)
      mockClient.getConnection.mockReturnValue(null)

      await expect(tool.execute({
        query: 'SELECT Id FROM Account'
      }, mockContext)).rejects.toThrow('No Salesforce connection available')
    })

    it('should handle invalid SOQL gracefully', async () => {
      const result = await tool.execute({
        query: 'INVALID QUERY'
      }, mockContext)

      const parsedResult = JSON.parse(result.content[0].text)
      expect(parsedResult.isValid).toBe(false)
      expect(parsedResult.errors).toBeDefined()
    })
  })

  describe('syntax validation bug fixes', () => {
    it('should detect missing comma between field names', async () => {
      const result = await tool.execute({
        query: 'SELECT Id Name FROM Account WHERE Industry = \'Technology\''
      }, mockContext)

      const parsedResult = JSON.parse(result.content[0].text)
      expect(parsedResult.isValid).toBe(false)
      expect(parsedResult.errors).toContain('Missing comma between field names')
    })

    it('should detect incomplete WHERE clause at end of query', async () => {
      const result = await tool.execute({
        query: 'SELECT Id, Name FROM Account WHERE'
      }, mockContext)

      const parsedResult = JSON.parse(result.content[0].text)
      expect(parsedResult.isValid).toBe(false)
      expect(parsedResult.errors).toContain('Incomplete WHERE clause')
    })

    it('should detect WHERE clause missing conditions before ORDER BY', async () => {
      const result = await tool.execute({
        query: 'SELECT Id, Name FROM Account WHERE ORDER BY Name'
      }, mockContext)

      const parsedResult = JSON.parse(result.content[0].text)
      expect(parsedResult.isValid).toBe(false)
      expect(parsedResult.errors).toContain('WHERE clause missing conditions')
    })

    it('should allow valid function calls without comma errors', async () => {
      const result = await tool.execute({
        query: 'SELECT COUNT(Id) FROM Account'
      }, mockContext)

      const parsedResult = JSON.parse(result.content[0].text)
      expect(parsedResult.isValid).toBe(true)
      // When valid, there should be no errors property or it should be empty
      if (parsedResult.errors) {
        expect(parsedResult.errors).not.toContain('Missing comma between field names')
      }
    })

    it('should allow valid aggregate functions with alias', async () => {
      const result = await tool.execute({
        query: 'SELECT MAX(Amount) MaxAmount FROM Opportunity'
      }, mockContext)

      const parsedResult = JSON.parse(result.content[0].text)
      expect(parsedResult.isValid).toBe(true)
      // When valid, there should be no errors property or it should be empty
      if (parsedResult.errors) {
        expect(parsedResult.errors).not.toContain('Missing comma between field names')
      }
    })

    it('should detect missing comma in multi-field selection', async () => {
      const result = await tool.execute({
        query: 'SELECT Id Name Industry Type FROM Account'
      }, mockContext)

      const parsedResult = JSON.parse(result.content[0].text)
      expect(parsedResult.isValid).toBe(false)
      expect(parsedResult.errors).toContain('Missing comma between field names')
    })

    it('should handle valid queries with proper comma separation', async () => {
      const result = await tool.execute({
        query: 'SELECT Id, Name, Industry, Type FROM Account WHERE Industry = \'Technology\''
      }, mockContext)

      const parsedResult = JSON.parse(result.content[0].text)
      expect(parsedResult.isValid).toBe(true)
      // When valid, errors property may not exist or should be empty
      if (parsedResult.errors) {
        expect(parsedResult.errors).toHaveLength(0)
      }
    })
  })
})

function createMockDescribeResult() {
  return {
    name: 'Account',
    label: 'Account',
    labelPlural: 'Accounts',
    keyPrefix: '001',
    createable: true,
    updateable: true,
    deletable: true,
    queryable: true,
    searchable: true,
    custom: false,
    recordTypeInfos: [
      {
        name: 'Master',
        recordTypeId: '012000000000000AAA',
        defaultRecordTypeMapping: true,
        master: true,
        available: true
      }
    ],
    fields: [
      {
        name: 'Id',
        label: 'Account ID',
        type: 'id',
        length: 18,
        createable: false,
        updateable: false,
        nillable: false,
        unique: true,
        custom: false
      },
      {
        name: 'Name',
        label: 'Account Name',
        type: 'string',
        length: 255,
        createable: true,
        updateable: true,
        nillable: false,
        unique: false,
        custom: false
      }
    ]
  }
}

describe('GetOrgLimitsTool', () => {
  let tool: GetOrgLimitsTool
  let mockClient: SalesforceClient
  let mockContext: ToolExecutionContext

  beforeEach(() => {
    tool = new GetOrgLimitsTool()
    mockClient = createMockSalesforceClient()
    
    // Set up connection mock with request method
    const mockConnection = {
      request: vi.fn()
    }
    vi.spyOn(mockClient, 'getConnection').mockReturnValue(mockConnection)
    
    mockContext = { salesforceClient: mockClient }
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('registration', () => {
    test('should have correct tool definition', () => {
      const definition = tool.definition
      
      expect(definition.name).toBe('get_org_limits')
      expect(definition.description).toContain('Retrieve Salesforce organization limits')
      expect(definition.inputSchema.type).toBe('object')
      expect(definition.inputSchema.properties).toEqual({})
      expect(definition.inputSchema.required).toEqual([])
      expect(definition.annotations?.readOnlyHint).toBe(true)
      expect(definition.annotations?.idempotentHint).toBe(true)
    })
  })

  describe('input validation', () => {
    test('should accept empty parameters', async () => {
      const mockConnection = mockClient.getConnection()!
      vi.mocked(mockConnection.request).mockResolvedValue({
        DailyApiRequests: { Max: 15000, Remaining: 14500 },
        DataStorageMB: { Max: 5, Remaining: 2 }
      })

      const result = await tool.execute({}, mockContext)
      expect(result).toBeDefined()
    })

    test('should accept parameters with extra properties', async () => {
      const mockConnection = mockClient.getConnection()!
      vi.mocked(mockConnection.request).mockResolvedValue({
        DailyApiRequests: { Max: 15000, Remaining: 14500 }
      })

      const result = await tool.execute({ extraParam: 'ignored' }, mockContext)
      expect(result).toBeDefined()
    })
  })

  describe('successful execution', () => {
    test('should retrieve organization limits successfully', async () => {
      const mockLimits = {
        DailyApiRequests: { Max: 15000, Remaining: 14500 },
        DataStorageMB: { Max: 5, Remaining: 2 },
        FileStorageMB: { Max: 20, Remaining: 18 }
      }

      const mockConnection = mockClient.getConnection()!
      vi.mocked(mockConnection.request).mockResolvedValue(mockLimits)

      const result = await tool.execute({}, mockContext)

      expect(result.content).toHaveLength(1)
      expect(result.content[0].type).toBe('text')
      
      const parsedResult = JSON.parse(result.content[0].text)
      expect(parsedResult).toEqual(mockLimits)
      expect(parsedResult.DailyApiRequests.Max).toBe(15000)
      expect(parsedResult.DailyApiRequests.Remaining).toBe(14500)
    })

    test('should handle comprehensive limits response', async () => {
      const mockLimits = {
        DailyApiRequests: { Max: 15000, Remaining: 14500 },
        DataStorageMB: { Max: 5, Remaining: 2 },
        FileStorageMB: { Max: 20, Remaining: 18 },
        ConcurrentAsyncGetReportInstances: { Max: 200, Remaining: 200 },
        DailyWorkflowEmails: { Max: 390, Remaining: 390 }
      }

      const mockConnection = mockClient.getConnection()!
      vi.mocked(mockConnection.request).mockResolvedValue(mockLimits)

      const result = await tool.execute({}, mockContext)
      
      const parsedResult = JSON.parse(result.content[0].text)
      expect(Object.keys(parsedResult)).toHaveLength(5)
      expect(parsedResult.ConcurrentAsyncGetReportInstances.Max).toBe(200)
    })
  })

  describe('error handling', () => {
    test('should throw error when no connection available', async () => {
      const mockClientNoConnection = createMockSalesforceClient()
      vi.spyOn(mockClientNoConnection, 'getConnection').mockReturnValue(null)
      const contextNoConnection = { salesforceClient: mockClientNoConnection }

      await expect(
        tool.execute({}, contextNoConnection)
      ).rejects.toThrow('No Salesforce connection available')
    })

    test('should handle Salesforce API errors', async () => {
      const mockConnection = mockClient.getConnection()!
      vi.mocked(mockConnection.request).mockRejectedValue(
        new Error('INVALID_SESSION_ID: Session expired or invalid')
      )

      await expect(
        tool.execute({}, mockContext)
      ).rejects.toThrow('Failed to get organization limits: INVALID_SESSION_ID: Session expired or invalid')
    })

    test('should handle network errors', async () => {
      const mockConnection = mockClient.getConnection()!
      vi.mocked(mockConnection.request).mockRejectedValue(
        new Error('Network timeout')
      )

      await expect(
        tool.execute({}, mockContext)
      ).rejects.toThrow('Failed to get organization limits: Network timeout')
    })

    test('should handle unknown errors', async () => {
      const mockConnection = mockClient.getConnection()!
      vi.mocked(mockConnection.request).mockRejectedValue('Unknown error')

      await expect(
        tool.execute({}, mockContext)
      ).rejects.toThrow('Failed to get organization limits: Unknown error')
    })
  })

  describe('API integration', () => {
    test('should call correct Salesforce REST API endpoint', async () => {
      const mockConnection = mockClient.getConnection()!
      vi.mocked(mockConnection.request).mockResolvedValue({})

      await tool.execute({}, mockContext)

      expect(mockConnection.request).toHaveBeenCalledWith('/services/data/v59.0/limits/')
      expect(mockConnection.request).toHaveBeenCalledTimes(1)
    })

    test('should handle empty limits response', async () => {
      const mockConnection = mockClient.getConnection()!
      vi.mocked(mockConnection.request).mockResolvedValue({})

      const result = await tool.execute({}, mockContext)
      
      const parsedResult = JSON.parse(result.content[0].text)
      expect(parsedResult).toEqual({})
    })
  })
})

describe('GetUserInfoTool', () => {
  let tool: GetUserInfoTool
  let mockClient: SalesforceClient
  let mockContext: ToolExecutionContext

  beforeEach(() => {
    tool = new GetUserInfoTool()
    mockClient = createMockSalesforceClient()
    
    // Set up connection mock with query and request methods
    const mockConnection = {
      query: vi.fn(),
      request: vi.fn().mockResolvedValue({ user_id: '005000000000001AAA' })
    }
    vi.spyOn(mockClient, 'getConnection').mockReturnValue(mockConnection)
    
    mockContext = { salesforceClient: mockClient }
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('registration', () => {
    test('should have correct tool definition', () => {
      const definition = tool.definition
      
      expect(definition.name).toBe('get_user_info')
      expect(definition.description).toContain('Retrieve current user profile information')
      expect(definition.inputSchema.type).toBe('object')
      expect(definition.inputSchema.properties).toEqual({})
      expect(definition.inputSchema.required).toEqual([])
      expect(definition.annotations?.readOnlyHint).toBe(true)
      expect(definition.annotations?.idempotentHint).toBe(true)
    })
  })

  describe('input validation', () => {
    test('should accept empty parameters', async () => {
      const mockConnection = mockClient.getConnection()!
      vi.mocked(mockConnection.query).mockResolvedValue({
        totalSize: 1,
        done: true,
        records: [createMockUserRecord()]
      })

      const result = await tool.execute({}, mockContext)
      expect(result).toBeDefined()
    })

    test('should accept parameters with extra properties', async () => {
      const mockConnection = mockClient.getConnection()!
      vi.mocked(mockConnection.query).mockResolvedValue({
        totalSize: 1,
        done: true,
        records: [createMockUserRecord()]
      })

      const result = await tool.execute({ extraParam: 'ignored' }, mockContext)
      expect(result).toBeDefined()
    })
  })

  describe('successful execution', () => {
    test('should retrieve current user information successfully', async () => {
      const mockUserRecord = createMockUserRecord()
      const mockConnection = mockClient.getConnection()!
      vi.mocked(mockConnection.query).mockResolvedValue({
        totalSize: 1,
        done: true,
        records: [mockUserRecord]
      })

      const result = await tool.execute({}, mockContext)

      expect(result.content).toHaveLength(1)
      expect(result.content[0].type).toBe('text')
      
      const output = result.content[0].text
      expect(output).toContain('Current User Information')
      expect(output).toContain('John Doe')
      expect(output).toContain('john.doe@example.com')
      expect(output).toContain('System Administrator')
    })

    test('should handle user with minimal information', async () => {
      const mockUserRecord = {
        Id: '005000000000001AAA',
        Name: 'Jane Smith',
        Email: 'jane.smith@example.com',
        Username: 'jane@company.com',
        IsActive: true,
        Profile: { Name: 'Standard User' }
      }
      
      const mockConnection = mockClient.getConnection()!
      vi.mocked(mockConnection.query).mockResolvedValue({
        totalSize: 1,
        done: true,
        records: [mockUserRecord]
      })

      const result = await tool.execute({}, mockContext)
      
      const output = result.content[0].text
      expect(output).toContain('Jane Smith')
      expect(output).toContain('Standard User')
      expect(output).toContain('Active: Yes')
    })

    test('should sanitize sensitive information', async () => {
      const mockUserRecord = createMockUserRecord()
      const mockConnection = mockClient.getConnection()!
      vi.mocked(mockConnection.query).mockResolvedValue({
        totalSize: 1,
        done: true,
        records: [mockUserRecord]
      })

      const result = await tool.execute({}, mockContext)
      
      const output = result.content[0].text
      // Should not contain full user ID
      expect(output).toContain('005...AAA')
      expect(output).not.toContain('005000000000001AAA')
    })
  })

  describe('error handling', () => {
    test('should throw error when no connection available', async () => {
      const mockClientNoConnection = createMockSalesforceClient()
      vi.spyOn(mockClientNoConnection, 'getConnection').mockReturnValue(null)
      const contextNoConnection = { salesforceClient: mockClientNoConnection }

      await expect(
        tool.execute({}, contextNoConnection)
      ).rejects.toThrow('No Salesforce connection available')
    })

    test('should handle no user found', async () => {
      const mockConnection = mockClient.getConnection()!
      vi.mocked(mockConnection.query).mockResolvedValue({
        totalSize: 0,
        done: true,
        records: []
      })

      await expect(
        tool.execute({}, mockContext)
      ).rejects.toThrow('Current user information not found')
    })

    test('should handle multiple users returned (should never happen)', async () => {
      const mockConnection = mockClient.getConnection()!
      vi.mocked(mockConnection.query).mockResolvedValue({
        totalSize: 2,
        done: true,
        records: [createMockUserRecord(), createMockUserRecord()]
      })

      await expect(
        tool.execute({}, mockContext)
      ).rejects.toThrow('Multiple user records returned for current user')
    })

    test('should handle Salesforce API errors', async () => {
      const mockConnection = mockClient.getConnection()!
      vi.mocked(mockConnection.query).mockRejectedValue(
        new Error('INVALID_SESSION_ID: Session expired or invalid')
      )

      await expect(
        tool.execute({}, mockContext)
      ).rejects.toThrow('Failed to get user information: INVALID_SESSION_ID: Session expired or invalid')
    })

    test('should handle network errors', async () => {
      const mockConnection = mockClient.getConnection()!
      vi.mocked(mockConnection.query).mockRejectedValue(
        new Error('Network timeout')
      )

      await expect(
        tool.execute({}, mockContext)
      ).rejects.toThrow('Failed to get user information: Network timeout')
    })

    test('should handle unknown errors', async () => {
      const mockConnection = mockClient.getConnection()!
      vi.mocked(mockConnection.query).mockRejectedValue('Unknown error')

      await expect(
        tool.execute({}, mockContext)
      ).rejects.toThrow('Failed to get user information: Unknown error')
    })

    test('should handle userinfo endpoint failure', async () => {
      const mockConnection = mockClient.getConnection()!
      mockConnection.request = vi.fn().mockRejectedValue(new Error('OAuth userinfo endpoint failed'))

      await expect(
        tool.execute({}, mockContext)
      ).rejects.toThrow('Failed to get user information: OAuth userinfo endpoint failed')
    })

    test('should handle missing user_id in userinfo response', async () => {
      const mockConnection = mockClient.getConnection()!
      mockConnection.request = vi.fn().mockResolvedValue({ organization_id: 'org123' }) // Missing user_id

      await expect(
        tool.execute({}, mockContext)
      ).rejects.toThrow('Unable to determine current user ID')
    })
  })

  describe('API integration', () => {
    test('should call userinfo endpoint and execute correct SOQL query', async () => {
      const mockConnection = mockClient.getConnection()!
      
      // Mock the request method for userinfo endpoint
      const mockRequest = vi.fn().mockResolvedValue({ user_id: '005000000000001AAA' })
      mockConnection.request = mockRequest
      
      vi.mocked(mockConnection.query).mockResolvedValue({
        totalSize: 1,
        done: true,
        records: [createMockUserRecord()]
      })

      await tool.execute({}, mockContext)

      // Verify userinfo endpoint was called
      expect(mockRequest).toHaveBeenCalledWith('/services/oauth2/userinfo')
      expect(mockRequest).toHaveBeenCalledTimes(1)
      
      // Verify SOQL query with user ID
      expect(mockConnection.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT Id, Name, Email, Username, IsActive, Title, Department, Division, CompanyName, Phone, MobilePhone, Alias, TimeZoneSidKey, LocaleSidKey, LanguageLocaleKey, EmailEncodingKey, UserType, Profile.Name FROM User WHERE Id = \'005000000000001AAA\'')
      )
      expect(mockConnection.query).toHaveBeenCalledTimes(1)
    })
  })

  describe('output formatting', () => {
    test('should format user information in readable format', async () => {
      const mockUserRecord = createMockUserRecord()
      const mockConnection = mockClient.getConnection()!
      vi.mocked(mockConnection.query).mockResolvedValue({
        totalSize: 1,
        done: true,
        records: [mockUserRecord]
      })

      const result = await tool.execute({}, mockContext)
      
      const output = result.content[0].text
      expect(output).toContain('Current User Information')
      expect(output).toContain('User ID:')
      expect(output).toContain('Name:')
      expect(output).toContain('Email:')
      expect(output).toContain('Username:')
      expect(output).toContain('Profile:')
      expect(output).toContain('Active:')
    })

    test('should handle missing optional fields gracefully', async () => {
      const mockUserRecord = {
        Id: '005000000000001AAA',
        Name: 'Test User',
        Email: 'test@example.com',
        Username: 'test@company.com',
        IsActive: true,
        Profile: { Name: 'Standard User' }
        // Missing optional fields like Title, Department, etc.
      }
      
      const mockConnection = mockClient.getConnection()!
      vi.mocked(mockConnection.query).mockResolvedValue({
        totalSize: 1,
        done: true,
        records: [mockUserRecord]
      })

      const result = await tool.execute({}, mockContext)
      
      const output = result.content[0].text
      expect(output).toContain('Test User')
      expect(output).toContain('Standard User')
      // Should handle missing fields gracefully
      expect(output).not.toContain('undefined')
      expect(output).not.toContain('null')
    })
  })
})

function createMockUserRecord() {
  return {
    Id: '005000000000001AAA',
    Name: 'John Doe',
    Email: 'john.doe@example.com',
    Username: 'john.doe@company.com',
    IsActive: true,
    Title: 'Senior Developer',
    Department: 'Engineering',
    Division: 'Technology',
    CompanyName: 'Acme Corp',
    Phone: '+1-555-0123',
    MobilePhone: '+1-555-0124',
    Alias: 'jdoe',
    TimeZoneSidKey: 'America/New_York',
    LocaleSidKey: 'en_US',
    LanguageLocaleKey: 'en_US',
    EmailEncodingKey: 'UTF-8',
    UserType: 'Standard',
    Profile: {
      Name: 'System Administrator'
    }
  }
}

describe('GetRecentItemsTool', () => {
  let tool: GetRecentItemsTool
  let mockClient: SalesforceClient
  let mockContext: ToolExecutionContext

  beforeEach(() => {
    tool = new GetRecentItemsTool()
    mockClient = createMockSalesforceClient()
    
    // Set up connection mock with request method
    const mockConnection = {
      request: vi.fn().mockResolvedValue(createMockRecentItemsResponse())
    }
    vi.spyOn(mockClient, 'getConnection').mockReturnValue(mockConnection)
    
    mockContext = { salesforceClient: mockClient }
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('registration', () => {
    test('should have correct tool definition', () => {
      const definition = tool.definition
      
      expect(definition.name).toBe('get_recent_items')
      expect(definition.description).toContain('Retrieve recently accessed items')
      expect(definition.inputSchema.type).toBe('object')
      expect(definition.inputSchema.properties).toEqual({})
      expect(definition.inputSchema.required).toEqual([])
      expect(definition.annotations?.readOnlyHint).toBe(true)
      expect(definition.annotations?.idempotentHint).toBe(true)
    })
  })

  describe('input validation', () => {
    test('should accept empty parameters', async () => {
      const result = await tool.execute({}, mockContext)
      expect(result).toBeDefined()
    })

    test('should accept parameters with extra properties', async () => {
      const result = await tool.execute({ extraParam: 'ignored' }, mockContext)
      expect(result).toBeDefined()
    })
  })

  describe('successful execution', () => {
    test('should retrieve recent items successfully', async () => {
      const mockItems = createMockRecentItemsResponse()
      const mockConnection = mockClient.getConnection()!
      vi.mocked(mockConnection.request).mockResolvedValue(mockItems)

      const result = await tool.execute({}, mockContext)

      expect(result.content).toHaveLength(1)
      expect(result.content[0].type).toBe('text')
      
      const output = result.content[0].text
      expect(output).toContain('Recently Accessed Items')
      expect(output).toContain('Acme Corp')
      expect(output).toContain('John Doe')
      expect(output).toContain('Account')
      expect(output).toContain('Contact')
    })

    test('should handle empty recent items list', async () => {
      const mockConnection = mockClient.getConnection()!
      vi.mocked(mockConnection.request).mockResolvedValue([])

      const result = await tool.execute({}, mockContext)
      
      const output = result.content[0].text
      expect(output).toContain('No recent items found')
    })

    test('should format different object types correctly', async () => {
      const mockItems = [
        {
          attributes: { type: 'Account', url: '/services/data/v59.0/sobjects/Account/001xxx' },
          Id: '001000000000001AAA',
          Name: 'Test Account'
        },
        {
          attributes: { type: 'Opportunity', url: '/services/data/v59.0/sobjects/Opportunity/006xxx' },
          Id: '006000000000001AAA',
          Name: 'Big Deal'
        },
        {
          attributes: { type: 'Case', url: '/services/data/v59.0/sobjects/Case/500xxx' },
          Id: '500000000000001AAA',
          Subject: 'Customer Issue'
        }
      ]
      
      const mockConnection = mockClient.getConnection()!
      vi.mocked(mockConnection.request).mockResolvedValue(mockItems)

      const result = await tool.execute({}, mockContext)
      
      const output = result.content[0].text
      expect(output).toContain('Account: Test Account')
      expect(output).toContain('Opportunity: Big Deal')
      expect(output).toContain('Case: Customer Issue')
    })

    test('should sanitize record IDs in output', async () => {
      const mockItems = createMockRecentItemsResponse()
      const mockConnection = mockClient.getConnection()!
      vi.mocked(mockConnection.request).mockResolvedValue(mockItems)

      const result = await tool.execute({}, mockContext)
      
      const output = result.content[0].text
      // Should show sanitized IDs
      expect(output).toContain('001...AAA')
      expect(output).toContain('003...BBB')
      // Should not show full IDs
      expect(output).not.toContain('001000000000001AAA')
      expect(output).not.toContain('003000000000001BBB')
    })

    test('should handle items with missing name fields gracefully', async () => {
      const mockItems = [
        {
          attributes: { type: 'Account', url: '/services/data/v59.0/sobjects/Account/001xxx' },
          Id: '001000000000001AAA'
          // Missing Name field
        },
        {
          attributes: { type: 'CustomObject__c', url: '/services/data/v59.0/sobjects/CustomObject__c/a00xxx' },
          Id: 'a00000000000001AAA',
          Title__c: 'Custom Title Field'
        }
      ]
      
      const mockConnection = mockClient.getConnection()!
      vi.mocked(mockConnection.request).mockResolvedValue(mockItems)

      const result = await tool.execute({}, mockContext)
      
      const output = result.content[0].text
      expect(output).toContain('Account: [No name available]')
      expect(output).toContain('CustomObject__c: Custom Title Field')
      expect(output).not.toContain('undefined')
      expect(output).not.toContain('null')
    })
  })

  describe('error handling', () => {
    test('should throw error when no connection available', async () => {
      const mockClientNoConnection = createMockSalesforceClient()
      vi.spyOn(mockClientNoConnection, 'getConnection').mockReturnValue(null)
      const contextNoConnection = { salesforceClient: mockClientNoConnection }

      await expect(
        tool.execute({}, contextNoConnection)
      ).rejects.toThrow('No Salesforce connection available')
    })

    test('should handle Salesforce API errors', async () => {
      const mockConnection = mockClient.getConnection()!
      vi.mocked(mockConnection.request).mockRejectedValue(
        new Error('INVALID_SESSION_ID: Session expired or invalid')
      )

      await expect(
        tool.execute({}, mockContext)
      ).rejects.toThrow('Failed to get recent items: INVALID_SESSION_ID: Session expired or invalid')
    })

    test('should handle network errors', async () => {
      const mockConnection = mockClient.getConnection()!
      vi.mocked(mockConnection.request).mockRejectedValue(
        new Error('Network timeout')
      )

      await expect(
        tool.execute({}, mockContext)
      ).rejects.toThrow('Failed to get recent items: Network timeout')
    })

    test('should handle unknown errors', async () => {
      const mockConnection = mockClient.getConnection()!
      vi.mocked(mockConnection.request).mockRejectedValue('Unknown error')

      await expect(
        tool.execute({}, mockContext)
      ).rejects.toThrow('Failed to get recent items: Unknown error')
    })

    test('should handle permission errors', async () => {
      const mockConnection = mockClient.getConnection()!
      vi.mocked(mockConnection.request).mockRejectedValue(
        new Error('INSUFFICIENT_ACCESS: User lacks permission to access recent items')
      )

      await expect(
        tool.execute({}, mockContext)
      ).rejects.toThrow('Failed to get recent items: INSUFFICIENT_ACCESS: User lacks permission to access recent items')
    })
  })

  describe('API integration', () => {
    test('should call correct REST API endpoint', async () => {
      const mockConnection = mockClient.getConnection()!
      
      await tool.execute({}, mockContext)

      expect(mockConnection.request).toHaveBeenCalledWith('/services/data/v59.0/recent')
      expect(mockConnection.request).toHaveBeenCalledTimes(1)
    })

    test('should handle API response format correctly', async () => {
      const mockItems = createMockRecentItemsResponse()
      const mockConnection = mockClient.getConnection()!
      vi.mocked(mockConnection.request).mockResolvedValue(mockItems)

      const result = await tool.execute({}, mockContext)
      
      expect(result.content).toHaveLength(1)
      expect(result.content[0].type).toBe('text')
      expect(typeof result.content[0].text).toBe('string')
    })
  })

  describe('output formatting', () => {
    test('should format recent items in readable format', async () => {
      const mockItems = createMockRecentItemsResponse()
      const mockConnection = mockClient.getConnection()!
      vi.mocked(mockConnection.request).mockResolvedValue(mockItems)

      const result = await tool.execute({}, mockContext)
      
      const output = result.content[0].text
      expect(output).toContain('Recently Accessed Items')
      expect(output).toContain('Total items:')
      expect(output).toMatch(/\d+\.\s+Account:/)
      expect(output).toMatch(/\d+\.\s+Contact:/)
      expect(output).toContain('ID:')
    })

    test('should show item count in summary', async () => {
      const mockItems = createMockRecentItemsResponse()
      const mockConnection = mockClient.getConnection()!
      vi.mocked(mockConnection.request).mockResolvedValue(mockItems)

      const result = await tool.execute({}, mockContext)
      
      const output = result.content[0].text
      expect(output).toContain('Total items: 2')
    })
  })
})

function createMockRecentItemsResponse() {
  return [
    {
      attributes: {
        type: 'Account',
        url: '/services/data/v59.0/sobjects/Account/001000000000001AAA'
      },
      Id: '001000000000001AAA',
      Name: 'Acme Corp'
    },
    {
      attributes: {
        type: 'Contact',
        url: '/services/data/v59.0/sobjects/Contact/003000000000001BBB'
      },
      Id: '003000000000001BBB',
      Name: 'John Doe'
    }
  ]
}

describe('DescribeLayoutTool', () => {
  let tool: DescribeLayoutTool
  let mockContext: ToolExecutionContext
  let mockConnection: any

  beforeEach(() => {
    tool = new DescribeLayoutTool()
    mockConnection = {
      request: vi.fn()
    }
    mockContext = {
      salesforceClient: {
        isConnected: vi.fn().mockReturnValue(true),
        connect: vi.fn(),
        getConnection: vi.fn().mockReturnValue(mockConnection)
      } as any,
      logger: createChildLogger('test')
    }
  })

  describe('registration', () => {
    it('should be registered in the tool registry', () => {
      const registry = new ToolRegistry(createChildLogger('test'))
      expect(registry.getTool('describe_layout')).toBeInstanceOf(DescribeLayoutTool)
    })
  })

  describe('input validation', () => {
    it('should require objectName parameter', async () => {
      await expect(tool.execute({}, mockContext)).rejects.toThrow(ToolError)
    })

    it('should reject empty objectName', async () => {
      await expect(tool.execute({ objectName: '' }, mockContext)).rejects.toThrow(ToolError)
    })

    it('should reject non-string objectName', async () => {
      await expect(tool.execute({ objectName: 123 }, mockContext)).rejects.toThrow(ToolError)
    })

    it('should accept valid objectName', async () => {
      mockConnection.request.mockResolvedValue(createMockLayoutResponse())
      const result = await tool.execute({ objectName: 'Account' }, mockContext)
      expect(result).toBeDefined()
    })
  })

  describe('successful execution', () => {
    it('should retrieve layout for standard object', async () => {
      const mockResponse = createMockLayoutResponse()
      mockConnection.request.mockResolvedValue(mockResponse)

      const result = await tool.execute({ objectName: 'Account' }, mockContext)

      expect(mockConnection.request).toHaveBeenCalledWith('/services/data/v59.0/sobjects/Account/describe/layouts')
      expect(result.content).toHaveLength(1)
      expect(result.content[0].type).toBe('text')
      expect(result.content[0].text).toContain('Account Layout Information')
    })

    it('should retrieve layout for custom object', async () => {
      const mockResponse = createMockLayoutResponse('Custom__c')
      mockConnection.request.mockResolvedValue(mockResponse)

      const result = await tool.execute({ objectName: 'Custom__c' }, mockContext)

      expect(mockConnection.request).toHaveBeenCalledWith('/services/data/v59.0/sobjects/Custom__c/describe/layouts')
      expect(result.content[0].text).toContain('Custom__c Layout Information')
    })

    it('should handle layouts with record types', async () => {
      const mockResponse = createMockLayoutResponse('Account', 'PersonAccount')
      mockConnection.request.mockResolvedValue(mockResponse)

      const result = await tool.execute({ objectName: 'Account', recordTypeId: '012000000000001AAA' }, mockContext)

      expect(result.content[0].text).toContain('Record Type: PersonAccount')
    })

    it('should format layout sections properly', async () => {
      const mockResponse = createMockLayoutResponse()
      mockConnection.request.mockResolvedValue(mockResponse)

      const result = await tool.execute({ objectName: 'Account' }, mockContext)

      expect(result.content[0].text).toContain('Sections:')
      expect(result.content[0].text).toContain('- Account Information')
      expect(result.content[0].text).toContain('  Fields: Name, Type')
    })

    it('should sanitize sensitive IDs in output', async () => {
      const mockResponse = createMockLayoutResponse()
      mockConnection.request.mockResolvedValue(mockResponse)

      const result = await tool.execute({ objectName: 'Account' }, mockContext)

      expect(result.content[0].text).not.toContain('012000000000001AAA')
      expect(result.content[0].text).toContain('012...AAA')
    })
  })

  describe('error handling', () => {
    it('should handle connection errors', async () => {
      mockContext.salesforceClient.isConnected = vi.fn().mockReturnValue(false)
      mockContext.salesforceClient.connect = vi.fn().mockRejectedValue(new Error('Connection failed'))

      await expect(tool.execute({ objectName: 'Account' }, mockContext)).rejects.toThrow(ToolError)
    })

    it('should handle API errors', async () => {
      mockConnection.request.mockRejectedValue(new Error('Invalid object'))

      await expect(tool.execute({ objectName: 'InvalidObject' }, mockContext)).rejects.toThrow(ToolError)
    })

    it('should handle missing connection', async () => {
      mockContext.salesforceClient.getConnection = vi.fn().mockReturnValue(null)

      await expect(tool.execute({ objectName: 'Account' }, mockContext)).rejects.toThrow(ToolError)
    })
  })

  describe('API integration', () => {
    it('should use correct REST API endpoint', async () => {
      mockConnection.request.mockResolvedValue(createMockLayoutResponse())

      await tool.execute({ objectName: 'Account' }, mockContext)

      expect(mockConnection.request).toHaveBeenCalledWith('/services/data/v59.0/sobjects/Account/describe/layouts')
    })

    it('should handle record type parameter', async () => {
      mockConnection.request.mockResolvedValue(createMockLayoutResponse())

      await tool.execute({ objectName: 'Account', recordTypeId: '012000000000001AAA' }, mockContext)

      expect(mockConnection.request).toHaveBeenCalledWith('/services/data/v59.0/sobjects/Account/describe/layouts/012000000000001AAA')
    })
  })

  describe('output formatting', () => {
    it('should format minimal layout data', async () => {
      const mockResponse = { layouts: [] }
      mockConnection.request.mockResolvedValue(mockResponse)

      const result = await tool.execute({ objectName: 'Account' }, mockContext)

      expect(result.content[0].text).toContain('Account Layout Information')
      expect(result.content[0].text).toContain('No layouts available')
    })

    it('should handle layout without sections', async () => {
      const mockResponse = {
        layouts: [{
          name: 'Account Layout',
          sections: []
        }]
      }
      mockConnection.request.mockResolvedValue(mockResponse)

      const result = await tool.execute({ objectName: 'Account' }, mockContext)

      expect(result.content[0].text).toContain('No sections available')
    })
  })
})

function createMockLayoutResponse(objectName = 'Account', recordTypeName = 'Master') {
  const sectionData = {
    label: `${objectName} Information`,
    columns: 2,
    rows: 2,
    layoutRows: [{
      layoutItems: [{
        layoutComponents: [{
          type: 'Field',
          value: 'Name'
        }]
      }, {
        layoutComponents: [{
          type: 'Field', 
          value: 'Type'
        }]
      }]
    }]
  }
  
  return {
    layouts: [{
      name: `${objectName} Layout`,
      recordTypeName: recordTypeName,
      // Include both possible section formats for robust testing
      sections: [sectionData],
      detailLayoutSections: [sectionData]
    }],
    recordTypeMappings: [{
      recordTypeId: '012000000000001AAA',
      layoutId: '00h000000000001AAA'
    }]
  }
}