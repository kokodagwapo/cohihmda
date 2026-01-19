# ICE Encompass Integration Architecture

## System Architecture

```mermaid
graph TB
    subgraph "ICE Encompass LOS"
        E1[Loan Data]
        E2[Borrower Info]
        E3[Employee Records]
        E4[Encompass API]
        E1 --> E4
        E2 --> E4
        E3 --> E4
    end

    subgraph "Ailethia Integration Layer"
        A1[API Gateway/CloudFront]
        A2[Backend Service]
        
        subgraph "Backend Services"
            B1[LOS Connection Service]
            B2[Data Sync Service]
            B3[Field Mapper Service]
        end
        
        A1 --> A2
        A2 --> B1
        A2 --> B2
        A2 --> B3
    end

    subgraph "AWS Infrastructure"
        AWS1[Secrets Manager]
        AWS2[RDS PostgreSQL]
        AWS3[Elastic Beanstalk]
        AWS4[CloudWatch]
    end

    subgraph "Ailethia Frontend"
        F1[Dashboard]
        F2[Admin Panel]
        F3[Field Mapping UI]
    end

    E4 -->|OAuth 2.0<br/>HTTPS/TLS| A1
    B1 --> AWS1
    B2 --> AWS2
    B3 --> AWS2
    A2 --> AWS2
    A2 --> AWS3
    A2 --> AWS4
    A2 -->|REST API| F1
    A2 -->|REST API| F2
    A2 -->|REST API| F3

    style E4 fill:#4A90E2
    style A1 fill:#50C878
    style B1 fill:#FF6B6B
    style B2 fill:#FF6B6B
    style B3 fill:#FF6B6B
    style AWS2 fill:#FFA500
    style F1 fill:#9B59B6
```

## Data Flow Diagram

```mermaid
sequenceDiagram
    participant E as Encompass LOS
    participant API as API Gateway
    participant CONN as Connection Service
    participant SYNC as Sync Service
    participant MAP as Field Mapper
    participant DB as PostgreSQL
    participant FE as Frontend

    Note over E,FE: Initial Connection Setup
    FE->>CONN: Create Encompass Connection
    CONN->>API: Store Credentials (Secrets Manager)
    CONN->>E: Test Connection (OAuth)
    E-->>CONN: Connection Success
    
    Note over E,FE: Data Synchronization
    SYNC->>E: Request Loan Data (API Call)
    E-->>SYNC: Return Loan Records
    SYNC->>MAP: Map Encompass Fields
    MAP->>MAP: Auto-detect Field Mappings
    MAP->>MAP: Apply Transformations
    MAP-->>SYNC: Mapped Data
    SYNC->>DB: Insert/Update Loans
    DB-->>SYNC: Success
    SYNC->>FE: Sync Complete Notification
    
    Note over E,FE: Real-time Updates (Webhooks)
    E->>API: Webhook Event (Loan Updated)
    API->>SYNC: Process Webhook
    SYNC->>MAP: Map Updated Fields
    MAP-->>SYNC: Mapped Updates
    SYNC->>DB: Update Loan Record
    DB-->>FE: Real-time Dashboard Update
```

## Field Mapping Flow

```mermaid
flowchart TD
    A[Encompass Loan Record] --> B{Field Mapping<br/>Exists?}
    B -->|Yes| C[Use Existing Mapping]
    B -->|No| D[Auto-Detection Engine]
    
    D --> E{Exact Match<br/>Found?}
    E -->|Yes| F[Map to System Field]
    E -->|No| G[Fuzzy Matching]
    
    G --> H{Similarity<br/>> 0.6?}
    H -->|Yes| F
    H -->|No| I[Check Encompass<br/>Field IDs]
    
    I --> J{Encompass ID<br/>Match?}
    J -->|Yes| F
    J -->|No| K[Flag for Manual<br/>Review]
    
    F --> L[Apply Transformation]
    K --> L
    C --> L
    
    L --> M[Validate Data Type]
    M --> N{Valid?}
    N -->|Yes| O[Store in Database]
    N -->|No| P[Log Error &<br/>Skip Field]
    
    O --> Q[Dashboard Update]
    P --> Q
```

## Testing Architecture

```mermaid
graph LR
    subgraph "Test Environment"
        T1[Encompass Sandbox]
        T2[Test Database]
        T3[Test Backend]
        T4[Test Frontend]
    end

    subgraph "Test Scenarios"
        S1[Connection Tests]
        S2[Field Mapping Tests]
        S3[Sync Tests]
        S4[Dashboard Tests]
        S5[Performance Tests]
    end

    subgraph "Validation"
        V1[Data Accuracy]
        V2[Performance Metrics]
        V3[Error Handling]
        V4[Security Checks]
    end

    T1 --> S1
    T1 --> S2
    T1 --> S3
    T2 --> S4
    T3 --> S5
    
    S1 --> V1
    S2 --> V1
    S3 --> V2
    S4 --> V3
    S5 --> V4
```

## Code Review Process

```mermaid
flowchart TD
    A[Code Complete] --> B[Unit Tests Pass]
    B --> C[Integration Tests Pass]
    C --> D[Code Review Request]
    
    D --> E{Reviewer<br/>Assigned}
    E --> F[Security Review]
    E --> G[Architecture Review]
    E --> H[Performance Review]
    E --> I[Business Logic Review]
    
    F --> J{All Checks<br/>Pass?}
    G --> J
    H --> J
    I --> J
    
    J -->|No| K[Request Changes]
    K --> L[Developer Fixes]
    L --> D
    
    J -->|Yes| M[Approve for Testing]
    M --> N[UAT Environment]
    N --> O{UAT<br/>Pass?}
    
    O -->|No| K
    O -->|Yes| P[Production Deployment]
    P --> Q[Monitor & Validate]
```

---

## Connection Components

### 1. Authentication Flow

```
┌─────────────┐         ┌─────────────┐         ┌─────────────┐
│  Ailethia   │         │   OAuth     │         │  Encompass  │
│   Backend   │────────>│   Server    │────────>│     API     │
└─────────────┘         └─────────────┘         └─────────────┘
      │                        │                        │
      │  1. Request Token     │                        │
      │──────────────────────>│                        │
      │                        │  2. Validate Creds    │
      │                        │──────────────────────>│
      │                        │  3. Return Access     │
      │                        │<──────────────────────│
      │  4. Access Token      │                        │
      │<──────────────────────│                        │
      │                        │                        │
      │  5. API Request + Token                        │
      │───────────────────────────────────────────────>│
      │                        │                        │
      │  6. Loan Data          │                        │
      │<───────────────────────────────────────────────│
```

### 2. Field Mapping Process

```
Encompass Field          Mapping Process          Ailethia Field
─────────────────        ────────────────        ───────────────
CX.LOANAMOUNT     ──>    Exact Match      ──>    loan_amount
Loan Amount       ──>    Display Name     ──>    loan_amount
Principal         ──>    Alias Match      ──>    loan_amount
LoanAmt           ──>    Fuzzy Match      ──>    loan_amount
Unknown Field     ──>    Manual Review    ──>    [Flagged]
```

### 3. Sync Process Flow

```
┌─────────────────────────────────────────────────────────────┐
│                    Sync Process                              │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  1. Schedule Trigger (Cron/Webhook)                        │
│     │                                                        │
│     ├─> 2. Fetch Last Sync Timestamp                        │
│     │                                                        │
│     ├─> 3. Query Encompass API                              │
│     │   - Filter by last_updated > last_sync               │
│     │                                                        │
│     ├─> 4. Process Each Loan Record                         │
│     │   │                                                    │
│     │   ├─> 5. Map Fields (Auto-detect)                     │
│     │   │                                                    │
│     │   ├─> 6. Transform Data                                │
│     │   │   - Date formats                                   │
│     │   │   - Number formats                                 │
│     │   │   - String sanitization                            │
│     │   │                                                    │
│     │   ├─> 7. Validate Data                                │
│     │   │   - Required fields                                │
│     │   │   - Data types                                     │
│     │   │                                                    │
│     │   └─> 8. Upsert to Database                           │
│     │       - INSERT if new                                  │
│     │       - UPDATE if exists                               │
│     │                                                        │
│     └─> 9. Update Sync Timestamp                            │
│                                                              │
│  10. Notify Frontend (WebSocket/SSE)                        │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## Testing Matrix

| Feature | Unit Test | Integration Test | E2E Test | Performance Test |
|---------|-----------|------------------|----------|------------------|
| Connection Management | ✅ | ✅ | ✅ | ✅ |
| Field Mapping | ✅ | ✅ | ✅ | - |
| Data Sync | ✅ | ✅ | ✅ | ✅ |
| Dashboard Rendering | ✅ | - | ✅ | ✅ |
| Ailethia Prompts | ✅ | ✅ | ✅ | - |
| Error Handling | ✅ | ✅ | ✅ | - |
| Security | ✅ | ✅ | ✅ | - |

---

## Deployment Checklist

### Pre-Deployment
- [ ] Code review completed and approved
- [ ] All unit tests passing
- [ ] Integration tests passing
- [ ] Security scan completed
- [ ] Performance testing completed
- [ ] Documentation updated

### Deployment
- [ ] Encompass API credentials configured (Secrets Manager)
- [ ] Database migrations applied
- [ ] Environment variables set
- [ ] Monitoring and alerting configured
- [ ] Rollback plan documented

### Post-Deployment
- [ ] Connection test successful
- [ ] Initial sync completed
- [ ] Dashboard data validated
- [ ] Error monitoring active
- [ ] Performance metrics baseline established

---

**Document Version**: 1.0  
**Last Updated**: January 3, 2026
