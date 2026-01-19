/**
 * Mock LOS API Server
 * Simulates various Loan Origination System APIs for testing and development
 * 
 * This allows testing LOS integrations without requiring actual LOS accounts
 */

import { Express, Request, Response } from 'express';
import { randomUUID } from 'crypto';

// Mock loan data generator
function generateMockLoan(index: number, losType: string): any {
  const statuses = ['Active', 'Locked', 'Closed', 'Underwriting', 'Approved', 'CTC'];
  const loanTypes = ['Conventional', 'FHA', 'VA', 'USDA', 'Jumbo'];
  const purposes = ['Purchase', 'Refinance', 'Cash-Out Refinance'];
  
  const baseDate = new Date(2024, 0, 1);
  const appDate = new Date(baseDate.getTime() + (index * 24 * 60 * 60 * 1000));
  const lockDate = index % 3 === 0 ? new Date(appDate.getTime() + (7 * 24 * 60 * 60 * 1000)) : null;
  const closeDate = index % 5 === 0 ? new Date(appDate.getTime() + (30 * 24 * 60 * 60 * 1000)) : null;
  
  const loanAmount = 200000 + (index * 15000) + Math.floor(Math.random() * 50000);
  const interestRate = 5.5 + (index * 0.1) + (Math.random() * 1.5);
  
  // Format based on LOS type
  switch (losType) {
    case 'encompass':
      return {
        guid: randomUUID(),
        loanNumber: `ENC-${String(index + 1).padStart(6, '0')}`,
        borrower: {
          firstName: `Borrower${index + 1}`,
          lastName: `LastName${index + 1}`,
          email: `borrower${index + 1}@example.com`,
          phone: `555-${String(1000 + index).padStart(4, '0')}`,
        },
        loanAmount: loanAmount,
        loanPurpose: loanTypes[index % loanTypes.length],
        loanStatus: statuses[index % statuses.length],
        applicationDate: appDate.toISOString(),
        closingDate: closeDate?.toISOString() || null,
        lockDate: lockDate?.toISOString() || null,
        interestRate: parseFloat(interestRate.toFixed(3)),
        propertyAddress: {
          street: `${100 + index} Main St`,
          city: 'Anytown',
          state: 'CA',
          zipCode: `9000${index % 10}`,
        },
        loanOfficer: {
          name: `LO-${index % 10 + 1}`,
          nmlsId: `NMLS${String(1000 + index).padStart(6, '0')}`,
        },
      };
      
    case 'meridianlink':
      return {
        id: randomUUID(),
        loan_number: `ML-${String(index + 1).padStart(6, '0')}`,
        borrower_name: `Borrower${index + 1} LastName${index + 1}`,
        applicant_name: `Borrower${index + 1} LastName${index + 1}`,
        loan_amount: loanAmount,
        amount: loanAmount,
        loan_type: loanTypes[index % loanTypes.length],
        product_type: loanTypes[index % loanTypes.length],
        status: statuses[index % statuses.length],
        loan_status: statuses[index % statuses.length],
        application_date: appDate.toISOString(),
        closing_date: closeDate?.toISOString() || null,
        lock_date: lockDate?.toISOString() || null,
        interest_rate: parseFloat(interestRate.toFixed(3)),
        rate: parseFloat(interestRate.toFixed(3)),
        property_address: `${100 + index} Main St, Anytown, CA 9000${index % 10}`,
        loan_officer: `LO-${index % 10 + 1}`,
        fico_score: 680 + (index % 100),
        ltv: 70 + (index % 20),
      };
      
    case 'floify':
      return {
        id: index + 1,
        loan_id: `FL-${String(index + 1).padStart(6, '0')}`,
        borrower_first_name: `Borrower${index + 1}`,
        borrower_last_name: `LastName${index + 1}`,
        loan_amount: loanAmount,
        loan_type: loanTypes[index % loanTypes.length],
        status: statuses[index % statuses.length],
        application_date: appDate.toISOString().split('T')[0],
        closing_date: closeDate?.toISOString().split('T')[0] || null,
        interest_rate: parseFloat(interestRate.toFixed(2)),
        property_address: `${100 + index} Main St`,
        property_city: 'Anytown',
        property_state: 'CA',
        property_zip: `9000${index % 10}`,
      };
      
    case 'optimalblue':
      return {
        loanId: `OB-${String(index + 1).padStart(6, '0')}`,
        borrowerName: `Borrower${index + 1} LastName${index + 1}`,
        loanAmount: loanAmount,
        productType: loanTypes[index % loanTypes.length],
        loanStatus: statuses[index % statuses.length],
        applicationDate: appDate.toISOString(),
        closingDate: closeDate?.toISOString() || null,
        rate: parseFloat(interestRate.toFixed(3)),
        propertyAddress: `${100 + index} Main St, Anytown, CA 9000${index % 10}`,
      };
      
    default:
      // Generic format
      return {
        id: randomUUID(),
        loan_id: `LOAN-${String(index + 1).padStart(6, '0')}`,
        loan_number: `LOAN-${String(index + 1).padStart(6, '0')}`,
        borrower_name: `Borrower${index + 1} LastName${index + 1}`,
        loan_amount: loanAmount,
        loan_type: loanTypes[index % loanTypes.length],
        status: statuses[index % statuses.length],
        application_date: appDate.toISOString(),
        closing_date: closeDate?.toISOString() || null,
        interest_rate: parseFloat(interestRate.toFixed(2)),
      };
  }
}

// Store mock data in memory (in production, this could use a database)
const mockLoans: Map<string, any[]> = new Map();
const mockTokens: Map<string, { token: string; expiresAt: Date }> = new Map();

/**
 * Setup mock API routes for all LOS systems
 */
export function setupMockLosApi(app: Express, basePath: string = '/mock-los') {
  console.log('🔧 Setting up Mock LOS API at', basePath);

  // ============================================
  // ICE Encompass Mock API
  // ============================================
  
  // OAuth2 Token Endpoint
  app.post(`${basePath}/encompass/oauth2/v1/token`, (req: Request, res: Response) => {
    const { client_id, client_secret, grant_type } = req.body;
    
    if (grant_type !== 'client_credentials') {
      return res.status(400).json({ error: 'unsupported_grant_type' });
    }
    
    if (!client_id || !client_secret) {
      return res.status(401).json({ error: 'invalid_client' });
    }
    
    // Generate mock token
    const token = `mock_encompass_token_${randomUUID()}`;
    const expiresIn = 3600; // 1 hour
    const expiresAt = new Date(Date.now() + expiresIn * 1000);
    
    mockTokens.set(token, { token, expiresAt });
    
    res.json({
      access_token: token,
      token_type: 'Bearer',
      expires_in: expiresIn,
      refresh_token: `mock_refresh_${randomUUID()}`,
      scope: 'lp lp_master_readonly',
    });
  });

  // Encompass Loans API
  app.get(`${basePath}/encompass/v1/loans`, (req: Request, res: Response) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized', message: 'Missing or invalid token' });
    }
    
    const token = authHeader.replace('Bearer ', '');
    const tokenData = mockTokens.get(token);
    
    if (!tokenData || tokenData.expiresAt < new Date()) {
      return res.status(401).json({ error: 'Unauthorized', message: 'Token expired' });
    }
    
    const limit = parseInt(req.query.limit as string) || 100;
    const offset = parseInt(req.query.offset as string) || 0;
    const modifiedFrom = req.query.modifiedFrom as string;
    
    // Generate or retrieve mock loans
    const cacheKey = `encompass_${limit}_${offset}`;
    if (!mockLoans.has(cacheKey)) {
      const loans = Array.from({ length: limit }, (_, i) => 
        generateMockLoan(offset + i, 'encompass')
      );
      mockLoans.set(cacheKey, loans);
    }
    
    const loans = mockLoans.get(cacheKey) || [];
    
    res.json({
      loans: loans,
      count: loans.length,
      total: 1000, // Mock total
      start: offset,
      limit: limit,
    });
  });

  // Encompass Health/Test Endpoint
  app.get(`${basePath}/encompass/v1/health`, (req: Request, res: Response) => {
    res.json({ status: 'ok', service: 'Encompass Mock API', version: '1.0.0' });
  });

  // ============================================
  // MeridianLink Mock API
  // ============================================
  
  // MeridianLink Loans API
  app.get(`${basePath}/meridianlink/api/v1/loans`, (req: Request, res: Response) => {
    const apiKey = req.headers['x-api-key'] || req.headers.authorization?.replace('Bearer ', '');
    
    const apiKeyStr = Array.isArray(apiKey) ? apiKey[0] : (apiKey || '');
    if (!apiKeyStr || !apiKeyStr.startsWith('mock_meridianlink_')) {
      return res.status(401).json({ error: 'Unauthorized', message: 'Invalid API key' });
    }
    
    const limit = parseInt(req.query.limit as string) || 100;
    const offset = parseInt(req.query.offset as string) || 0;
    const updatedSince = req.query.updated_since as string;
    
    const cacheKey = `meridianlink_${limit}_${offset}`;
    if (!mockLoans.has(cacheKey)) {
      const loans = Array.from({ length: limit }, (_, i) => 
        generateMockLoan(offset + i, 'meridianlink')
      );
      mockLoans.set(cacheKey, loans);
    }
    
    const loans = mockLoans.get(cacheKey) || [];
    
    res.json({
      data: loans,
      meta: {
        total: 1000,
        page: Math.floor(offset / limit) + 1,
        per_page: limit,
        total_pages: Math.ceil(1000 / limit),
      },
    });
  });

  // MeridianLink Health Endpoint
  app.get(`${basePath}/meridianlink/api/v1/health`, (req: Request, res: Response) => {
    res.json({ status: 'ok', service: 'MeridianLink Mock API', version: '1.0.0' });
  });

  // ============================================
  // Floify Mock API
  // ============================================
  
  // Floify Loans API
  app.get(`${basePath}/floify/api/v1/loans`, (req: Request, res: Response) => {
    const apiKey = req.headers['x-api-key'] || req.headers.authorization?.replace('Bearer ', '');
    
    if (!apiKey) {
      return res.status(401).json({ error: 'Unauthorized', message: 'Missing API key' });
    }
    
    const limit = parseInt(req.query.limit as string) || 100;
    const offset = parseInt(req.query.offset as string) || 0;
    
    const cacheKey = `floify_${limit}_${offset}`;
    if (!mockLoans.has(cacheKey)) {
      const loans = Array.from({ length: limit }, (_, i) => 
        generateMockLoan(offset + i, 'floify')
      );
      mockLoans.set(cacheKey, loans);
    }
    
    const loans = mockLoans.get(cacheKey) || [];
    
    res.json({
      loans: loans,
      total: 1000,
      page: Math.floor(offset / limit) + 1,
      per_page: limit,
    });
  });

  // ============================================
  // OptimalBlue Mock API
  // ============================================
  
  // OptimalBlue Loans API
  app.get(`${basePath}/optimalblue/api/v1/loans`, (req: Request, res: Response) => {
    const apiKey = req.headers['x-api-key'] || req.headers.authorization?.replace('Bearer ', '');
    
    if (!apiKey) {
      return res.status(401).json({ error: 'Unauthorized', message: 'Missing API key' });
    }
    
    const limit = parseInt(req.query.limit as string) || 100;
    const offset = parseInt(req.query.offset as string) || 0;
    
    const cacheKey = `optimalblue_${limit}_${offset}`;
    if (!mockLoans.has(cacheKey)) {
      const loans = Array.from({ length: limit }, (_, i) => 
        generateMockLoan(offset + i, 'optimalblue')
      );
      mockLoans.set(cacheKey, loans);
    }
    
    const loans = mockLoans.get(cacheKey) || [];
    
    res.json({
      data: loans,
      pagination: {
        total: 1000,
        page: Math.floor(offset / limit) + 1,
        per_page: limit,
      },
    });
  });

  // ============================================
  // Generic LOS Mock API
  // ============================================
  
  // Generic Health Check
  app.get(`${basePath}/health`, (req: Request, res: Response) => {
    res.json({ 
      status: 'ok', 
      service: 'Mock LOS API Server',
      version: '1.0.0',
      supported_systems: ['encompass', 'meridianlink', 'floify', 'optimalblue'],
    });
  });

  // Generic Loans Endpoint (tries multiple common endpoints)
  app.get(`${basePath}/api/v1/loans`, (req: Request, res: Response) => {
    const apiKey = req.headers['x-api-key'] || req.headers.authorization?.replace('Bearer ', '');
    
    if (!apiKey) {
      return res.status(401).json({ error: 'Unauthorized', message: 'Missing API key' });
    }
    
    const limit = parseInt(req.query.limit as string) || 100;
    const offset = parseInt(req.query.offset as string) || 0;
    
    const cacheKey = `generic_${limit}_${offset}`;
    if (!mockLoans.has(cacheKey)) {
      const loans = Array.from({ length: limit }, (_, i) => 
        generateMockLoan(offset + i, 'generic')
      );
      mockLoans.set(cacheKey, loans);
    }
    
    const loans = mockLoans.get(cacheKey) || [];
    
    res.json({
      data: loans,
      loans: loans, // Support both formats
      total: 1000,
    });
  });

  app.get(`${basePath}/api/loans`, (req: Request, res: Response) => {
    // Same as above but different path
    return app._router.handle({ ...req, url: `${basePath}/api/v1/loans` }, res);
  });

  console.log('✅ Mock LOS API setup complete');
}

/**
 * Get mock API base URL for a LOS type
 */
export function getMockApiBaseUrl(losType: string, serverPort: number = 3001): string {
  const baseUrl = `http://localhost:${serverPort}/mock-los`;
  
  switch (losType) {
    case 'encompass':
      return `${baseUrl}/encompass`;
    case 'meridianlink':
      return `${baseUrl}/meridianlink`;
    case 'floify':
      return `${baseUrl}/floify`;
    case 'optimalblue':
      return `${baseUrl}/optimalblue`;
    default:
      return baseUrl;
  }
}

/**
 * Get mock credentials for a LOS type (for testing)
 */
export function getMockCredentials(losType: string): {
  api_client_id?: string;
  api_client_secret?: string;
  api_key?: string;
  oauth_token_url?: string;
} {
  switch (losType) {
    case 'encompass':
      return {
        api_client_id: 'mock_encompass_client_id',
        api_client_secret: 'mock_encompass_client_secret',
        oauth_token_url: 'http://localhost:3001/mock-los/encompass/oauth2/v1/token',
      };
    case 'meridianlink':
      return {
        api_key: 'mock_meridianlink_api_key_12345',
      };
    case 'floify':
      return {
        api_key: 'mock_floify_api_key_12345',
      };
    case 'optimalblue':
      return {
        api_key: 'mock_optimalblue_api_key_12345',
      };
    default:
      return {
        api_key: 'mock_generic_api_key_12345',
      };
  }
}
