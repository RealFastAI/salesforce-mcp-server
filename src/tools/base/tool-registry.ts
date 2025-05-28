/*
 * Copyright (C) 2025 Ontic Pte. Ltd. (realfast.ai)
 * Use of this software is governed by the Business Source License included in the LICENSE.TXT file and at www.mariadb.com/bsl11.
 */

import { Tool, type ToolDefinition, type ToolExecutionContext, type ToolResult } from './tool.js'
import { ToolError, ErrorCode } from '../../errors.js'
import { createChildLogger } from '../../logger.js'

// Import all tools
import {
  DescribeObjectTool,
  ListObjectsTool,
  SoqlQueryTool
} from '../salesforce/index.js'

import {
  GetRecordTool,
  SoslSearchTool
} from '../search/index.js'

import {
  DescribeLayoutTool
} from '../layout/index.js'

import {
  GetRecentItemsTool,
  GetOrgLimitsTool,
  GetUserInfoTool
} from '../admin/index.js'

import {
  GetPicklistValuesTool,
  ValidateSoqlTool,
  ExplainQueryPlanTool
} from '../analysis/index.js'

export class ToolRegistry {
  private tools = new Map<string, Tool>()
  private readonly logger = createChildLogger('tool-registry')

  constructor() {
    this.registerTool(new DescribeObjectTool())
    this.registerTool(new ListObjectsTool())
    this.registerTool(new SoqlQueryTool())
    this.registerTool(new GetRecordTool())
    this.registerTool(new SoslSearchTool())
    this.registerTool(new GetPicklistValuesTool())
    this.registerTool(new ValidateSoqlTool())
    this.registerTool(new ExplainQueryPlanTool())
    this.registerTool(new GetOrgLimitsTool())
    this.registerTool(new GetUserInfoTool())
    this.registerTool(new GetRecentItemsTool())
    this.registerTool(new DescribeLayoutTool())
  }

  registerTool(tool: Tool): void {
    this.tools.set(tool.definition.name, tool)
    this.logger.debug({ toolName: tool.definition.name }, 'Registered tool')
  }

  getTool(name: string): Tool | undefined {
    return this.tools.get(name)
  }

  listTools(): ToolDefinition[] {
    return Array.from(this.tools.values()).map(tool => tool.definition)
  }

  async executeTool(name: string, params: any, context: ToolExecutionContext): Promise<ToolResult> {
    const tool = this.getTool(name)
    if (!tool) {
      throw new ToolError(`Tool '${name}' not found`, ErrorCode.METHOD_NOT_FOUND, name)
    }

    this.logger.info({ toolName: name, params }, 'Executing tool')
    const result = await tool.execute(params, context)
    this.logger.debug({ toolName: name }, 'Tool execution completed')
    
    return result
  }
}