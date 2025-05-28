<\!--
Copyright (C) 2025 Ontic Pte. Ltd. (realfast.ai)
Use of this software is governed by the Business Source License included in the LICENSE.TXT file and at www.mariadb.com/bsl11.
-->

## Overview

The `apex_find_usages` tool will provide advanced code analysis capabilities for Salesforce Apex codebases by indexing and analyzing local file systems. This tool enables comprehensive type usage discovery across Apex classes, interfaces, enums, and custom objects.

## Implementation Context

Based on analysis of the existing apex indexer implementation at `/Users/sidu/Work/realfast/apex-monorepo/indexer`, this tool will leverage:

### Core Data Structures
> **Reference**: `/apex-monorepo/indexer/src/sfdc/project/workspace.ts` (lines 30-33)
- **Type Definition Index**: `{ [ApexClassName | ApexInterfaceName]: string }` - Maps type names to file paths
- **Type Reference Index**: `{ [ApexTypeRefName]: Set<string> }` - Maps type names to sets of files that reference them
- **Compressed JSON Storage**: Efficient file-based index storage

### Architecture Patterns
> **Reference**: `/apex-monorepo/indexer/src/config.ts` (OpenAI, Neo4j integration patterns)
- **Direct API Integration**: Uses Salesforce REST/Tooling APIs to extract metadata
- **ANTLR Apex Parser**: Uses `@apexdevtools/apex-parser` for AST generation and type extraction
- **In-Memory Processing**: Processes Apex code directly without local file system
- **JSON Index Storage**: Compressed JSON files for efficient storage and loading

## Index Building Process

### API-Based Metadata Extraction
The tool uses direct Salesforce API integration to build indexes without requiring local file systems or SFDX CLI.

#### Apex Class Extraction
```typescript
class SalesforceMetadataExtractor {
  private connection: SalesforceConnection;

  async extractApexClasses(): Promise<ApexClassMetadata[]> {
    // Query all Apex classes via REST API
    const classes = await this.connection.query(`
      SELECT Id, Name, Body, NamespacePrefix, CreatedDate, LastModifiedDate
      FROM ApexClass 
      WHERE Body != null
      ORDER BY Name
    `);

    return classes.records.map(cls => ({
      id: cls.Id,
      name: cls.Name,
      body: cls.Body,
      namespace: cls.NamespacePrefix,
      lastModified: cls.LastModifiedDate
    }));
  }

  async extractCustomObjects(): Promise<CustomObjectMetadata[]> {
    // Use Tooling API for object definitions
    const objects = await this.connection.tooling.query(`
      SELECT DeveloperName, Label, NamespacePrefix
      FROM CustomObject
    `);

    // Get field definitions for each object
    const objectsWithFields = await Promise.all(
      objects.records.map(async obj => ({
        name: obj.DeveloperName,
        label: obj.Label,
        namespace: obj.NamespacePrefix,
        fields: await this.extractObjectFields(obj.DeveloperName)
      }))
    );

    return objectsWithFields;
  }
}
```

#### ANTLR Parser Implementation Details

> **Reference Files**:
> - `/apex-monorepo/indexer/src/parser/parser.ts` - Parser creation and setup
> - `/apex-monorepo/indexer/src/parser/listeners.ts` - ApexRealfastParserListener implementation  
> - `/apex-monorepo/indexer/src/parser/visitors.ts` - ClassSummarizingVisitor implementation
> - `/apex-monorepo/indexer/src/parser/apexErrorListeners.ts` - Error handling
> - `/apex-monorepo/indexer/src/parser/types.ts` - Type definitions

Based on the existing apex-monorepo indexer implementation, the parser uses a sophisticated listener and visitor pattern:

```typescript
// Parser setup with error handling
// Source: /apex-monorepo/indexer/src/parser/parser.ts
function createParser(input: string): [ApexParser, ApexRealfastParserListener] {
  const lexer = new ApexLexer(new CaseInsensitiveInputStream(CharStreams.fromString(input)));
  lexer.removeErrorListeners();
  lexer.addErrorListener(new LexerErrorListener());

  const tokens = new CommonTokenStream(lexer);
  const listener = new ApexRealfastParserListener();
  const parser = new ApexParser(tokens);

  parser.removeErrorListeners();
  parser.addErrorListener(new ParserErrorListener());

  return [parser, listener];
}

// Main listener for type extraction
// Source: /apex-monorepo/indexer/src/parser/listeners.ts (lines 6-47)
class ApexRealfastParserListener implements ApexParserListener {
  public classes: ApexClass[] = [];
  public interfaces: ApexInterface[] = [];
  public typeRefs: ApexTypeRef[] = [];

  // Extract type references with precise position data
  exitTypeRef(ctx: TypeRefContext): void {
    this.typeRefs.push({
      'ApexTypeRef': ctx.text,
      startIndex: ctx.start.startIndex,
      stopIndex: ctx.stop?.stopIndex,
      startLine: ctx.start.line,
      stopLine: ctx.stop?.line,
      startCharPositionInLine: ctx.start.charPositionInLine,
      stopCharPositionInLine: ctx.stop?.charPositionInLine,
    });
  }

  // Extract interface definitions
  exitInterfaceDeclaration(ctx: InterfaceDeclarationContext): void {
    this.interfaces.push({'ApexInterface': ctx.id().text});
  }

  // Extract class definitions with summarization
  exitClassDeclaration(ctx: ClassDeclarationContext): void {
    let classSummarizingVisitor = new ClassSummarizingVisitor();
    ctx.accept(classSummarizingVisitor);
    this.classes.push({
      'ApexClass': ctx.id().text,
      'SummarizedClass': classSummarizingVisitor.summarizedClass
    });
  }
}

// Visitor for class structure summarization  
// Source: /apex-monorepo/indexer/src/parser/visitors.ts (lines 19-255)
class ClassSummarizingVisitor implements ApexParserVisitor<void> {
  public summarizedClass: string = "";
  private modifiersList: string[] = [];
  private classAnnotationsList: string[] = [];
  private methodSummaries: string[] = [];

  visitClassDeclaration(ctx: ClassDeclarationContext): void {
    const className = ctx.id().text;
    
    // Extract inheritance relationships
    let extendsClause = "";
    let implementsClause = "";
    
    if (ctx.EXTENDS()) {
      const typeRefCtx = ctx.typeRef();
      if (typeRefCtx) {
        extendsClause = ` extends ${this.getTypeRefText(typeRefCtx)}`;
      }
    }
    
    if (ctx.IMPLEMENTS()) {
      const typeListCtx = ctx.typeList();
      if (typeListCtx) {
        implementsClause = ` implements ${typeListCtx.text}`;
      }
    }

    // Build class signature with modifiers and annotations
    const modifiers = this.modifiersList.join(' ');
    const annotations = this.classAnnotationsList.join('\n');
    const classDeclaration = `${annotations ? annotations + '\n' : ''}${modifiers ? modifiers + ' ' : ''}class ${className}${extendsClause}${implementsClause}`;

    // Process class body for methods
    const classBodyCtx = ctx.classBody();
    if (classBodyCtx) {
      classBodyCtx.accept(this);
    }

    // Generate summarized class with method signatures
    const methodSignatures = this.methodSummaries.map(sig => `  ${sig}`).join('\n');
    this.summarizedClass = `${classDeclaration} {\n${methodSignatures}\n}`;
  }

  visitMethodDeclaration(ctx: MethodDeclarationContext): void {
    // Extract return type
    let returnType = 'void';
    const typeRef = ctx.typeRef();
    if (typeRef) {
      returnType = this.getTypeRefText(typeRef);
    }

    const methodName = ctx.id().text;

    // Extract parameters with types
    let parameters = '()';
    const paramsCtx = ctx.formalParameters();
    if (paramsCtx) {
      parameters = this.collectParameters(paramsCtx);
    }

    // Build method signature with modifiers and annotations
    const modifiers = this.currentMethodModifiers.join(' ');
    const annotations = this.currentMethodAnnotations.join('\n');
    let methodSignature = '';
    if (annotations) methodSignature += `${annotations}\n`;
    if (modifiers) methodSignature += `${modifiers} `;
    methodSignature += `${methodName}${parameters}: ${returnType};`;

    this.methodSummaries.push(methodSignature.trim());
  }
}

// Error handling for malformed Apex code
// Source: /apex-monorepo/indexer/src/parser/apexErrorListeners.ts (lines 25-26)
class ParserErrorListener implements ANTLRErrorListener<Token> {
  public errors: ANTLRRecognizerError<Token>[] = [];

  syntaxError(recognizer: Recognizer<Token, any>, offendingSymbol: Token | undefined, 
             line: number, charPositionInLine: number, msg: string, 
             e: RecognitionException | undefined): void {
    this.errors.push({
      recognizer,
      token: offendingSymbol,
      line,
      charPositionInLine,
      msg
    });
  }
}
```

#### Type Analysis Workflow
```typescript
class ApexTypeAnalyzer {
  async analyzeApexClass(classBody: string, className: string): Promise<ClassAnalysis> {
    try {
      // Create parser with error handling
      const [parser, listener] = createParser(classBody);
      
      // Parse compilation unit
      const context = parser.compilationUnit();
      
      // Walk parse tree to extract all type information
      ParseTreeWalker.DEFAULT.walk(listener, context);
      
      // Extract usage context for each type reference
      const enrichedTypeRefs = listener.typeRefs.map(typeRef => ({
        ...typeRef,
        context: this.determineUsageContext(typeRef, classBody),
        codeSnippet: this.extractCodeSnippet(classBody, typeRef.startLine)
      }));
      
      return {
        className,
        definedTypes: listener.classes,
        interfaces: listener.interfaces,
        referencedTypes: enrichedTypeRefs,
        summary: listener.classes[0]?.SummarizedClass || '',
        parseErrors: parser.numberOfSyntaxErrors > 0 ? this.getParserErrors(parser) : []
      };
      
    } catch (error) {
      console.warn(`Failed to parse class ${className}: ${error.message}`);
      return {
        className,
        definedTypes: [],
        interfaces: [],
        referencedTypes: [],
        summary: '',
        parseErrors: [error.message]
      };
    }
  }

  private determineUsageContext(typeRef: ApexTypeRef, classBody: string): string {
    const lines = classBody.split('\n');
    const line = lines[typeRef.startLine - 1];
    
    // Analyze surrounding context to determine usage type
    if (line.includes('extends')) return 'inheritance';
    if (line.includes('implements')) return 'interface_implementation';
    if (line.includes('new ')) return 'instantiation';
    if (line.includes('(') && line.includes(')')) return 'parameter';
    if (line.includes('return')) return 'return_type';
    
    return 'variable';
  }

  private extractCodeSnippet(classBody: string, lineNumber: number): string {
    const lines = classBody.split('\n');
    const startLine = Math.max(0, lineNumber - 2);
    const endLine = Math.min(lines.length - 1, lineNumber + 1);
    
    return lines.slice(startLine, endLine + 1).join('\n');
  }
}
```

## Index Design for API-Based Processing

### Design Considerations

The index schema must accommodate API-based incremental processing, which differs significantly from workspace-based batch processing:

**API Processing Constraints:**
- **One class at a time**: Salesforce API returns individual ApexClass records
- **No file paths**: Uses Salesforce IDs instead of file system paths  
- **Forward references**: Class A may reference Class B before B is processed
- **Incremental updates**: Must handle partial index updates efficiently
- **Cross-org consistency**: Track dependencies across entire organization

**Comparison with Current Implementation:**
> **Reference**: `/apex-monorepo/indexer/src/sfdc/project/workspace.ts` (lines 30-33)
> 
> Current workspace approach uses:
> - `apexTypesDefinedAtPath_Index: { [typeName]: filePath }`
> - `apexTypesReferencedAtPaths_Index: { [typeName]: Set<filePaths> }`
>
> API approach requires additional layers for incremental processing and cross-class resolution.

### Index Schema Architecture

```typescript
// Top-level index data structure optimized for API processing
interface ApexIndexData {
  metadata: IndexMetadata;
  classes: ClassIndex;              // Core class storage
  typeDefinitions: TypeDefinitionIndex;  // Fast type lookup
  typeReferences: TypeReferenceIndex;    // Fast usage lookup  
  unresolvedReferences: UnresolvedReferenceIndex; // Forward references
  objectMetadata: ObjectMetadataIndex;
}

// Enhanced metadata for incremental processing
interface IndexMetadata {
  buildTimestamp: string;
  sourceOrgId: string;
  sourceOrgName?: string;
  totalClasses: number;
  processedClasses: number;
  lastIncrementalUpdate?: string;
  version: string;
  processingStatus: {
    completed: boolean;
    currentBatch?: number;
    totalBatches?: number;
    failedClasses: string[];  // IDs of classes that failed to process
  };
}

// Per-class storage for incremental processing
interface ClassIndex {
  [classId: string]: ClassEntry;
}

interface ClassEntry {
  // Salesforce metadata
  id: string;
  name: string;
  namespace?: string;
  lastModified: string;
  createdDate: string;
  
  // Processing metadata  
  processedAt: string;
  processingVersion: string;
  parseSuccess: boolean;
  parseErrors?: string[];
  
  // Extracted type information
  definedTypes: ExtractedType[];      // Classes/interfaces defined in this class
  referencedTypes: ExtractedReference[];  // Types this class references
  summary?: string;                   // Summarized class code
  
  // Dependency tracking
  dependsOn: string[];               // Class IDs this class depends on
  usedBy: string[];                  // Class IDs that depend on this class
}

interface ExtractedType {
  typeName: string;
  type: 'class' | 'interface' | 'enum' | 'inner_class';
  lineNumber: number;
  modifiers: string[];
  superclass?: string;
  interfaces?: string[];
  namespace?: string;
}

interface ExtractedReference {
  typeName: string;
  lineNumber: number;
  columnNumber: number;
  context: 'variable' | 'parameter' | 'return_type' | 'inheritance' | 'instantiation' | 'method_call';
  containingMethod?: string;
  codeSnippet: string;
  resolved: boolean;                 // Whether this reference has been resolved
  resolvedToClassId?: string;        // ID of class that defines this type
}

// Optimized lookup indexes (rebuilt from ClassIndex)
interface TypeDefinitionIndex {
  [typeName: string]: {
    classId: string;
    className: string;
    type: 'class' | 'interface' | 'enum';
    namespace?: string;
    lastModified: string;
  };
}

interface TypeReferenceIndex {
  [typeName: string]: TypeUsage[];
}

interface TypeUsage {
  classId: string;
  className: string;
  lineNumber: number;
  columnNumber: number;
  context: string;
  containingMethod?: string;
  codeSnippet: string;
  lastModified: string;             // For cache invalidation
}

// Handle forward references during incremental processing
interface UnresolvedReferenceIndex {
  [typeName: string]: UnresolvedReference[];
}

interface UnresolvedReference {
  referencingClassId: string;
  referencingClassName: string;
  lineNumber: number;
  columnNumber: number;
  context: string;
  codeSnippet: string;
  firstSeenAt: string;              // When this unresolved reference was first encountered
}
```

### Incremental Processing Workflow

```typescript
interface IIncrementalBuilder {
  processClass(classMetadata: ApexClassMetadata): Promise<void>;
}

class IncrementalBuilder implements IIncrementalBuilder {
  private data: ApexIndexData;
  
  async processClass(classMetadata: ApexClassMetadata): Promise<void> {
    const classId = classMetadata.id;
    
    // Check if class needs processing
    if (this.isClassUpToDate(classId, classMetadata.lastModified)) {
      return; // Skip if already processed and up-to-date
    }
    
    try {
      // Parse class for type information
      const analysis = await this.analyzeApexClass(classMetadata.body, classMetadata.name);
      
      // Create class entry
      const classEntry: ClassEntry = {
        id: classId,
        name: classMetadata.name,
        namespace: classMetadata.namespace,
        lastModified: classMetadata.lastModified,
        createdDate: classMetadata.createdDate,
        processedAt: new Date().toISOString(),
        processingVersion: this.index.metadata.version,
        parseSuccess: true,
        definedTypes: analysis.definedTypes,
        referencedTypes: analysis.referencedTypes,
        summary: analysis.summary,
        dependsOn: [],
        usedBy: []
      };
      
      // Store class entry
      this.data.classes[classId] = classEntry;
      
      // Update type definitions
      this.updateTypeDefinitions(classEntry);
      
      // Process references (resolve forward references)
      await this.processReferences(classEntry);
      
      // Update lookup indexes
      this.updateLookupIndexes(classEntry);
      
      // Update dependency graph
      this.updateDependencyGraph(classEntry);
      
    } catch (error) {
      // Store failed processing attempt
      this.data.classes[classId] = {
        ...this.data.classes[classId],
        processedAt: new Date().toISOString(),
        parseSuccess: false,
        parseErrors: [error.message]
      };
      
      this.data.metadata.processingStatus.failedClasses.push(classId);
    }
  }
  
  private async processReferences(classEntry: ClassEntry): Promise<void> {
    for (const ref of classEntry.referencedTypes) {
      // Try to resolve reference
      const definition = this.data.typeDefinitions[ref.typeName];
      
      if (definition) {
        // Reference resolved
        ref.resolved = true;
        ref.resolvedToClassId = definition.classId;
        
        // Add to type reference index
        if (!this.data.typeReferences[ref.typeName]) {
          this.data.typeReferences[ref.typeName] = [];
        }
        
        this.data.typeReferences[ref.typeName].push({
          classId: classEntry.id,
          className: classEntry.name,
          lineNumber: ref.lineNumber,
          columnNumber: ref.columnNumber,
          context: ref.context,
          containingMethod: ref.containingMethod,
          codeSnippet: ref.codeSnippet,
          lastModified: classEntry.lastModified
        });
        
        // Update dependency graph
        this.addDependency(classEntry.id, definition.classId);
        
      } else {
        // Forward reference - store for later resolution
        ref.resolved = false;
        
        if (!this.data.unresolvedReferences[ref.typeName]) {
          this.data.unresolvedReferences[ref.typeName] = [];
        }
        
        this.data.unresolvedReferences[ref.typeName].push({
          referencingClassId: classEntry.id,
          referencingClassName: classEntry.name,
          lineNumber: ref.lineNumber,
          columnNumber: ref.columnNumber,
          context: ref.context,
          codeSnippet: ref.codeSnippet,
          firstSeenAt: new Date().toISOString()
        });
      }
    }
  }
  
  private updateTypeDefinitions(classEntry: ClassEntry): void {
    for (const definedType of classEntry.definedTypes) {
      this.data.typeDefinitions[definedType.typeName] = {
        classId: classEntry.id,
        className: classEntry.name,
        type: definedType.type,
        namespace: definedType.namespace || classEntry.namespace,
        lastModified: classEntry.lastModified
      };
      
      // Resolve any previously unresolved references to this type
      this.resolveForwardReferences(definedType.typeName, classEntry);
    }
  }
  
  private resolveForwardReferences(typeName: string, definingClass: ClassEntry): void {
    const unresolvedRefs = this.data.unresolvedReferences[typeName];
    if (!unresolvedRefs) return;
    
    // Move unresolved references to resolved references
    for (const unresolvedRef of unresolvedRefs) {
      // Add to type reference index
      if (!this.data.typeReferences[typeName]) {
        this.data.typeReferences[typeName] = [];
      }
      
      this.data.typeReferences[typeName].push({
        classId: unresolvedRef.referencingClassId,
        className: unresolvedRef.referencingClassName,
        lineNumber: unresolvedRef.lineNumber,
        columnNumber: unresolvedRef.columnNumber,
        context: unresolvedRef.context,
        codeSnippet: unresolvedRef.codeSnippet,
        lastModified: this.data.classes[unresolvedRef.referencingClassId]?.lastModified || ''
      });
      
      // Update dependency graph
      this.addDependency(unresolvedRef.referencingClassId, definingClass.id);
      
      // Mark reference as resolved in the referencing class
      const referencingClass = this.data.classes[unresolvedRef.referencingClassId];
      if (referencingClass) {
        const ref = referencingClass.referencedTypes.find(r => 
          r.typeName === typeName && 
          r.lineNumber === unresolvedRef.lineNumber
        );
        if (ref) {
          ref.resolved = true;
          ref.resolvedToClassId = definingClass.id;
        }
      }
    }
    
    // Clear unresolved references for this type
    delete this.data.unresolvedReferences[typeName];
  }
  
  private addDependency(dependentClassId: string, dependsOnClassId: string): void {
    const dependentClass = this.data.classes[dependentClassId];
    const dependsOnClass = this.data.classes[dependsOnClassId];
    
    if (dependentClass && !dependentClass.dependsOn.includes(dependsOnClassId)) {
      dependentClass.dependsOn.push(dependsOnClassId);
    }
    
    if (dependsOnClass && !dependsOnClass.usedBy.includes(dependentClassId)) {
      dependsOnClass.usedBy.push(dependentClassId);
    }
  }
  
  private isClassUpToDate(classId: string, lastModified: string): boolean {
    const existingEntry = this.data.classes[classId];
    return existingEntry?.parseSuccess && 
           existingEntry.lastModified === lastModified &&
           existingEntry.processingVersion === this.data.metadata.version;
  }
}
```

### Performance-Optimized Index Management

#### Design Philosophy: Hybrid In-Memory Approach

For optimal performance in interactive code analysis, the index uses a hybrid in-memory design with intelligent disk persistence:

**Performance Requirements:**
- **Sub-second responses** for type usage queries
- **Interactive user experience** without I/O delays
- **Efficient memory usage** (~50-200MB for typical orgs)
- **Reliable persistence** for crash recovery and restarts

**Architecture Decision:**
```typescript
interface IApexIndex {
  findUsages(typeName: string): TypeUsage[];
  getTypeDefinition(typeName: string): TypeDefinition | undefined;
  updateClass(classMetadata: ApexClassMetadata): Promise<void>;
  getMemoryStats(): MemoryStats;
  initialize(): Promise<void>;
}

class ApexIndex implements IApexIndex {
  private data: ApexIndexData | null = null;
  private dirty: boolean = false;
  private lastPersisted: Date = new Date();
  private persistence: IndexPersistence;
  
  async initialize(): Promise<void> {
    console.log('🚀 Loading Apex index into memory...');
    this.data = await this.persistence.load();
    console.log(`📊 Index loaded: ${this.data.metadata.totalClasses} classes, ${Object.keys(this.data.typeReferences).length} types`);
    
    // Start background persistence
    this.startBackgroundPersistence();
  }
  
  // All queries operate on in-memory index for maximum performance
  findUsages(typeName: string): TypeUsage[] {
    if (!this.data) {
      throw new Error('Index not initialized');
    }
    return this.data.typeReferences[typeName] || [];
  }
  
  getTypeDefinition(typeName: string): TypeDefinition | undefined {
    if (!this.data) return undefined;
    return this.data.typeDefinitions[typeName];
  }
  
  // Incremental updates mark index as dirty
  async updateClass(classMetadata: ApexClassMetadata): Promise<void> {
    if (!this.data) return;
    
    await this.incrementalBuilder.processClass(classMetadata);
    this.dirty = true;
    this.lastPersisted = new Date();
  }
  
  // Memory usage optimization
  getMemoryStats(): MemoryStats {
    if (!this.data) return { totalSize: 0, classCount: 0 };
    
    const jsonSize = JSON.stringify(this.data).length;
    return {
      totalSize: Math.round(jsonSize / 1024 / 1024), // MB
      classCount: Object.keys(this.data.classes).length,
      typeDefinitions: Object.keys(this.data.typeDefinitions).length,
      typeReferences: Object.keys(this.data.typeReferences).length,
      unresolvedReferences: Object.keys(this.data.unresolvedReferences).length
    };
  }
  
  // Background persistence for reliability
  private startBackgroundPersistence(): void {
    // Periodic saves when dirty
    setInterval(() => {
      if (this.dirty && this.shouldPersist()) {
        this.persistToDisk();
      }
    }, 30000); // Check every 30 seconds
    
    // Graceful shutdown persistence
    process.on('SIGTERM', () => this.gracefulShutdown());
    process.on('SIGINT', () => this.gracefulShutdown());
  }
  
  private shouldPersist(): boolean {
    const timeSinceLastPersist = Date.now() - this.lastPersisted.getTime();
    return timeSinceLastPersist > 5 * 60 * 1000; // 5 minutes
  }
  
  private async persistToDisk(): Promise<void> {
    if (!this.data || !this.dirty) return;
    
    try {
      console.log('💾 Persisting index to disk...');
      await this.persistence.save(this.data);
      this.dirty = false;
      this.lastPersisted = new Date();
      console.log('✅ Index persisted successfully');
    } catch (error) {
      console.error('❌ Failed to persist index:', error);
    }
  }
  
  private async gracefulShutdown(): Promise<void> {
    if (this.dirty) {
      console.log('🔄 Saving index before shutdown...');
      await this.persistToDisk();
    }
    process.exit(0);
  }
}

interface MemoryStats {
  totalSize: number;        // Size in MB
  classCount: number;
  typeDefinitions: number;
  typeReferences: number;
  unresolvedReferences: number;
}
```

#### Memory Management Strategies

```typescript
class MemoryOptimizedApexIndex extends ApexIndex {
  // Lazy loading for large orgs
  private loadedClasses = new Set<string>();
  private classLoadPriority = new Map<string, number>();
  
  async getClassDetails(classId: string): Promise<ClassEntry> {
    if (!this.loadedClasses.has(classId)) {
      await this.loadClassOnDemand(classId);
    }
    return this.data.classes[classId];
  }
  
  // Memory pressure handling
  private async handleMemoryPressure(): Promise<void> {
    const stats = this.getMemoryStats();
    if (stats.totalSize > 1024) { // > 1GB
      await this.evictLeastUsedClasses();
    }
  }
  
  // Efficient index rebuilding
  async rebuildLookupIndexes(): Promise<void> {
    console.log('🔄 Rebuilding lookup indexes...');
    
    this.data.typeDefinitions = {};
    this.data.typeReferences = {};
    
    // Process in batches to avoid memory spikes
    const classIds = Object.keys(this.data.classes);
    const batchSize = 100;
    
    for (let i = 0; i < classIds.length; i += batchSize) {
      const batch = classIds.slice(i, i + batchSize);
      await this.processBatch(batch);
      
      // Allow event loop to breathe
      await new Promise(resolve => setImmediate(resolve));
    }
    
    console.log('✅ Lookup indexes rebuilt');
  }
}
```

### Index Persistence and Loading

```typescript
interface IIndexPersistence {
  save(data: ApexIndexData, filePath?: string): Promise<void>;
  load(filePath?: string): Promise<ApexIndexData>;
}

class IndexPersistence implements IIndexPersistence {
  async save(data: ApexIndexData, filePath?: string): Promise<void> {
    const targetPath = filePath || this.config.indexPath;
    
    // Optimize for storage - remove redundant lookup indexes (will be rebuilt on load)
    const optimizedData = this.optimizeForStorage(data);
    
    // Use atomic write for reliability
    const tempPath = `${targetPath}.tmp`;
    const json = JSON.stringify(optimizedData, null, 0); // No formatting for smaller size
    const compressed = zlib.gzipSync(json);
    
    await fs.writeFile(tempPath, compressed);
    await fs.rename(tempPath, targetPath);
    
    console.log(`💾 Index saved: ${Math.round(compressed.length / 1024)}KB compressed`);
  }
  
  async load(filePath?: string): Promise<ApexIndexData> {
    const targetPath = filePath || this.config.indexPath;
    
    if (!fs.existsSync(targetPath)) {
      console.log('📝 Creating new empty index');
      return this.createEmptyIndex();
    }
    
    try {
      const startTime = Date.now();
      const compressed = await fs.readFile(targetPath);
      const json = zlib.gunzipSync(compressed).toString();
      const rawIndex = JSON.parse(json);
      
      // Rebuild lookup indexes from class data for optimal query performance
      const data = await this.rebuildLookupIndexes(rawIndex);
      
      const loadTime = Date.now() - startTime;
      console.log(`📊 Index loaded in ${loadTime}ms: ${data.metadata.totalClasses} classes`);
      
      return data;
    } catch (error) {
      console.error('❌ Failed to load index:', error);
      console.log('📝 Creating new empty index due to load failure');
      return this.createEmptyIndex();
    }
  }
  
  private async rebuildLookupIndexes(rawData: any): Promise<ApexIndexData> {
    const data: ApexIndexData = {
      ...rawData,
      typeDefinitions: {},
      typeReferences: {},
      unresolvedReferences: rawData.unresolvedReferences || {}
    };
    
    console.log('🔄 Rebuilding lookup indexes for optimal performance...');
    
    // Rebuild type definitions and references from class entries
    const classEntries = Object.values(data.classes) as ClassEntry[];
    let processedCount = 0;
    
    for (const classEntry of classEntries) {
      // Rebuild type definitions
      for (const definedType of classEntry.definedTypes) {
        data.typeDefinitions[definedType.typeName] = {
          classId: classEntry.id,
          className: classEntry.name,
          type: definedType.type,
          namespace: definedType.namespace || classEntry.namespace,
          lastModified: classEntry.lastModified
        };
      }
      
      // Rebuild type references (only resolved ones)
      for (const ref of classEntry.referencedTypes) {
        if (ref.resolved) {
          if (!data.typeReferences[ref.typeName]) {
            data.typeReferences[ref.typeName] = [];
          }
          
          data.typeReferences[ref.typeName].push({
            classId: classEntry.id,
            className: classEntry.name,
            lineNumber: ref.lineNumber,
            columnNumber: ref.columnNumber,
            context: ref.context,
            containingMethod: ref.containingMethod,
            codeSnippet: ref.codeSnippet,
            lastModified: classEntry.lastModified
          });
        }
      }
      
      processedCount++;
      
      // Yield to event loop every 50 classes for responsiveness
      if (processedCount % 50 === 0) {
        await new Promise(resolve => setImmediate(resolve));
      }
    }
    
    console.log(`✅ Rebuilt ${Object.keys(data.typeDefinitions).length} type definitions and ${Object.keys(data.typeReferences).length} reference lists`);
    
    return data;
  }
  
  private optimizeForStorage(data: ApexIndexData): any {
    // Remove lookup indexes to save space (they'll be rebuilt on load)
    return {
      metadata: data.metadata,
      classes: data.classes,
      unresolvedReferences: data.unresolvedReferences,
      objectMetadata: data.objectMetadata
      // typeDefinitions and typeReferences are omitted - rebuilt from classes
    };
  }
  
  private createEmptyIndex(): ApexIndexData {
    return {
      metadata: {
        buildTimestamp: new Date().toISOString(),
        sourceOrgId: '',
        totalClasses: 0,
        processedClasses: 0,
        version: '1.0.0',
        processingStatus: {
          completed: false,
          failedClasses: []
        }
      },
      classes: {},
      typeDefinitions: {},
      typeReferences: {},
      unresolvedReferences: {},
      objectMetadata: {}
    };
  }
}
```

This index design provides:

1. **Incremental Processing**: Each class can be processed independently
2. **Forward Reference Handling**: Unresolved references are tracked and resolved later
3. **Efficient Updates**: Only changed classes need reprocessing
4. **Fast Lookups**: Optimized indexes for the find_usages tool
5. **Dependency Tracking**: Bidirectional dependency graphs for analysis
6. **Error Recovery**: Failed parsing attempts are tracked and can be retried

> **Integration with Current Implementation**: This design extends the patterns from `/apex-monorepo/indexer/src/sfdc/project/workspace.ts` while adapting for API-based incremental processing constraints.

interface IndexMetadata {
  buildTimestamp: string;
  sourceOrgId: string;
  sourceOrgName?: string;
  totalClasses: number;
  totalInterfaces: number;
  totalReferences: number;
  buildDurationMs: number;
  version: string;
}

interface TypeDefinitionIndex {
  [typeName: string]: {
    classId: string;              // Salesforce Id
    className: string;
    namespace?: string;
    lineNumber: number;
    type: 'class' | 'interface' | 'enum';
    modifiers: string[];
    superclass?: string;
    interfaces?: string[];
    summary: string;              // Summarized class code
    lastModified: string;
  };
}

interface TypeReferenceIndex {
  [typeName: string]: TypeReference[];
}

interface TypeReference {
  sourceClassId: string;        // Salesforce Id of containing class
  sourceClassName: string;
  lineNumber: number;
  columnNumber: number;
  context: 'variable' | 'parameter' | 'return_type' | 'inheritance' | 'instantiation' | 'method_call';
  containingMethod?: string;
  codeSnippet: string;         // 3 lines of context around usage
}
```

### Index Generation Workflow
> **Reference Pattern**: `/apex-monorepo/indexer/src/sfdc/project/workspace.ts` (traverse method, lines 58-65)
> **File Processing**: `/apex-monorepo/indexer/src/sfdc/project/fileTypes.ts` (ClsFile.parseTypes, lines 42-60)
> **Neo4j Integration**: `/apex-monorepo/indexer/src/sfdc/project/workspace.ts` (writeSfNodesToNeo4j, line 119)

```typescript
class ApexIndexBuilder {
  async buildIndex(): Promise<ApexIndex> {
    console.log('🚀 Starting Apex index build...');
    const startTime = Date.now();

    // 1. Extract all Apex classes from org
    const apexClasses = await this.extractor.extractApexClasses();
    console.log(`📋 Found ${apexClasses.length} Apex classes`);

    // 2. Extract custom object metadata
    const customObjects = await this.extractor.extractCustomObjects();
    console.log(`🗃️ Found ${customObjects.length} custom objects`);

    // 3. Parse each class for type definitions and references
    const typeDefinitions: TypeDefinitionIndex = {};
    const typeReferences: TypeReferenceIndex = {};

    for (const cls of apexClasses) {
      try {
        const analysis = await this.analyzer.analyzeApexClass(cls.body, cls.name);
        
        // Build type definitions
        analysis.definedTypes.forEach(type => {
          typeDefinitions[type.ApexClass] = {
            classId: cls.id,
            className: cls.name,
            namespace: cls.namespace,
            lineNumber: 1, // TODO: Extract from parser
            type: 'class',
            modifiers: [], // TODO: Extract from parser
            summary: type.SummarizedClass,
            lastModified: cls.lastModified
          };
        });

        // Build type references
        analysis.referencedTypes.forEach(typeRef => {
          if (!typeReferences[typeRef.ApexTypeRef]) {
            typeReferences[typeRef.ApexTypeRef] = [];
          }
          
          typeReferences[typeRef.ApexTypeRef].push({
            sourceClassId: cls.id,
            sourceClassName: cls.name,
            lineNumber: typeRef.startLine,
            columnNumber: typeRef.startCharPositionInLine,
            context: this.determineUsageContext(typeRef),
            codeSnippet: this.extractCodeSnippet(cls.body, typeRef.startLine)
          });
        });

      } catch (error) {
        console.warn(`⚠️ Failed to parse class ${cls.name}: ${error.message}`);
      }
    }

    // 4. Build final index
    const index: ApexIndex = {
      metadata: {
        buildTimestamp: new Date().toISOString(),
        sourceOrgId: await this.connection.getOrgId(),
        totalClasses: Object.keys(typeDefinitions).length,
        totalInterfaces: 0, // TODO: Count interfaces
        totalReferences: Object.values(typeReferences).flat().length,
        buildDurationMs: Date.now() - startTime,
        version: '1.0.0'
      },
      typeDefinitions,
      typeReferences,
      objectMetadata: this.buildObjectMetadataIndex(customObjects)
    };

    // 5. Save to compressed JSON
    await this.saveIndex(index);
    
    console.log(`✅ Index built successfully in ${index.metadata.buildDurationMs}ms`);
    return index;
  }

  private async saveIndex(index: ApexIndex): Promise<void> {
    const json = JSON.stringify(index, null, 2);
    const compressed = zlib.gzipSync(json);
    
    await fs.writeFile(this.config.indexOutputPath, compressed);
    console.log(`💾 Index saved to ${this.config.indexOutputPath}`);
  }
}
```

## Tool Specification

### Tool Definition
```typescript
{
  name: "apex_find_usages",
  description: "Find all usages of Apex types (classes, interfaces, enums) across a locally cloned Salesforce codebase",
  parameters: {
    type: "object",
    properties: {
      typeName: {
        type: "string",
        description: "The Apex class, interface, or enum name to find usages of"
      },
      includeDefinition: {
        type: "boolean",
        description: "Whether to include the file where the type is defined (default: false)",
        default: false
      },
      scopeFilter: {
        type: "string",
        enum: ["all", "tests", "non-tests"],
        description: "Filter results by file scope (default: all)",
        default: "all"
      }
    },
    required: ["typeName"]
  }
}
```

### Input Validation
- **typeName**: Must be valid Apex identifier (alphanumeric, underscores, no spaces)
- **includeDefinition**: Boolean flag for including definition file
- **scopeFilter**: Enum to filter by test vs production code

### Processing Algorithm

#### 1. Index Loading and Validation
> **Reference Pattern**: `/apex-monorepo/indexer/src/sfdc/project/workspace.ts` (findUsages method, line 197)

```typescript
class ApexIndexService {
  private index: ApexIndex | null = null;

  async loadIndex(): Promise<void> {
    const indexPath = this.config.apexIndexPath;
    if (!fs.existsSync(indexPath)) {
      throw new ToolError('Apex index file not found. Please build index first.', 'INDEX_NOT_FOUND');
    }

    const compressed = await fs.readFile(indexPath);
    const json = zlib.gunzipSync(compressed).toString();
    this.index = JSON.parse(json);
  }

  validateType(typeName: string): void {
    if (!this.index.typeDefinitions[typeName]) {
      throw new ToolError(`Type '${typeName}' not found in codebase`, 'TYPE_NOT_FOUND');
    }
  }
}
```

#### 2. Usage Retrieval from Index
> **Reference**: `/apex-monorepo/indexer/src/sfdc/project/workspace.ts` (lines 197-199, findUsages implementation)

```typescript
async function findUsages(typeName: string, params: ApexFindUsagesParams): Promise<ApexUsageResult> {
  // Load index if not already loaded
  await this.indexService.loadIndex();
  
  // Validate type exists
  this.indexService.validateType(typeName);
  
  // Get type references from index
  const references = this.index.typeReferences[typeName] || [];
  
  return {
    typeName,
    definitionFile: params.includeDefinition ? this.index.typeDefinitions[typeName] : undefined,
    usages: await this.enrichUsageContext(references, params),
    summary: this.buildUsageSummary(references)
  };
}
```

#### 3. Scope Filtering
```typescript
function filterReferencesByScope(references: TypeReference[], scopeFilter: string): TypeReference[] {
  return references.filter(ref => {
    switch (scopeFilter) {
      case 'tests':
        return ref.sourceClassName.includes('Test') || ref.sourceClassName.endsWith('Test');
      case 'non-tests':
        return !ref.sourceClassName.includes('Test') && !ref.sourceClassName.endsWith('Test');
      default:
        return true;
    }
  });
}
```

#### 4. Context Enrichment
Since the index already contains parsed context and code snippets:
```typescript
async function enrichUsageContext(references: TypeReference[], params: ApexFindUsagesParams): Promise<ApexUsageLocation[]> {
  const filteredRefs = filterReferencesByScope(references, params.scopeFilter);
  
  return filteredRefs.map(ref => ({
    filePath: `salesforce://apex/${ref.sourceClassId}`,  // Virtual path using Salesforce ID
    relativePath: `classes/${ref.sourceClassName}.cls`,
    usageType: ref.context,
    lineNumber: ref.lineNumber,
    columnNumber: ref.columnNumber,
    codeSnippet: ref.codeSnippet,  // Already extracted during index build
    methodContext: ref.containingMethod
  }));
}
```

### Output Format

```typescript
interface ApexUsageResult {
  typeName: string;
  definitionFile?: string;  // Only if includeDefinition=true
  usages: ApexUsageLocation[];
  summary: {
    totalUsages: number;
    testFiles: number;
    productionFiles: number;
    uniqueFiles: number;
  };
}

interface ApexUsageLocation {
  filePath: string;
  relativePath: string;
  usageType: 'variable' | 'parameter' | 'return_type' | 'inheritance' | 'instantiation' | 'method_call' | 'annotation';
  lineNumber: number;
  columnNumber: number;
  codeSnippet: string;  // 3 lines of context
  methodContext?: string;  // Name of containing method/class
}
```

### Example Output
```json
{
  "typeName": "AccountService",
  "definitionFile": "force-app/main/default/classes/AccountService.cls",
  "usages": [
    {
      "filePath": "/full/path/to/AccountController.cls",
      "relativePath": "force-app/main/default/classes/AccountController.cls",
      "usageType": "variable",
      "lineNumber": 15,
      "columnNumber": 9,
      "codeSnippet": "    private AccountService accountService;\n    public void processAccount() {\n        accountService = new AccountService();",
      "methodContext": "AccountController.processAccount"
    },
    {
      "filePath": "/full/path/to/AccountServiceTest.cls",
      "relativePath": "force-app/test/default/classes/AccountServiceTest.cls",
      "usageType": "instantiation",
      "lineNumber": 25,
      "columnNumber": 32,
      "codeSnippet": "    @IsTest\n    static void testAccountCreation() {\n        AccountService service = new AccountService();",
      "methodContext": "AccountServiceTest.testAccountCreation"
    }
  ],
  "summary": {
    "totalUsages": 8,
    "testFiles": 3,
    "productionFiles": 5,
    "uniqueFiles": 8
  }
}
```

## Implementation Requirements

### Prerequisites
1. **Local Salesforce Project**: Must have `sfdx-project.json` in root
2. **Index Generation**: Workspace must be traversed and indexed first
3. **ANTLR Parser**: Apex code must be parsed for AST analysis
4. **Neo4j Database** (Optional): For enhanced relationship queries

### Configuration Integration
> **Reference Pattern**: `/apex-monorepo/indexer/src/config.ts` (Config class structure and environment handling)

```typescript
// Add to existing sfdc_org_mcp configuration
interface SalesforceConfig {
  // ... existing config
  localWorkspacePath?: string;  // Path to cloned Salesforce project
  indexCacheEnabled?: boolean;  // Cache parsed results
  indexCacheTtl?: number;      // Cache TTL in seconds
}
```

### Error Handling
> **Reference**: `/apex-monorepo/indexer/src/parser/apexErrorListeners.ts` (error collection patterns)

```typescript
class ApexIndexError extends BaseError {
  constructor(message: string, code: string, cause?: Error) {
    super(message, 'APEX_INDEX_ERROR', cause);
    this.details = { code };
  }
}

// Error codes:
// - WORKSPACE_NOT_FOUND: Local workspace path not configured
// - INDEX_NOT_READY: Workspace hasn't been indexed yet
// - TYPE_NOT_FOUND: Requested type doesn't exist
// - PARSE_ERROR: Failed to parse Apex file
// - FILE_ACCESS_ERROR: Cannot read workspace files
```

### Performance Considerations

#### Indexing Strategy
- **Lazy Loading**: Index files on-demand if full index unavailable
- **Incremental Updates**: Track file modifications for selective re-indexing
- **Memory Management**: Use streaming for large codebases
- **Caching**: Cache parsed ASTs and usage maps

#### Optimization Patterns
```typescript
// Memory-efficient usage tracking
private usageCache = new Map<string, Set<string>>();
private lastIndexTime = new Map<string, number>();

// Batch file processing
const BATCH_SIZE = 50;
for (let i = 0; i < files.length; i += BATCH_SIZE) {
  const batch = files.slice(i, i + BATCH_SIZE);
  await this.processBatch(batch);
}
```

### Security Considerations

#### File System Access
- **Path Validation**: Ensure workspace path is within allowed boundaries
- **File Filtering**: Exclude sensitive files (`.env`, credentials)
- **Size Limits**: Prevent processing of extremely large files

#### Input Sanitization
```typescript
function validateTypeName(typeName: string): void {
  if (!typeName || typeof typeName !== 'string') {
    throw new ToolError('Type name is required', 'INVALID_INPUT');
  }
  
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(typeName)) {
    throw new ToolError('Invalid Apex type name format', 'INVALID_TYPE_NAME');
  }
  
  if (typeName.length > 255) {
    throw new ToolError('Type name too long', 'TYPE_NAME_TOO_LONG');
  }
}
```

## Integration with MCP Server

### Tool Registration
```typescript
// In tools.ts
export const apexFindUsagesTool: McpTool = {
  name: 'apex_find_usages',
  description: 'Find all usages of Apex types across a locally cloned Salesforce codebase',
  inputSchema: apexFindUsagesSchema
};
```

### Handler Implementation
> **Reference**: `/apex-monorepo/indexer/src/server.ts` (lines 51-85, toolHandlers map and route setup)

```typescript
// In server.ts
async function handleApexFindUsages(params: ApexFindUsagesParams): Promise<ApexUsageResult> {
  const workspace = await this.getOrCreateWorkspace();
  
  // Validate input
  validateTypeName(params.typeName);
  
  // Find usages
  const usages = workspace.findUsages(params.typeName);
  
  // Enrich with context
  const enrichedUsages = await this.enrichUsageContext(usages, params);
  
  return this.formatUsageResult(params.typeName, enrichedUsages);
}
```

### Configuration Setup
> **Reference**: `/apex-monorepo/indexer/src/config.ts` (lines 18-46, environment loading and validation)

```typescript
// Configuration for local workspace access
const config = {
  salesforce: {
    // ... existing config
    localWorkspace: {
      path: process.env.SFDC_LOCAL_WORKSPACE_PATH,
      indexOnStartup: true,
      enableCache: true,
      cacheTtl: 3600 // 1 hour
    }
  }
};
```

## Testing Strategy

### Unit Tests
> **Reference**: `/apex-monorepo/indexer/src/__tests__/` directory for test structure and patterns

```typescript
describe('ApexFindUsages', () => {
  it('should find all usages of a class', async () => {
    const result = await apexFindUsages.execute({ typeName: 'TestClass' });
    expect(result.usages).toHaveLength(3);
    expect(result.summary.uniqueFiles).toBe(2);
  });
  
  it('should filter test files when requested', async () => {
    const result = await apexFindUsages.execute({ 
      typeName: 'TestClass', 
      scopeFilter: 'non-tests' 
    });
    expect(result.usages.every(u => !u.filePath.includes('Test'))).toBe(true);
  });
});
```

### Integration Tests
- Test with real Salesforce project structure
- Verify AST parsing accuracy
- Validate performance with large codebases
- Test error handling for corrupted files

## Success Metrics

### Functional Requirements
- ✅ Accurately identifies all type usages
- ✅ Provides precise line/column locations
- ✅ Handles all Apex constructs (classes, interfaces, enums)
- ✅ Filters by scope (tests vs production)
- ✅ Includes meaningful code context

### Performance Requirements
- ✅ Index generation: <30 seconds for typical org
- ✅ Usage queries: <2 seconds response time
- ✅ Memory usage: <500MB for large orgs
- ✅ File processing: >100 files/second

### Quality Requirements
- ✅ Zero false negatives for type usage
- ✅ <1% false positives
- ✅ Handles malformed Apex gracefully
- ✅ Comprehensive error reporting
- ✅ Maintains consistency across runs

This specification provides a comprehensive foundation for implementing the `apex_find_usages` tool as a sophisticated addition to the Salesforce MCP server's read-only capabilities.