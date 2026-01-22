/**
 * Seed Management Database
 * Creates default tenants and test data for local development
 * Run with: npm run seed:management-db
 * 
 * Note: This script uses TypeScript. Make sure tsx is installed:
 *   npm install -g tsx
 *   or
 *   npm install --save-dev tsx
 */

import { pool as managementPool } from '../server/src/config/managementDatabase.js';
import { createTenant } from '../server/src/services/tenantProvisioningService.js';

interface SeedTenant {
  name: string;
  slug: string;
  deployment_type: 'cloud' | 'on_premise' | 'per_lender_aws';
  database_host: string;
  database_port?: number;
  database_user: string;
  database_password: string;
}

const DEFAULT_TENANTS: SeedTenant[] = [
  {
    name: 'Default Tenant',
    slug: 'default',
    deployment_type: 'cloud',
    database_host: process.env.DB_HOST || '127.0.0.1',
    database_port: parseInt(process.env.DB_PORT || '5432'),
    database_user: process.env.DB_USER || 'postgres',
    database_password: process.env.DB_PASSWORD || 'postgres',
  },
  {
    name: 'Acme Lending',
    slug: 'acme-lending',
    deployment_type: 'cloud',
    database_host: process.env.DB_HOST || '127.0.0.1',
    database_port: parseInt(process.env.DB_PORT || '5432'),
    database_user: process.env.DB_USER || 'postgres',
    database_password: process.env.DB_PASSWORD || 'postgres',
  },
];

async function seedManagementDatabase() {
  console.log('🌱 Seeding management database...\n');

  try {
    // Check if tenants already exist
    const existingTenants = await managementPool.query(
      'SELECT slug FROM coheus_tenants'
    );

    if (existingTenants.rows.length > 0) {
      console.log(`⚠️  Found ${existingTenants.rows.length} existing tenant(s):`);
      existingTenants.rows.forEach((t) => {
        console.log(`   - ${t.slug}`);
      });
      console.log('\n💡 To re-seed, delete existing tenants first or use different slugs.\n');
      return;
    }

    // Create default tenants
    console.log('Creating default tenants...\n');
    for (const tenantConfig of DEFAULT_TENANTS) {
      try {
        console.log(`Creating tenant: ${tenantConfig.name} (${tenantConfig.slug})...`);
        const tenant = await createTenant(tenantConfig);
        console.log(`✅ Created tenant: ${tenant.name} (ID: ${tenant.id})`);
        console.log(`   Database: ${tenant.database_name}\n`);
      } catch (error: any) {
        if (error.message?.includes('already exists') || error.message?.includes('duplicate')) {
          console.log(`⚠️  Tenant ${tenantConfig.slug} already exists, skipping...\n`);
        } else {
          console.error(`❌ Failed to create tenant ${tenantConfig.slug}:`, error.message);
          console.log('');
        }
      }
    }

    console.log('✅ Management database seeding completed!\n');
    console.log('Next steps:');
    console.log('1. Start your server: npm run dev:all');
    console.log('2. Log in to /admin and verify tenants');
    console.log('3. Create LOS connections for each tenant');
  } catch (error: any) {
    console.error('❌ Error seeding management database:', error.message);
    process.exit(1);
  } finally {
    await managementPool.end();
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  seedManagementDatabase();
}

export { seedManagementDatabase };
