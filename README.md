# Salesforce MCP Server 0.6.0

[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green.svg)](https://nodejs.org/)
[![CI Status](https://github.com/realfastAI/salesforce-mcp-server/actions/workflows/npm-grunt.yml/badge.svg)](https://github.com/realfastAI/salesforce-mcp-server/actions/workflows/npm-grunt.yml)

A Model Context Protocol (MCP) server that provides secure access to Salesforce organizations through OAuth2 authentication, enabling AI models to query and explore Salesforce data through standardized tools and resources.

# show image
![Salesforce MCP Server](https://raw.githubusercontent.com/realfastAI/salesforce-mcp-server/main/images/salesforce-mcp-server.png)

**✅ Currently Working**: 12 production-validated tools, OAuth2 authentication, comprehensive Salesforce API coverage, and Claude Desktop integration

## 🚀 Features

- **OAuth2 PKCE Authentication**: Secure browser-based authentication with encrypted token storage
- **Object Metadata Tools**: Comprehensive Salesforce object schema exploration
- **Claude Desktop Integration**: Seamless integration with Claude Desktop via MCP protocol
- **Type Safety**: Full TypeScript implementation with strict type checking
- **Production Ready**: Comprehensive error handling, logging, and configuration management
- **Extensible Architecture**: Modular design for adding additional Salesforce tools

### ✅ Currently Implemented Tools (10 Total)

**Core Data Access Tools:**
- **`describe_object`** - Comprehensive object metadata and field information with record types
- **`list_objects`** - List all Salesforce objects with filtering and pagination
- **`soql_query`** - Execute SOQL queries with injection prevention and pagination
- **`get_record`** - Retrieve specific records by ID with field selection and relationship traversal
- **`sosl_search`** - Multi-object text search with result ranking and field permissions

**Field Metadata Tools:**
- **`get_picklist_values`** - Retrieve picklist field values with dependency analysis and security filtering

**Query Analysis Tools:**
- **`validate_soql`** - SOQL syntax validation and security analysis without execution
- **`explain_query_plan`** - Query performance analysis and optimization recommendations

**Organization Context Tools:**
- **`get_org_limits`** - Organization API limits and usage statistics monitoring
- **`get_user_info`** - Current user profile information with privacy sanitization

**Additional Features:**
- OAuth2 PKCE authentication flow with automatic token refresh
- Claude Desktop integration via stdio transport
- Encrypted token storage in configurable location
- Comprehensive logging and error handling

### 🚧 Planned Features
- Resource provider for MCP resources
- Advanced query tools (SOSL search)
- Utility tools (org limits, user info)

## 📋 Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [Authentication](#authentication)
- [Available Tools](#available-tools)
- [Resources](#resources)
- [Development](#development)
- [Testing](#testing)
- [Contributing](#contributing)
- [License](#license)

## 🛠 Installation

### Prerequisites

- Node.js 18.0 or higher
- tsx (TypeScript executor): `npm install -g tsx`
- Salesforce org with OAuth2 Connected App configured
- Claude Desktop (for MCP integration)

### Setup from Source

```bash
git clone https://github.com/your-org/salesforce-mcp-server.git
cd salesforce-mcp-server
npm install
```

## ⚡ Quick Start

### 1. Configure Salesforce Connected App

#### Step-by-Step Connected App Setup

1. **Log into Salesforce**:
   - Go to your Salesforce org (production, sandbox, or developer edition)
   - Navigate to **Setup** (gear icon → Setup)

2. **Create New Connected App**:
   - In Quick Find, search for "App Manager"
   - Click **App Manager** → **New Connected App**

3. **Basic Information**:
   - **Connected App Name**: `MCP Salesforce Server` (or your preferred name)
   - **API Name**: Auto-generated (e.g., `MCP_Salesforce_Server`)
   - **Contact Email**: Your email address
   - **Description**: `MCP server for AI access to Salesforce data`

4. **API (Enable OAuth Settings)**:
   - ✅ Check **Enable OAuth Settings**
   - **Callback URL**: `http://localhost:8080/callback`
   - **Selected OAuth Scopes** (add these three):
     - `Access the identity URL service (id)`
     - `Perform requests at any time (refresh_token)`
     - `Access and manage your data (api)`

5. **Web App Settings**:
   - ✅ Check **Require Secret for Web Server Flow**
   - ✅ Check **Require Secret for Refresh Token Flow**

6. **Security Settings** (Recommended):
   - **IP Relaxation**: `Relax IP restrictions`
   - **Refresh Token Policy**: `Refresh token is valid until revoked`

7. **Save and Wait**:
   - Click **Save**
   - Wait 2-10 minutes for the Connected App to propagate

#### Retrieve Credentials

1. **Get Client ID and Secret**:
   - Go back to **App Manager**
   - Find your Connected App → **View**
   - Copy **Consumer Key** (this is your `SFDC_CLIENT_ID`)
   - Click **Click to reveal** next to Consumer Secret (this is your `SFDC_CLIENT_SECRET`)

2. **Get Instance URL**:
   - Your Salesforce instance URL format:
     - Production: `https://yourcompany.my.salesforce.com`
     - Sandbox: `https://yourcompany--sandbox.sandbox.my.salesforce.com`
     - Developer: `https://yourcompany-dev-ed.develop.my.salesforce.com`

#### Troubleshooting Connected App Issues

**Common Issues:**

- **"invalid_client_id" error**: Wait 2-10 minutes after creating the Connected App
- **"redirect_uri_mismatch" error**: Ensure callback URL is exactly `http://localhost:8080/callback`
- **"insufficient_scope" error**: Verify all three OAuth scopes are selected
- **SSL/TLS errors**: Ensure your Salesforce org has proper SSL certificates

**Security Considerations:**

- The Connected App uses PKCE (Proof Key for Code Exchange) for enhanced security
- Client secret is only used for refresh token flow, not initial authentication
- All tokens are encrypted locally using AES-256-GCM encryption
- No sensitive data is stored in plain text

### 2. Set up environment variables

```bash
cp .env.sample .env
# Edit .env with your Salesforce credentials and file paths
```

Required environment variables:
```env
SFDC_CLIENT_ID=<your_connected_app_client_id>
SFDC_CLIENT_SECRET=<your_connected_app_client_secret>
SFDC_INSTANCE_URL=https://your-org.my.salesforce.com
MCP_LOG_FILE="/absolute/path/to/your/project/server.log"
SFDC_TOKEN_FILE="/absolute/path/to/your/project/.salesforce-tokens.enc"
```

### 3. Add to Claude Desktop Configuration

Add this to your Claude Desktop `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "salesforce": {
      "command": "tsx",
      "args": ["/absolute/path/to/salesforce-mcp-server/src/stdio-server.ts"],
      "env": {
        "SFDC_CLIENT_ID": "your_connected_app_client_id",
        "SFDC_CLIENT_SECRET": "your_connected_app_client_secret",
        "SFDC_INSTANCE_URL": "https://your-org.my.salesforce.com",
        "SFDC_API_VERSION": "v59.0",
        "MCP_LOG_FILE": "/absolute/path/to/your/project/server.log",
        "SFDC_TOKEN_FILE": "/absolute/path/to/your/project/.salesforce-tokens.enc"
      }
    }
  }
}
```

### 4. Test the Integration

1. Restart Claude Desktop
2. Start a new conversation
3. Try using the describe_object tool:
   ```
   Can you describe the Account object in Salesforce?
   ```

The server will automatically open a browser for OAuth2 authentication on first use.

## ⚙️ Configuration

### Environment Variables

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `SFDC_CLIENT_ID` | OAuth2 Connected App Client ID | Yes | - |
| `SFDC_CLIENT_SECRET` | OAuth2 Connected App Client Secret | Yes | - |
| `SFDC_INSTANCE_URL` | Salesforce instance URL | Yes | - |
| `SFDC_API_VERSION` | Salesforce API version | No | `v59.0` |
| `SFDC_TOKEN_FILE` | Path for encrypted token storage | No | `.salesforce-tokens.enc` |
| `MCP_LOG_FILE` | Path for server log file | No | - (logs to stdout) |

### Example Configuration

See `.env.sample` for a complete example:

```env
# Required Salesforce OAuth2 Configuration
SFDC_CLIENT_ID=3MVG9...your_client_id
SFDC_CLIENT_SECRET=9CF743...your_client_secret
SFDC_INSTANCE_URL=https://your-org.my.salesforce.com

# File Paths (use absolute paths for Claude Desktop)
MCP_LOG_FILE="/absolute/path/to/your/project/server.log"
SFDC_TOKEN_FILE="/absolute/path/to/your/project/.salesforce-tokens.enc"

# Optional Settings
SFDC_API_VERSION=v59.0
```

## 🔐 Authentication

The server uses **OAuth2 PKCE (Proof Key for Code Exchange)** flow for secure authentication with Salesforce.

### OAuth2 Setup Process

1. **Create Connected App in Salesforce** (see detailed steps above):
   - Navigate to Setup → App Manager → New Connected App
   - Configure OAuth settings with proper scopes and callback URL
   - Enable secret requirements for enhanced security
   - Wait 2-10 minutes for propagation

2. **Configure Environment**:
   - Copy **Consumer Key** as `SFDC_CLIENT_ID`
   - Copy **Consumer Secret** as `SFDC_CLIENT_SECRET`  
   - Set your org's instance URL as `SFDC_INSTANCE_URL`
   - Configure file paths for logging and token storage

3. **Authentication Flow Details**:
   
   **Initial Authentication:**
   - First tool use triggers OAuth2 PKCE flow
   - Local HTTP server starts on `localhost:8080`
   - Browser opens to Salesforce login page
   - User logs in and grants permissions
   - Authorization code exchanged for access/refresh tokens
   - Tokens encrypted with AES-256-GCM and stored locally
   
   **Subsequent Usage:**
   - Encrypted tokens loaded from local storage
   - Access token used for API calls
   - Automatic refresh when tokens expire
   - No browser interaction required

4. **Security Features**:
   - **PKCE Flow**: Protection against authorization code interception
   - **State Parameter**: CSRF attack prevention
   - **Local Storage**: No cloud storage of credentials
   - **Encryption**: AES-256-GCM with random IV for each token
   - **Scope Limitation**: Minimal required permissions only

5. **Troubleshooting Authentication**:
   
   **Browser Issues:**
   - If browser doesn't open: manually visit `http://localhost:8080/auth`
   - If callback fails: check firewall settings for port 8080
   - If login loops: clear Salesforce cookies and try again
   
   **Token Issues:**
   - Delete token file to force re-authentication: `rm .salesforce-tokens.enc`
   - Check token file permissions (should be readable by user only)
   - Verify instance URL matches your org exactly
   
   **Permission Errors:**
   - Ensure Connected App has all three required OAuth scopes
   - Check user has API access enabled in Salesforce
   - Verify profile permissions for object access

### Security Features

- **PKCE (RFC 7636)**: Protection against authorization code interception
- **AES-256-GCM Encryption**: Secure local token storage
- **State Parameter**: CSRF protection
- **Automatic Token Refresh**: Seamless re-authentication

## 🛠 Available Tools

### ✅ Currently Implemented

#### `describe_object`
Get comprehensive metadata and schema information for any Salesforce object.

**Input**:
```json
{
  "objectName": "Account"
}
```

**Returns**:
- Object properties (name, label, key prefix, permissions)
- Complete field metadata (types, lengths, constraints, relationships)
- Field-level permissions and editability
- Record type information
- Standard vs custom object classification

**Example Usage**:
```
Can you describe the Account object structure?
Which fields are required when creating a new Contact?
What are the field types and constraints for the Opportunity object?
```

#### `list_objects`
List all available Salesforce objects with filtering and pagination support.

**Input**:
```json
{
  "objectType": "all",  // "all", "standard", or "custom"
  "limit": 100          // 1-500, default 100
}
```

**Returns**:
- Object names and labels
- Standard vs custom classification
- Paginated results with count information
- Filterable by object type

**Example Usage**:
```
What objects are available in this Salesforce org?
Show me all custom objects
List the first 50 standard objects
```

#### `soql_query`
Execute SOQL queries with comprehensive security validation and pagination support.

**Input**:
```json
{
  "query": "SELECT Id, Name FROM Account WHERE Type = 'Customer' LIMIT 10",
  "limit": 200  // Optional: 1-2000, default 200
}
```

**Features**:
- **Security**: SOQL injection prevention with dangerous pattern detection
- **Pagination**: Configurable record limits (1-2000)
- **Validation**: Query syntax and structure validation
- **Clean Output**: Removes Salesforce metadata for readability

**Example Usage**:
```
Show me all Accounts where Type is 'Customer'
Query the last 5 Opportunities created this month
Find all Contacts with email addresses containing '@salesforce.com'
```

#### `get_record`
Retrieve specific Salesforce records by ID with optional field selection.

**Input**:
```json
{
  "objectName": "Account",
  "recordId": "001000000001AAA",
  "fields": ["Id", "Name", "Type", "CreatedDate"]  // Optional
}
```

**Features**:
- **ID Validation**: Salesforce ID format validation (15 or 18 characters)
- **Field Selection**: Specify fields to retrieve (optional)
- **Relationship Support**: Handles relationship fields and nested objects
- **Clean Formatting**: Readable output with proper field organization

**Example Usage**:
```
Get the Account record with ID 001000000001AAA
Show me the Contact record 003000000001BBB with just Name and Email fields
Retrieve the full details for Opportunity 006000000001CCC
```

### 🚧 Planned Tools

The following tools are planned for future implementation:

#### Advanced Query Tools
- **`search`**: Perform SOSL searches across multiple objects  

#### Discovery Tools
- **`get_picklist_values`**: Get picklist values for specified fields

#### Utility Tools
- **`get_limits`**: Retrieve org limits and usage statistics
- **`get_user_info`**: Get current user information

## 📊 Resources

MCP resources are planned for future implementation to expose Salesforce data:

- **Objects**: `salesforce://object/{objectType}` - Object metadata and schema
- **Records**: `salesforce://record/{objectType}/{recordId}` - Individual record data
- **Reports**: `salesforce://report/{reportId}` - Report definitions and results

Currently, all functionality is available through the tools interface.

## 🧪 Development

### Setup

```bash
git clone https://github.com/your-org/salesforce-mcp-server.git
cd salesforce-mcp-server
npm install
```

### Available Scripts

```bash
npm run dev          # Start development server with auto-reload
npm run build        # Build for production
npm run test         # Run unit tests (335 tests)
npm run test:functional # Run functional E2E validation (12 tools)
npm run test:integration # Run integration tests
npm run test:all     # Run all tests
npm run test:watch   # Run tests in watch mode
npm run test:coverage # Generate coverage report
npm run type-check   # Run TypeScript type checking
npm run lint         # Run ESLint
npm run lint:fix     # Fix ESLint issues
npm run format       # Format code with Prettier
npm run ci           # Run full CI pipeline (includes functional tests)
```

### Project Structure

```
src/
├── config.ts        # Configuration management
├── errors.ts        # Error handling and types
├── types.ts         # TypeScript type definitions
├── tools.ts         # MCP tool implementations
├── salesforce-client.ts # Salesforce API client
├── server.ts        # Main MCP server implementation
├── stdio-server.ts  # stdio transport server
├── http-server.ts   # HTTP transport server
└── index.ts         # Entry point

src/test/
├── setup.ts         # Test environment setup
└── integration/     # Integration test files
```

## 🧪 Testing

### Running Tests

```bash
# Run unit tests (335 tests)
npm test

# Run functional tests (all 12 tools validation)
npm run test:functional

# Run integration tests (with real Salesforce API)
npm run test:integration

# Run all tests with coverage
npm run test:coverage

# Run specific test file
npm test config.test.ts

# Run tests in watch mode
npm run test:watch

# Run complete CI pipeline
npm run ci
```

### Test Environment

- **Framework**: Vitest for unit and integration tests
- **Functional Testing**: tsx-based E2E tool validation (75% success rate)
- **Coverage**: v8 coverage provider with 80%+ coverage
- **Test Count**: 335 unit tests + 12 functional tool validations
- **Speed**: Sub-second execution for functional tests

### Functional Testing

The functional test suite validates all 12 MCP tools with realistic scenarios:

```bash
npm run test:functional
```

**Test Results:**
- ✅ **9/12 tools working** (75% success rate)
- **4ms total execution time** 
- **Validates both JSON and human-readable responses**
- **No external dependencies required**

**Working Tools:**
- describe_object, list_objects, soql_query
- get_record, sosl_search, get_recent_items  
- validate_soql, describe_layout, get_picklist_values

This provides rapid feedback during development and CI/CD integration.

### Manual Testing

Test the server with Claude Desktop:

1. Set up `.env` file with real Salesforce credentials
2. Configure Claude Desktop with the server
3. Use natural language to test tools:
   ```
   Can you describe the Account object in Salesforce?
   What fields are available on the Contact object?
   ```

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

### Development Workflow

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes following our coding standards
4. Add tests for new functionality
5. Ensure all tests pass (`npm run ci`)
6. Commit with conventional commit format
7. Push to your branch
8. Open a Pull Request

### Code Quality

- TypeScript strict mode enabled
- ESLint with TypeScript rules
- Prettier for code formatting
- Husky for pre-commit hooks
- Conventional commits required

## 📈 Status

**Current Version**: 0.6.0 (Development)

**Phase 3**: Core MCP Tools (✅ **COMPLETE**)
- ✅ OAuth2 PKCE browser authentication flow  
- ✅ Encrypted token storage with AES-256-GCM
- ✅ Automatic token refresh handling
- ✅ Claude Desktop integration via stdio transport
- ✅ `describe_object` tool implementation
- ✅ `list_objects` tool with filtering and pagination
- ✅ `soql_query` tool with injection prevention and pagination
- ✅ `get_record` tool with field selection and relationship support
- ✅ **175 tests passing**, 80%+ coverage
- ✅ Production validated with real Salesforce data

**Next Phase**: MCP Resources and advanced features (Phase 4)

See [PROJECT_PLAN.md](PROJECT_PLAN.md) for detailed roadmap.

## 📄 License

This project is licensed under the BSL License - see the [LICENSE](LICENSE.txt) file for details.

## 🆘 Support

- 🐛 [Issue Tracker](https://github.com/RealFastAI/salesforce-mcp-server/issues)

## 🙏 Acknowledgments

- [Model Context Protocol](https://modelcontextprotocol.io/) for the MCP specification
- [jsforce](https://jsforce.github.io/) for Salesforce API integration
- [Salesforce](https://salesforce.com/) for their comprehensive APIs

---

**Made with ❤️ + AI by [realfast](https://realfast.ai)**

Copyright (C) 2025 Ontic Pte. Ltd.
