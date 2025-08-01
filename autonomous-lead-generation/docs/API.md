# API Documentation

## Overview

The Autonomous Lead Generation Engine provides a comprehensive REST API for managing leads, campaigns, analytics, and AI-powered features.

**Base URL:** `http://localhost:3000/api`

## Authentication

Currently, the API uses basic authentication for protected endpoints. In production, implement JWT tokens.

## Endpoints

### Health Check

#### GET /health
Check system health and database connectivity.

```json
{
  "status": "healthy",
  "timestamp": "2025-08-01T12:00:00Z",
  "database": "connected",
  "version": "1.0.0"
}
```

### Leads Management

#### GET /leads
Retrieve leads with pagination and filtering.

**Query Parameters:**
- `page` (number): Page number (default: 1)
- `limit` (number): Items per page (default: 10, max: 100)
- `search` (string): Search in name, email, company
- `status` (string): Filter by status (new, contacted, qualified, converted, rejected)
- `source` (string): Filter by lead source
- `scoreMin` (number): Minimum score filter
- `scoreMax` (number): Maximum score filter
- `tags` (string): Comma-separated tags

**Response:**
```json
{
  "leads": [
    {
      "id": "lead_123",
      "email": "john@example.com",
      "firstName": "John",
      "lastName": "Doe",
      "company": "Example Corp",
      "title": "CEO",
      "phone": "+1234567890",
      "website": "https://example.com",
      "industry": "Technology",
      "score": 85,
      "confidence": 0.92,
      "status": "new",
      "source": "uplead",
      "tags": ["high-priority", "enterprise"],
      "enrichedData": {},
      "aiSummary": "High-potential enterprise lead...",
      "createdAt": "2025-08-01T12:00:00Z",
      "updatedAt": "2025-08-01T12:00:00Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 156,
    "pages": 16
  }
}
```

#### POST /leads
Create a new lead manually.

**Request Body:**
```json
{
  "email": "jane@example.com",
  "firstName": "Jane",
  "lastName": "Smith",
  "company": "Tech Corp",
  "title": "CTO",
  "phone": "+1234567891",
  "website": "https://techcorp.com",
  "industry": "Software",
  "source": "manual"
}
```

#### GET /leads/:id
Get a specific lead by ID.

#### PUT /leads/:id
Update a lead.

#### DELETE /leads/:id
Delete a lead.

#### POST /leads/:id/score
Trigger AI scoring for a specific lead.

#### POST /leads/batch-score
Trigger batch AI scoring for multiple leads.

**Request Body:**
```json
{
  "leadIds": ["lead_123", "lead_456"],
  "algorithmId": "default" // optional
}
```

### Campaigns Management

#### GET /campaigns
Retrieve all campaigns.

```json
{
  "campaigns": [
    {
      "id": "camp_123",
      "name": "Q4 Enterprise Outreach",
      "type": "email",
      "status": "active",
      "targetingCriteria": {
        "industry": ["Technology", "Finance"],
        "minScore": 70,
        "tags": ["enterprise"]
      },
      "createdAt": "2025-08-01T12:00:00Z",
      "executions": [
        {
          "id": "exec_123",
          "status": "completed",
          "leadsTargeted": 150,
          "emailsSent": 145,
          "startedAt": "2025-08-01T13:00:00Z",
          "completedAt": "2025-08-01T14:30:00Z"
        }
      ]
    }
  ]
}
```

#### POST /campaigns
Create a new campaign.

#### GET /campaigns/:id/execute
Execute a campaign.

#### GET /campaigns/:id/analytics
Get campaign performance analytics.

### Analytics

#### GET /analytics/dashboard
Get dashboard metrics.

```json
{
  "totalLeads": 1250,
  "newLeadsToday": 45,
  "conversionRate": 12.5,
  "averageScore": 67.8,
  "topSources": [
    {"source": "uplead", "count": 450},
    {"source": "linkedin", "count": 320}
  ],
  "scoreDistribution": [
    {"range": "90-100", "count": 125},
    {"range": "80-89", "count": 280}
  ],
  "activityTrend": [
    {"date": "2025-08-01", "leads": 45, "conversions": 6}
  ]
}
```

#### GET /analytics/campaigns
Get campaign analytics summary.

#### GET /analytics/campaigns/:id
Get detailed analytics for a specific campaign.

#### GET /analytics/lead-sources
Get lead source performance analytics.

#### GET /analytics/scoring
Get AI scoring analytics.

### A/B Testing

#### GET /ab-tests
Retrieve all A/B tests.

```json
{
  "tests": [
    {
      "id": "test_123",
      "name": "Email Subject Line Test",
      "status": "running",
      "startDate": "2025-08-01T00:00:00Z",
      "endDate": "2025-08-15T00:00:00Z",
      "trafficSplit": 50,
      "variants": [
        {
          "id": "var_a",
          "name": "Control",
          "config": {"subject": "Improve your lead generation"}
        },
        {
          "id": "var_b", 
          "name": "Variant B",
          "config": {"subject": "Double your sales in 30 days"}
        }
      ],
      "results": {
        "totalParticipants": 1000,
        "conversionRate": {
          "var_a": 0.15,
          "var_b": 0.18
        },
        "confidence": 0.95,
        "significant": true,
        "winner": "var_b"
      }
    }
  ]
}
```

#### POST /ab-tests
Create a new A/B test.

#### GET /ab-tests/:id/assign
Assign a user to a test variant.

#### POST /ab-tests/:id/track
Track a conversion event.

#### GET /ab-tests/:id/results
Get test results and statistical analysis.

### Custom Scoring

#### GET /scoring/algorithms
Get available scoring algorithms.

```json
{
  "algorithms": [
    {
      "id": "default",
      "name": "Default Lead Scoring",
      "version": "1.0",
      "active": true,
      "config": {
        "weights": {
          "company_size": 0.3,
          "industry_match": 0.25,
          "title_seniority": 0.2,
          "engagement_history": 0.15,
          "data_completeness": 0.1
        }
      }
    }
  ]
}
```

#### POST /scoring/algorithms
Create a custom scoring algorithm.

#### PUT /scoring/algorithms/:id
Update a scoring algorithm.

#### POST /scoring/test
Test a scoring algorithm against sample data.

### Webhooks

#### POST /webhooks/form-submission
Handle form submissions from landing pages.

**Request Body:**
```json
{
  "email": "prospect@example.com",
  "firstName": "John",
  "lastName": "Doe", 
  "company": "Example Corp",
  "phone": "+1234567890",
  "message": "Interested in your solution",
  "source": "landing-page",
  "utm_source": "google",
  "utm_medium": "cpc",
  "utm_campaign": "q4-lead-gen"
}
```

#### POST /webhooks/email-events
Handle email delivery events (opens, clicks, bounces).

#### POST /webhooks/crm-sync
Sync data from CRM systems.

#### POST /webhooks/lead-import
Import leads from external sources.

## Error Responses

All endpoints return consistent error responses:

```json
{
  "error": "Validation Error",
  "message": "Email is required",
  "code": "VALIDATION_ERROR",
  "timestamp": "2025-08-01T12:00:00Z"
}
```

**HTTP Status Codes:**
- `200` - Success
- `201` - Created
- `400` - Bad Request
- `401` - Unauthorized  
- `403` - Forbidden
- `404` - Not Found
- `422` - Validation Error
- `429` - Rate Limited
- `500` - Internal Server Error

## Rate Limiting

API requests are limited to 100 requests per 15-minute window per IP address. Rate limit headers are included in responses:

```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1627849200
```

## Pagination

List endpoints support cursor-based pagination:

```json
{
  "data": [...],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 156,
    "pages": 16,
    "hasNext": true,
    "hasPrev": false
  }
}
```

## Webhooks

The system can send webhooks for various events:

**Events:**
- `lead.created` - New lead added
- `lead.scored` - Lead scored by AI
- `lead.converted` - Lead converted to customer
- `campaign.completed` - Campaign execution finished
- `test.completed` - A/B test completed

**Webhook Payload:**
```json
{
  "event": "lead.created",
  "timestamp": "2025-08-01T12:00:00Z",
  "data": {
    "leadId": "lead_123",
    "email": "john@example.com"
  }
}
```