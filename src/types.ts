/*
 * Copyright (C) 2025 Ontic. Pte. Ltd. (realfast.ai)
 * Use of this software is governed by the Business Source License included in the LICENSE.TXT file and at www.mariadb.com/bsl11.
 */

export interface ServerCapabilities {
  readonly resources: {
    readonly subscribe: boolean
    readonly listChanged: boolean
  }
  readonly tools: {
    readonly listChanged: boolean
  }
  readonly prompts?: {
    readonly listChanged: boolean
  }
}

export interface McpRequest {
  readonly jsonrpc: '2.0'
  readonly id: number | string
  readonly method: string
  readonly params?: unknown
}

export interface McpNotification {
  readonly jsonrpc: '2.0'
  readonly method: string
  readonly params?: unknown
}

export interface McpResponse {
  readonly jsonrpc: '2.0'
  readonly id: number | string
  readonly result?: unknown
  readonly error?: unknown
}