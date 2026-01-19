/**
 * AWS Cost Explorer Service
 * Integrates with AWS Cost Explorer API to fetch real-time cost data
 */

export interface AWSCostData {
  service: string;
  cost: number;
  usage: number;
  unit: string;
  date: string;
}

export interface AWSCostSummary {
  totalCost: number;
  byService: AWSCostData[];
  period: {
    start: string;
    end: string;
  };
}

/**
 * Fetch AWS costs from Cost Explorer API
 */
export async function fetchAWSCosts(
  startDate: Date,
  endDate: Date,
  tenantId?: string
): Promise<AWSCostSummary> {
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  const region = process.env.AWS_REGION || 'us-east-1';

  if (!accessKeyId || !secretAccessKey) {
    throw new Error('AWS credentials not configured');
  }

  try {
    // AWS Cost Explorer API endpoint
    const endpoint = `https://ce.${region}.amazonaws.com/`;

    // Prepare request
    const requestBody = {
      TimePeriod: {
        Start: startDate.toISOString().split('T')[0],
        End: endDate.toISOString().split('T')[0],
      },
      Granularity: 'DAILY',
      Metrics: ['BlendedCost', 'UsageQuantity'],
      GroupBy: [
        {
          Type: 'DIMENSION',
          Key: 'SERVICE',
        },
      ],
    };

    // For now, return mock data structure
    // In production, use AWS SDK to make authenticated requests
    // const AWS = await import('aws-sdk');
    // const costExplorer = new AWS.CostExplorer({ region });
    // const result = await costExplorer.getCostAndUsage(requestBody).promise();

    // Mock response structure
    return {
      totalCost: 0,
      byService: [],
      period: {
        start: startDate.toISOString().split('T')[0],
        end: endDate.toISOString().split('T')[0],
      },
    };
  } catch (error: any) {
    throw new Error(`Failed to fetch AWS costs: ${error.message}`);
  }
}

/**
 * Parse AWS Cost Explorer response and store in cost_events
 */
export async function syncAWSCostsToDatabase(
  tenantId: string,
  instanceId: string,
  costData: AWSCostSummary
): Promise<void> {
  const { pool } = await import('../config/database.js');

  for (const serviceCost of costData.byService) {
    // Determine usage type based on service
    let usageType = 'compute_hours';
    let usageUnit = 'hours';

    if (serviceCost.service.includes('S3')) {
      usageType = 'storage_gb';
      usageUnit = 'GB';
    } else if (serviceCost.service.includes('CloudFront') || serviceCost.service.includes('DataTransfer')) {
      usageType = 'network_gb';
      usageUnit = 'GB';
    } else if (serviceCost.service.includes('Lambda')) {
      usageType = 'requests';
      usageUnit = 'requests';
    }

    // Calculate unit price
    const unitPrice = serviceCost.usage > 0 ? serviceCost.cost / serviceCost.usage : 0;

    // Store cost event (avoid duplicates by checking if record exists)
    const existing = await pool.query(
      `SELECT id FROM public.cost_events
       WHERE tenant_id = $1 
         AND instance_id = $2
         AND service_name = $3
         AND DATE(created_at) = DATE($4)
       LIMIT 1`,
      [tenantId, instanceId, serviceCost.service, new Date(serviceCost.date)]
    );

    if (existing.rows.length === 0) {
      await pool.query(
        `INSERT INTO public.cost_events
         (tenant_id, instance_id, service_category, service_provider, service_name,
          usage_type, usage_amount, usage_unit, unit_price, total_cost, created_at)
         VALUES ($1, $2, 'aws', 'aws', $3, $4, $5, $6, $7, $8, $9)`,
        [
          tenantId,
          instanceId,
          serviceCost.service,
          usageType,
          serviceCost.usage,
          usageUnit,
          unitPrice,
          serviceCost.cost,
          new Date(serviceCost.date),
        ]
      );
    }
  }
}

/**
 * Get AWS service pricing (for cost estimation)
 */
export function getAWSServicePricing(service: string, region: string = 'us-east-1'): {
  unitPrice: number;
  unit: string;
} {
  // Pricing reference (as of 2024)
  const pricing: Record<string, { unitPrice: number; unit: string }> = {
    'Amazon Elastic Compute Cloud - Compute': {
      unitPrice: 0.1664, // t3.xlarge per hour
      unit: 'hours',
    },
    'Amazon Relational Database Service': {
      unitPrice: 0.26, // db.r6g.large per hour
      unit: 'hours',
    },
    'Amazon Simple Storage Service': {
      unitPrice: 0.023, // per GB per month
      unit: 'GB',
    },
    'Amazon CloudFront': {
      unitPrice: 0.085, // per GB
      unit: 'GB',
    },
    'AWS Lambda': {
      unitPrice: 0.20, // per 1M requests
      unit: '1M requests',
    },
    'Amazon API Gateway': {
      unitPrice: 3.50, // per 1M requests
      unit: '1M requests',
    },
  };

  return pricing[service] || { unitPrice: 0, unit: 'unknown' };
}

