<\!--
Copyright (C) 2025 Ontic Pte. Ltd. (realfast.ai)
Use of this software is governed by the Business Source License included in the LICENSE.TXT file and at www.mariadb.com/bsl11.
-->

## Overview
This MCP (Model Context Protocol) server provides read-only programmatic access to Salesforce organizations, enabling AI models to query and explore Salesforce data through standardized tools and resources.

## Core Functionality

### Authentication
- **OAuth 2.0 PKCE Flow**: ✅ Secure browser-based OAuth authentication with PKCE
- **JWT Bearer Token**: 🚧 Support for server-to-server authentication (planned)
- **Session Management**: ✅ Automatic token refresh and encrypted session handling
- **Multi-Org Support**: 🚧 Ability to connect to multiple Salesforce orgs (planned)

### Resources
The server exposes Salesforce data as MCP resources:

#### Object Data (`salesforce://object/{objectType}`)
- **Standard Objects**: Account, Contact, Lead, Opportunity, Case, etc.
- **Custom Objects**: All custom objects ending with `__c`
- **Metadata**: Field definitions, relationships, validation rules

#### Records (`salesforce://record/{objectType}/{recordId}`)
- Individual record access with full field data
- Related record navigation through relationships

#### Reports (`salesforce://report/{reportId}`)
- Access to existing Salesforce reports
- Report metadata and execution results

#### Dashboards (`salesforce://dashboard/{dashboardId}`)
- Dashboard definitions and component data

### Tools
The server provides tools for Salesforce operations:

#### Query Tools
- **`soql_query`**: ✅ Execute SOQL queries with pagination support and injection prevention
- **`sosl_search`**: ✅ Perform SOSL searches across multiple objects with result ranking
- **`validate_soql`**: ✅ Validate SOQL syntax without execution with security analysis
- **`explain_query_plan`**: 🚧 Get query execution plan for optimization

#### Metadata Tools
- **`describe_object`**: ✅ Get comprehensive object metadata and schema information
- **`list_objects`**: ✅ List all available objects (standard and custom) with filtering
- **`get_record`**: ✅ Retrieve a specific record by ID with field selection
- **`get_picklist_values`**: ✅ Get picklist values for specified fields with dependencies
- **`get_limits`**: 🚧 Retrieve org limits and usage statistics
- **`get_user_info`**: 🚧 Get current user information

#### Utility Tools
- **`get_recent_items`**: 🚧 Get recently viewed/modified items

## Technical Architecture

### Core Components

#### `SalesforceClient`
- Handles authentication and API communication
- Manages connection pooling and rate limiting
- Provides low-level REST API access
- Implements exponential backoff for retries
- Thread-safe connection management

#### `ResourceProvider`
- Implements MCP resource interface
- Maps Salesforce data to MCP resource format
- Handles resource discovery and caching
- Supports lazy loading of large datasets
- Implements immutable data structures

#### `ToolProvider`
- Implements MCP tool interface
- Validates tool inputs using JSON Schema
- Executes read-only Salesforce operations
- Provides detailed error context and suggestions
- Implements request/response logging

#### `AuthManager`
- Manages OAuth flows and token lifecycle
- Handles multiple org authentication
- Implements secure credential storage

### Data Models

#### Connection Configuration
```typescript
interface SalesforceConnection {
  readonly instanceUrl: string;
  readonly clientId: string;
  readonly clientSecret?: string;
  readonly privateKey?: string;
  readonly username?: string;
  readonly apiVersion: string;
  readonly timeout: number;
  readonly maxRetries: number;
}
```

#### Query Results
```typescript
interface QueryResult<T = SalesforceRecord> {
  readonly totalSize: number;
  readonly done: boolean;
  readonly nextRecordsUrl?: string;
  readonly records: readonly T[];
}

interface SalesforceRecord {
  readonly Id: string;
  readonly attributes: {
    readonly type: string;
    readonly url: string;
  };
  readonly [key: string]: unknown;
}
```

#### Error Handling
```typescript
interface SalesforceError {
  readonly errorCode: string;
  readonly message: string;
  readonly fields?: readonly string[];
  readonly statusCode?: number;
  readonly requestId?: string;
}

interface ToolError extends Error {
  readonly code: string;
  readonly context?: Record<string, unknown>;
  readonly retryable: boolean;
}
```

## Quality Requirements

### Performance
- ✅ Query response time < 2 seconds for standard operations
- ✅ Support for result pagination to handle large datasets (1-2000 records)
- ✅ Connection pooling to minimize authentication overhead

### Reliability
- ✅ Automatic retry logic for transient failures
- 🚧 Circuit breaker pattern for API rate limiting (planned)
- ✅ Graceful degradation when Salesforce is unavailable

### Security
- ✅ Secure credential storage (AES-256-GCM encrypted tokens)
- ✅ Input validation and sanitization for all operations
- ✅ Rate limiting to prevent API abuse
- ✅ SOQL injection prevention with comprehensive pattern detection
- ✅ Principle of least privilege for API permissions
- ✅ Comprehensive audit logging for all operations

### Maintainability
- Clean separation of concerns between components
- Comprehensive error handling and logging
- Type safety throughout the codebase
- Unit test coverage > 80%
- Functional programming patterns where applicable
- Immutable data structures
- Clear dependency injection
- Structured logging with correlation IDs

## Configuration

### Environment Variables
- `SFDC_CLIENT_ID`: OAuth client ID
- `SFDC_CLIENT_SECRET`: OAuth client secret
- `SFDC_PRIVATE_KEY_PATH`: Path to JWT private key
- `SFDC_USERNAME`: Username for JWT flow
- `SFDC_INSTANCE_URL`: Salesforce instance URL
- `SFDC_API_VERSION`: API version (default: v59.0)

### Server Configuration
```typescript
interface ServerConfig {
  readonly name: string;
  readonly version: string;
  readonly capabilities: {
    readonly resources: boolean;
    readonly tools: boolean;
    readonly prompts: boolean;
  };
  readonly salesforce: SalesforceConnection;
  readonly logging: {
    readonly level: 'debug' | 'info' | 'warn' | 'error';
    readonly structured: boolean;
  };
  readonly cache: {
    readonly enabled: boolean;
    readonly ttlSeconds: number;
    readonly maxEntries: number;
  };
}
```

## Testing Strategy

### Unit Tests ✅ IMPLEMENTED
- ✅ 281 comprehensive unit tests across 7 test suites
- ✅ Mock Salesforce API responses for consistent testing
- ✅ Test all tool operations with edge cases and error scenarios
- ✅ Validate authentication flows and token refresh mechanisms
- ✅ Comprehensive query validation testing (21 ValidateSoqlTool tests)
- ✅ Test immutability and side-effect freedom

### Integration Tests ✅ IMPLEMENTED
- ✅ Test against real Salesforce Developer Edition org
- ✅ Validate end-to-end workflows with OAuth2 PKCE flow
- ✅ Test pagination and large result sets handling
- ✅ Verify security constraints and injection prevention
- ✅ Test connection resilience and recovery patterns
- ✅ Validate MCP protocol compliance with Claude Desktop

### Performance Tests 🚧 PLANNED
- 🚧 Measure query response times under load
- 🚧 Test concurrent request handling
- 🚧 Validate rate limiting behavior

## Technology Stack

### Core Dependencies

#### MCP Framework
- **`@modelcontextprotocol/sdk`**: Official TypeScript SDK for MCP server implementation
- **`@modelcontextprotocol/types`**: TypeScript type definitions for MCP protocol

#### Salesforce Integration
- **`jsforce`**: Primary Salesforce REST API client library
- **`@types/jsforce`**: TypeScript definitions for jsforce

#### Runtime & Build Tools
- **`typescript`**: TypeScript compiler and type checking
- **`tsx`**: TypeScript execution environment for development
- **`node`**: Node.js runtime (v18+ required for modern features)

#### Configuration & Environment
- **`dotenv`**: Environment variable management
- **`zod`**: Runtime type validation and parsing
- **`ajv`**: JSON Schema validation for tool inputs

#### Logging & Monitoring
- **`pino`**: High-performance structured logging
- **`pino-pretty`**: Pretty-printing for development logs

#### Error Handling & Resilience
- **`p-retry`**: Exponential backoff retry logic
- **`p-timeout`**: Promise timeout handling
- **`circuit-breaker-js`**: Circuit breaker pattern implementation

#### Caching
- **`lru-cache`**: In-memory LRU caching for API responses
- **`keyv`**: Simple key-value storage abstraction

#### Security
- **`crypto`**: Built-in Node.js cryptography (JWT handling)
- **`validator`**: Input sanitization and validation

### Development Dependencies

#### Testing Framework
- **`vitest`**: Fast unit test runner with TypeScript support
- **`@vitest/coverage-v8`**: Code coverage reporting
- **`msw`**: Mock Service Worker for API mocking
- **`@types/node`**: Node.js type definitions

#### Code Quality
- **`eslint`**: Code linting with TypeScript support
- **`@typescript-eslint/parser`**: TypeScript parser for ESLint
- **`@typescript-eslint/eslint-plugin`**: TypeScript-specific ESLint rules
- **`prettier`**: Code formatting
- **`husky`**: Git hooks for pre-commit checks
- **`lint-staged`**: Run linters on staged files

#### Build & Development
- **`rimraf`**: Cross-platform file/directory removal
- **`nodemon`**: Development server with auto-restart
- **`concurrently`**: Run multiple commands concurrently

### Architecture Rationale

#### Functional Programming Support
- **Immutable data structures**: Using `readonly` types and avoiding mutations
- **Pure functions**: Functions without side effects where possible
- **Composition over inheritance**: Favor function composition and dependency injection

#### Type Safety
- **Strict TypeScript**: Enable all strict type checking options
- **Runtime validation**: Use Zod for validating external data
- **Branded types**: Create distinct types for IDs and sensitive data

#### Performance Considerations
- **Connection pooling**: Reuse Salesforce connections efficiently
- **Lazy loading**: Load resources on-demand
- **Streaming**: Support streaming large datasets
- **Caching**: Cache frequently accessed metadata and query results

#### Security Best Practices
- **Input validation**: Validate all inputs before processing
- **SOQL injection prevention**: Parameterized queries and input sanitization
- **Credential security**: Never log or expose credentials
- **Rate limiting**: Respect Salesforce API limits

## Success Criteria

1. **Functional**: All specified tools and resources work correctly
2. **Performance**: Meets response time requirements
3. **Reliability**: Handles errors gracefully without crashes
4. **Security**: Passes security review for credential handling
5. **Maintainability**: Code is well-structured and testable
6. **Compliance**: Follows MCP specification correctly