<\!--
Copyright (C) 2025 Ontic. Pte. Ltd. (realfast.ai)
Use of this software is governed by the Business Source License included in the LICENSE.TXT file and at www.mariadb.com/bsl11.
-->

## Core Architecture (from src/tools.ts, src/types.ts)

### **Tool-Based Architecture**
Modular design where each functionality extends the abstract `Tool` class. Each tool implements:
- `ToolDefinition` with name, description, inputSchema, and annotations
- `execute()` method taking `ToolExecutionContext` and returning `ToolResult`
- Built-in logging via `createChildLogger('tool')`

### **ToolDefinition Interface**
Schema defining tool metadata including input validation, annotations for hints (readOnlyHint, destructiveHint, idempotentHint), and MCP protocol compliance.

### **ToolExecutionContext**
Runtime context containing `SalesforceClient` instance passed to all tool executions, enabling stateful operations with authenticated Salesforce connections.

### **MCP Protocol Types**
JSON-RPC 2.0 compliant interfaces:
- `McpRequest` with jsonrpc, id, method, params
- `McpResponse` with jsonrpc, id, result/error  
- `McpNotification` for server events
- `ServerCapabilities` defining supported features

## Authentication & Security (from src/connection-interface.ts, src/tools.ts)

### **OAuth2 PKCE Implementation**
Full browser-based authentication flow in `SalesforceConnection` class:
- `generatePKCE()` creates codeVerifier and codeChallenge using SHA256
- `startCallbackServer()` handles OAuth2 redirects on localhost
- `exchangeCodeForTokens()` exchanges authorization code for access/refresh tokens
- `TokenEncryption` class provides AES-256-GCM encryption for token storage

### **FileTokenStorage (ITokenStorage)**
Encrypted file-based token persistence implementing:
- `getTokens()`, `saveTokens()`, `clearTokens()` methods
- Automatic token refresh via `refreshAccessToken()`
- 5-minute expiry buffer in `isTokenValid()` 

### **Security Validation Methods** (SoslSearchTool)
- `validateSearchScope()` blocks restricted objects (User, Profile, PermissionSet)
- `detectSoslInjection()` prevents SOSL injection via regex patterns
- `sanitizeAndFilterResults()` removes PII and enforces field permissions
- `sanitizeSensitiveData()` masks SSN/credit card patterns with regex

### **Structured Error Handling** (src/errors.ts)
Type-safe error hierarchy with `BaseError`, `SalesforceError`, `ToolError`, `AuthenticationError`:
- MCP-compatible serialization via `createMcpError()`
- Retry logic support with `isRetriableError()` and `getRetryDelay()`
- Error codes following JSON-RPC 2.0 + application-specific extensions

## Implemented Tool Classes (src/tools.ts)

### **DescribeObjectTool**
Returns comprehensive object metadata via `connection.sobject(objectName).describe()`:
- Object properties (createable, updateable, deletable, queryable, searchable)
- Field metadata with first 10 fields displayed for readability
- RecordTypeInfos including master records and availability

### **ListObjectsTool** 
Enumerates Salesforce objects with filtering:
- `objectType` parameter: 'all', 'standard', 'custom'
- Pagination via `limit` parameter (1-500, default 100)
- Returns metadata (label, labelPlural, custom flag, keyPrefix)

### **SoqlQueryTool**
Executes parameterized SOQL queries with security controls:
- Injection prevention via `containsDangerousPatterns()` validation
- Result pagination (1-2000 limit) 
- Automatic connection handling and error translation

### **GetRecordTool**
Retrieves individual records with relationship traversal:
- Optional field selection via `fields` parameter
- Relationship formatting in `formatRecordOutput()`
- Salesforce ID validation (15/18 character format)

### **SoslSearchTool** 
Multi-object text search with enterprise security:
- `buildSoslQuery()` constructs parameterized FIND queries
- `sanitizeAndFilterResults()` applies PII masking and permission filtering
- Enhanced `formatRecordSummary()` shows detailed field information
- Comprehensive security via scope/injection/field validation

## Development Patterns (from package.json, src/logger.ts, tests)

### **TypeScript Strict Mode**
Full type safety with strict compilation options, Zod runtime validation, and comprehensive type definitions for all API interactions.

### **Vitest Testing Framework** 
Comprehensive test suite (194 tests) with:
- Unit tests with mock objects for all tool classes
- Integration tests with real Salesforce connections
- Security tests for injection prevention and data sanitization
- Performance tests for large dataset handling

### **Pino Structured Logging**
JSON-formatted logging with correlation IDs via `createChildLogger()`:
- Request tracking across tool executions
- Error context preservation with stack traces
- Development-friendly pretty printing
- Production-ready structured output

### **Quality Gate Automation** (package.json scripts)
CI pipeline ensuring code quality:
- `npm run type-check` - TypeScript compilation validation
- `npm run lint` - ESLint code quality checks
- `npm run test -- --run` - Full test suite execution  
- `npm run build` - Production build verification

## Data Patterns (from actual tool implementations)

### **Result Pagination**
Implemented limits in tool definitions:
- SOQL: 1-2000 records (default 200) via `limit` parameter
- SOSL: 1-200 records (default 20) per object type
- Object listing: 1-500 objects (default 100)

### **PII Data Sanitization Patterns** (SoslSearchTool)
Regex-based sensitive data detection and masking:
```typescript
// SSN patterns: 123-45-6789 -> ***-**-****
value.replace(/\b\d{3}-\d{2}-\d{4}\b/g, '***-**-****')
// Credit card: 4111-1111-1111-1111 -> ****-****-****-****
value.replace(/\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g, '****-****-****-****')
```

### **Field Permission Filtering**
Runtime field accessibility validation:
- Calls `connection.sobject(objectType).describe()` for field metadata
- Removes fields where `fieldInfo.accessible === false`
- Graceful fallback to basic sanitization on describe API failures

### **Query Construction Patterns**
Parameterized query building to prevent injection:
- SOQL: Direct jsforce connection query execution
- SOSL: Template-based `FIND {term} IN ALL FIELDS RETURNING Object1 LIMIT N, Object2 LIMIT N`
- ID validation: 15/18 character Salesforce ID format checking

## Security Implementation (from validateSearchScope, detectSoslInjection)

### **Restricted Object Blocking**
Hard-coded blacklist in `validateSearchScope()`:
```typescript
const restrictedObjects = [
  'User', 'Profile', 'PermissionSet', 'PermissionSetAssignment',
  'UserRole', 'UserRecordAccess', 'LoginHistory', 'AuthSession',
  'SetupEntityAccess', 'ObjectPermissions', 'FieldPermissions'
]
```

### **SOSL Injection Detection**
Pattern-based injection prevention in `detectSoslInjection()`:
```typescript
const soslInjectionPatterns = [
  /}\s*(RETURNING|IN|LIMIT)/i,  // Breaking out of search term
  /"\s*(OR|AND|UNION)/i,        // SQL-style injection
  /}\s*RETURNING\s+\w+/i,       // Direct RETURNING injection
]
```

### **Multi-Layer Input Validation**
Combined validation approach:
1. Schema validation via Zod/JSON Schema in tool definitions
2. Business logic validation (length, format, patterns)
3. Security validation (injection detection, scope checking)
4. Salesforce API validation (final gatekeeping)

## Key Dependencies (from package.json)

### **Runtime Dependencies**
- `@modelcontextprotocol/sdk` - Official MCP protocol implementation
- `jsforce` - Salesforce API client library with full CRUD/query support
- `pino` - High-performance JSON logging library
- `zod` - TypeScript-first schema validation library
- `ajv` - JSON Schema validator for input validation

### **Development Dependencies**
- `vitest` - Fast unit test runner with native TypeScript support
- `@typescript-eslint/*` - TypeScript-specific linting rules
- `prettier` - Code formatting for consistent style
- `tsx` - TypeScript execution for development
- `husky` + `lint-staged` - Git hooks for code quality enforcement

## Project Structure (from actual codebase)

### **Core Modules**
- `src/index.ts` - Main entry point and CLI handling
- `src/server.ts` - MCP server implementation
- `src/tools.ts` - All tool class implementations (846 lines)
- `src/salesforce-client.ts` - Salesforce connection management
- `src/connection-interface.ts` - OAuth2/PKCE authentication (520 lines)

### **Supporting Infrastructure**  
- `src/types.ts` - MCP protocol type definitions
- `src/errors.ts` - Structured error handling system (252 lines)
- `src/logger.ts` - Correlation ID-based logging utilities
- `src/config.ts` - Environment configuration management

## Implementation Metrics (from codebase analysis)

### **Code Complexity**
- 194 tests across 7 test suites (100% passing)
- 846 lines in `tools.ts` (core functionality)
- 520 lines in `connection-interface.ts` (OAuth2/PKCE)
- 252 lines in `errors.ts` (error handling)

### **Security Features**
- 17+ restricted objects blocked in search scope
- 6 SOSL injection patterns detected
- PII masking for SSN, credit cards, and sensitive field names
- Field-level permission validation via Salesforce describe API

### **Tool Implementations**
- 5 fully implemented tools: describe_object, list_objects, soql_query, get_record, sosl_search
- Each tool includes comprehensive input validation, error handling, and security controls
- All tools support proper authentication, logging, and MCP protocol compliance

---

*This glossary reflects actual implementation details extracted from the codebase following "The Pragmatic Programmer" principle of maintaining accurate, code-derived documentation. All references include source file locations for verification.*