# System Architecture

## Overview

The Autonomous Lead Generation Engine is a microservices-based system designed for scalability, reliability, and autonomous operation. The architecture follows modern best practices with clear separation of concerns and robust integration patterns.

## High-Level Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Web Interface │    │   Lead Forms    │    │  External APIs  │
│   (Dashboard)   │    │  (Landing Page) │    │  (Webhooks)     │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         └───────────────────────┼───────────────────────┘
                                 │
                    ┌─────────────────┐
                    │   API Gateway   │
                    │  (Rate Limiting │
                    │   Auth & CORS)  │
                    └─────────────────┘
                                 │
         ┌───────────────────────┼───────────────────────┐
         │                       │                       │
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│  Lead Service   │    │Campaign Service │    │Analytics Service│
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         └───────────────────────┼───────────────────────┘
                                 │
                    ┌─────────────────┐
                    │   AI Services   │
                    │  (GPT-4 Scoring│
                    │   & Analysis)   │
                    └─────────────────┘
                                 │
         ┌───────────────────────┼───────────────────────┐
         │                       │                       │
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│  CRM Service    │    │Lead Sources Svc │    │   Database      │
│  (Salesforce)   │    │(UpLead,ZoomInfo)│    │ (PostgreSQL)    │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

## Component Architecture

### 1. API Layer

#### Express.js Application (`src/app.ts`)
- **Purpose**: Main application entry point with middleware setup
- **Responsibilities**:
  - Request routing and middleware orchestration
  - CORS configuration and security headers
  - Rate limiting and request validation
  - Error handling and logging
  - Health checks and monitoring endpoints

#### Route Handlers (`src/routes/`)
- **Purpose**: HTTP endpoint definitions and request handling
- **Components**:
  - `health.ts` - System health and status endpoints
  - `leads.ts` - Lead CRUD operations and management
  - `campaigns.ts` - Campaign creation and execution
  - `analytics.ts` - Performance metrics and reporting
  - `webhooks.ts` - External integration endpoints

### 2. Service Layer

#### AI Services (`src/services/ai/`)

**Lead Scoring Service (`leadScoringService.ts`)**
- **Purpose**: GPT-4 powered lead qualification and scoring
- **Architecture**:
  ```typescript
  interface LeadScoringResult {
    score: number;           // 0-100 lead quality score
    confidence: number;      // AI confidence in scoring
    reasoning: string;       // Explanation of scoring factors
    tags: string[];         // Automated categorization
    followUpSuggestions: string[]; // Next actions
  }
  ```
- **Features**:
  - Batch processing for efficiency
  - Configurable scoring algorithms
  - Confidence calculation based on data completeness
  - Industry-specific scoring models

#### Analytics Services (`src/services/analytics/`)

**Campaign Analytics Service (`campaignAnalyticsService.ts`)**
- **Purpose**: Real-time campaign performance tracking
- **Metrics Tracked**:
  - Delivery rates, open rates, click rates
  - Reply rates, bounce rates, conversion rates
  - Revenue attribution and ROI calculation
  - Time-based performance trends
- **Architecture Pattern**: Event-driven with aggregation caching

**A/B Testing Service (`abTestingService.ts`)**
- **Purpose**: Statistical testing framework
- **Features**:
  - Z-test significance calculation
  - Confidence interval computation
  - Automated winner determination
  - Traffic splitting and variant assignment
- **Statistical Methods**:
  ```typescript
  interface TestResult {
    significant: boolean;
    confidence: number;
    pValue: number;
    effect: number;
    winner?: string;
  }
  ```

**Custom Scoring Service (`customScoringService.ts`)**
- **Purpose**: Flexible scoring algorithm framework
- **Supported Algorithms**:
  - Weighted feature scoring
  - Machine learning model integration
  - Industry-specific templates
  - Performance-based optimization

#### External Integration Services

**CRM Service (`src/services/crm/salesforceService.ts`)**
- **Purpose**: Salesforce integration for lead management
- **Features**:
  - Lead and opportunity sync
  - Batch processing with rate limiting
  - Field mapping and transformation
  - Conversion tracking and attribution
- **Architecture Pattern**: Queue-based with retry logic

**Lead Sources (`src/services/leadSources/`)**
- **UpLead Service**: Contact search and enrichment
- **ZoomInfo Service**: B2B database integration
- **LinkedIn Service**: Professional network data
- **Common Pattern**:
  ```typescript
  interface LeadSourceService {
    searchContacts(criteria: SearchCriteria): Promise<Contact[]>;
    enrichLead(leadId: string): Promise<void>;
    importLeads(params: ImportParams): Promise<string[]>;
    getUsageStats(): Promise<UsageStats>;
  }
  ```

### 3. Data Layer

#### Database Schema (Prisma ORM)

**Core Entities**:
- `Lead` - Central lead data with scoring and enrichment
- `Campaign` - Marketing campaign definitions
- `CampaignExecution` - Campaign run instances
- `FormSubmission` - Landing page lead captures

**Analytics Entities**:
- `CampaignAnalytics` - Aggregated performance metrics
- `EmailEvent` - Email engagement tracking
- `Activity` - Audit trail and user actions

**Testing Entities**:
- `AbTest` - A/B test configurations
- `AbTestVariant` - Test variant definitions
- `AbTestResult` - Statistical test outcomes

**AI/Scoring Entities**:
- `ScoringAlgorithm` - Custom scoring model definitions
- `ScoringResult` - Individual lead scoring outcomes

#### Database Optimization

**Indexing Strategy**:
```sql
-- Performance-critical indexes
CREATE INDEX idx_leads_email ON leads(email);
CREATE INDEX idx_leads_score ON leads(score);
CREATE INDEX idx_leads_status_created ON leads(status, created_at);
CREATE INDEX idx_campaign_analytics_date ON campaign_analytics(date);
CREATE INDEX idx_email_events_timestamp ON email_events(timestamp);
```

**Partitioning**: Time-based partitioning for analytics tables

### 4. Frontend Architecture

#### MVP Dashboard (`mvp-dashboard.html`)
- **Technology**: Vanilla JavaScript with Chart.js and Tailwind CSS
- **Architecture**: SPA with component-based organization
- **Sections**:
  - Real-time dashboard with KPI widgets
  - Lead management with filtering and search
  - Campaign management and execution
  - Analytics and reporting
  - A/B testing interface
  - AI scoring configuration

#### Lead Capture Form (`lead-form.html`)
- **Technology**: Vanilla JavaScript with form validation
- **Features**:
  - UTM parameter tracking
  - Progressive form enhancement
  - Real-time validation
  - Success/error handling

## Data Flow Architecture

### 1. Lead Acquisition Flow

```
External Source → API Import → Lead Creation → AI Scoring → CRM Sync
     │              │            │             │            │
     │              │            │             │            └─ Salesforce
     │              │            │             │
     │              │            │             └─ Score/Tag Assignment
     │              │            │
     │              │            └─ Database Storage
     │              │
     │              └─ Validation & Enrichment
     │
     └─ (UpLead, ZoomInfo, LinkedIn, Form Submissions)
```

### 2. Campaign Execution Flow

```
Campaign Creation → Target Selection → Content Generation → Execution → Tracking
       │                  │                │                │           │
       │                  │                │                │           └─ Analytics Collection
       │                  │                │                │
       │                  │                │                └─ Email/SMS Sending
       │                  │                │
       │                  │                └─ AI-Generated Personalization
       │                  │
       │                  └─ Lead Filtering by Score/Tags
       │
       └─ Campaign Configuration
```

### 3. Analytics Processing Flow

```
Event Collection → Real-time Processing → Aggregation → Storage → Visualization
       │                 │                    │           │           │
       │                 │                    │           │           └─ Dashboard
       │                 │                    │           │
       │                 │                    │           └─ Analytics Tables
       │                 │                    │
       │                 │                    └─ Metric Calculation
       │                 │
       │                 └─ Event Validation
       │
       └─ (Email Events, Form Submissions, CRM Updates)
```

## Security Architecture

### 1. Authentication & Authorization

```typescript
interface SecurityContext {
  authentication: "JWT" | "API_KEY";
  authorization: "RBAC" | "SCOPE_BASED";
  encryption: "AES-256" | "RSA-2048";
  transport: "TLS-1.3";
}
```

### 2. Data Protection

- **Encryption at Rest**: Database-level encryption
- **Encryption in Transit**: TLS 1.3 for all communications
- **API Key Management**: Environment-based configuration
- **Input Validation**: Joi schema validation for all endpoints
- **Rate Limiting**: IP-based and authenticated user limits

### 3. GDPR Compliance

- **Data Minimization**: Only collect necessary lead data
- **Right to Deletion**: Soft delete with data purging
- **Data Export**: Structured data export functionality
- **Consent Tracking**: Form submission consent logging

## Scalability Architecture

### 1. Horizontal Scaling

**Stateless Services**: All services designed for horizontal scaling
```typescript
interface ScalableService {
  stateless: true;
  loadBalanced: true;
  autoScaling: boolean;
  healthChecks: string[];
}
```

**Database Scaling**:
- Read replicas for analytics queries
- Connection pooling with PgBouncer
- Query optimization with proper indexing

### 2. Performance Optimization

**Caching Strategy**:
- Redis for session and temporary data
- Application-level caching for frequently accessed data
- CDN for static assets

**Async Processing**:
- Background job processing for AI scoring
- Queue-based email sending
- Batch processing for external API calls

### 3. Monitoring & Observability

**Application Metrics**:
- Response time and throughput
- Error rates and types
- Database query performance
- External API latency

**Business Metrics**:
- Lead conversion rates
- Campaign performance
- AI scoring accuracy
- Revenue attribution

## Integration Architecture

### 1. External Service Integration

**Pattern**: Adapter pattern with service abstraction
```typescript
interface ExternalServiceAdapter {
  authenticate(): Promise<AuthToken>;
  rateLimitHandler(): RateLimiter;
  errorHandler(): ErrorHandler;
  retryStrategy(): RetryPolicy;
}
```

### 2. Webhook Architecture

**Incoming Webhooks**:
- Form submissions from landing pages
- Email event notifications
- CRM data updates
- Payment/conversion events

**Outgoing Webhooks**:
- Lead creation notifications
- Campaign completion alerts
- A/B test results
- System health alerts

### 3. API Versioning

**Strategy**: Header-based versioning with backward compatibility
```typescript
interface APIVersion {
  version: "v1" | "v2";
  deprecationDate?: Date;
  migrationGuide: string;
}
```

## Deployment Architecture

### 1. Containerization

**Docker Strategy**:
- Multi-stage builds for optimization
- Health checks and graceful shutdowns
- Environment-specific configurations
- Security scanning and vulnerability management

### 2. Infrastructure as Code

**Terraform Configuration**:
- VPC and networking setup
- Database and Redis clusters
- Load balancer configuration
- Auto-scaling groups

### 3. CI/CD Pipeline

**GitHub Actions Workflow**:
```yaml
stages:
  - test: Unit and integration tests
  - build: Docker image creation
  - security: Vulnerability scanning
  - deploy: Blue-green deployment
  - monitor: Health check validation
```

## Error Handling & Recovery

### 1. Error Classification

```typescript
enum ErrorType {
  VALIDATION_ERROR = "VALIDATION_ERROR",
  AUTHENTICATION_ERROR = "AUTHENTICATION_ERROR", 
  EXTERNAL_SERVICE_ERROR = "EXTERNAL_SERVICE_ERROR",
  DATABASE_ERROR = "DATABASE_ERROR",
  RATE_LIMIT_ERROR = "RATE_LIMIT_ERROR"
}
```

### 2. Recovery Strategies

**Retry Logic**: Exponential backoff with jitter
**Circuit Breaker**: Fail-fast for degraded services  
**Graceful Degradation**: Reduced functionality during outages
**Dead Letter Queue**: Failed message recovery

### 3. Monitoring & Alerting

**Health Checks**: Application and dependency health monitoring
**Alerting**: PagerDuty integration for critical failures
**Logging**: Structured logging with correlation IDs
**Metrics**: Prometheus/Grafana for operational insights

This architecture provides a robust foundation for the autonomous lead generation engine, ensuring scalability, reliability, and maintainability while supporting the complex workflows required for modern lead generation and marketing automation.