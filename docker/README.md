# Coheus Docker Infrastructure

Complete Docker-based development and production environment for Coheus with multi-tenant support and EC2 deployment capabilities.

## Table of Contents

- [Overview](#overview)
- [Quick Start](#quick-start)
- [Development Setup](#development-setup)
- [Production Deployment](#production-deployment)
- [EC2 Deployment](#ec2-deployment)
- [Multi-Tenant Configuration](#multi-tenant-configuration)
- [Architecture](#architecture)
- [Troubleshooting](#troubleshooting)

## Overview

This Docker infrastructure provides:

- **Development Environment**: Hot-reload enabled for rapid development
- **Production Environment**: Optimized builds with health checks and resource limits
- **Multi-Tenant Support**: Row-level security and tenant isolation
- **EC2 Deployment**: Automated deployment scripts for AWS EC2 instances
- **AWS Integration**: Support for RDS, ElastiCache, and S3 managed services

## Quick Start

### Development

```bash
# Setup and start development environment
./docker/scripts/setup.sh dev

# Access services
# Frontend: http://localhost:8080
# Backend: http://localhost:3001
```

### Production

```bash
# Setup and start production environment
./docker/scripts/setup.sh prod

# Deploy with health checks
./docker/scripts/deploy.sh
```

## Development Setup

### Prerequisites

- Docker 20.10+
- Docker Compose 2.0+ (or docker-compose 1.29+)
- 4GB+ RAM available
- 10GB+ disk space

### Initial Setup

1. **Configure Environment**

   ```bash
   cd docker/dev
   cp .env.example.dev .env
   # Edit .env with your configuration
   ```

2. **Start Services**

   ```bash
   ./docker/scripts/setup.sh dev
   ```

3. **Verify Services**

   ```bash
   ./docker/scripts/health-check.sh dev
   ```

### Development Services

- **Frontend**: React/Vite dev server on port 8080
- **Backend**: Node.js/Express with hot-reload on port 3001
- **PostgreSQL**: Database on port 5432
- **Redis**: Cache on port 6379

### Hot Reload

Both frontend and backend support hot-reload:
- Frontend: Changes to `src/` automatically reload
- Backend: Changes to `server/src/` automatically rebuild and restart

### Viewing Logs

```bash
cd docker/dev
docker compose logs -f [service-name]
```

## Production Deployment

### Local Production

1. **Configure Environment**

   ```bash
   cd docker/prod
   cp .env.example.prod .env
   # Edit .env with secure passwords and configuration
   ```

2. **Deploy**

   ```bash
   ./docker/scripts/deploy.sh
   ```

3. **Health Checks**

   ```bash
   ./docker/scripts/health-check.sh prod
   ```

### Production Services

- **Frontend**: Nginx serving built static files on port 80
- **Backend**: Node.js/Express production build on port 3001
- **PostgreSQL**: Database with backups on port 5432
- **Redis**: Cache with persistence on port 6379

### Resource Limits

Production containers have resource limits configured:
- Backend: 2 CPU, 4GB RAM
- Frontend: 0.5 CPU, 512MB RAM
- PostgreSQL: 2 CPU, 4GB RAM
- Redis: 1 CPU, 2GB RAM

## EC2 Deployment

### Prerequisites

- EC2 instance running Amazon Linux 2023 or Ubuntu 22.04
- SSH access with key pair
- Security group allowing ports 22, 80, 443, 3001

### Quick Deployment

```bash
./docker/scripts/deploy-ec2.sh \
  --instance-ip <EC2_IP_ADDRESS> \
  --ssh-key <PATH_TO_SSH_KEY> \
  --env prod
```

### With AWS Managed Services

```bash
./docker/scripts/deploy-ec2.sh \
  --instance-ip <EC2_IP_ADDRESS> \
  --ssh-key <PATH_TO_SSH_KEY> \
  --env prod \
  --use-aws-services \
  --rds-endpoint <RDS_ENDPOINT> \
  --elasticache-endpoint <ELASTICACHE_ENDPOINT> \
  --s3-bucket <S3_BUCKET_NAME>
```

### EC2 Setup Script

For new EC2 instances, run the setup script first:

```bash
# Copy setup script to EC2
scp -i <SSH_KEY> docker/aws/ec2-setup.sh ec2-user@<EC2_IP>:~/

# SSH into instance and run
ssh -i <SSH_KEY> ec2-user@<EC2_IP>
chmod +x ec2-setup.sh
./ec2-setup.sh
```

### CloudFormation Deployment

Deploy infrastructure using CloudFormation:

```bash
aws cloudformation create-stack \
  --stack-name coheus-docker-stack \
  --template-body file://docker/aws/cloudformation/docker-stack.yaml \
  --parameters \
    ParameterKey=InstanceType,ParameterValue=t3.medium \
    ParameterKey=KeyPairName,ParameterValue=your-key-pair \
    ParameterKey=VpcId,ParameterValue=vpc-xxxxx \
    ParameterKey=SubnetId,ParameterValue=subnet-xxxxx
```

## Multi-Tenant Configuration

### Tenant Isolation

Coheus uses row-level security with `tenant_id` in all database tables. The system enforces tenant isolation through:

1. **Database Level**: All queries filtered by `tenant_id`
2. **Middleware**: Tenant isolation middleware validates requests
3. **Redis Keys**: Tenant-scoped with prefix `coheus:tenant:{tenant_id}:`

### Environment Variables

Key multi-tenant configuration variables:

```env
# Enable tenant isolation
TENANT_ISOLATION_ENABLED=true

# Maximum tenants supported
MAX_TENANTS=1000

# Resource quotas per tenant
TENANT_RESOURCE_QUOTAS_ENABLED=true
TENANT_MAX_USERS=200
TENANT_MAX_LOANS=10000
TENANT_MAX_STORAGE_GB=100

# Redis key prefix for tenant scoping
REDIS_KEY_PREFIX=coheus:tenant:
```

### Creating Tenants

Tenants are created through the admin API:

```bash
# Create a new tenant
curl -X POST http://localhost:3001/api/admin/tenants \
  -H "Authorization: Bearer <admin-token>" \
  -H "Content-Type: application/json" \
  -d '{"name": "New Tenant"}'
```

### Tenant Data Isolation

All data is automatically isolated by tenant:
- Users belong to a tenant
- Loans are scoped to tenants
- Documents are tenant-specific
- Cache keys are tenant-prefixed

## Architecture

### Service Architecture

```
┌─────────────────────────────────────────────────┐
│              Docker Network                      │
│                                                  │
│  ┌──────────────┐  ┌──────────────┐            │
│  │   Frontend   │  │   Backend    │            │
│  │  (Nginx)     │──│  (Node.js)   │            │
│  │  Port 80     │  │  Port 3001   │            │
│  └──────────────┘  └──────┬───────┘            │
│                           │                     │
│         ┌──────────────────┼──────────┐         │
│         │                  │          │         │
│    ┌────▼─────┐      ┌──────▼──────┐  │         │
│    │PostgreSQL│      │   Redis     │  │         │
│    │ Port 5432│      │ Port 6379   │  │         │
│    └──────────┘      └──────────────┘  │         │
└────────────────────────────────────────┘         │
```

### Directory Structure

```
docker/
├── dev/                    # Development configuration
│   ├── docker-compose.dev.yml
│   ├── Dockerfile.backend.dev
│   ├── Dockerfile.frontend.dev
│   └── .env.example.dev
├── prod/                   # Production configuration
│   ├── docker-compose.prod.yml
│   ├── Dockerfile.backend.prod
│   ├── Dockerfile.frontend.prod
│   ├── nginx/
│   │   ├── nginx.conf
│   │   └── nginx-frontend.conf
│   └── .env.example.prod
├── aws/                    # AWS deployment files
│   ├── ec2-setup.sh
│   ├── ec2-deploy.sh
│   ├── user-data.sh
│   └── cloudformation/
│       └── docker-stack.yaml
└── scripts/                # Deployment scripts
    ├── setup.sh
    ├── deploy.sh
    ├── deploy-ec2.sh
    └── health-check.sh
```

## Environment Variables

### Development (.env.example.dev)

See `docker/dev/.env.example.dev` for all development environment variables.

### Production (.env.example.prod)

See `docker/prod/.env.example.prod` for all production environment variables.

### Required Variables

- `DB_PASSWORD`: PostgreSQL password
- `JWT_SECRET`: JWT signing secret (min 32 characters)
- `TENANT_ISOLATION_ENABLED`: Enable tenant isolation (true/false)

### AWS Variables (for EC2 with managed services)

- `RDS_ENDPOINT`: RDS PostgreSQL endpoint
- `ELASTICACHE_ENDPOINT`: ElastiCache Redis endpoint
- `S3_BUCKET`: S3 bucket for document storage
- `AWS_REGION`: AWS region
- `AWS_ACCESS_KEY_ID`: AWS access key (optional if using IAM role)
- `AWS_SECRET_ACCESS_KEY`: AWS secret key (optional if using IAM role)

## Scripts

### setup.sh

Initializes environment and starts services.

```bash
./docker/scripts/setup.sh [dev|prod]
```

**Features:**
- Validates Docker installation
- Creates .env from template
- Generates secure JWT secret
- Initializes volumes
- Runs database migrations
- Starts all services

### deploy.sh

Deploys production environment with health checks.

```bash
./docker/scripts/deploy.sh [--rebuild] [--no-cache]
```

**Features:**
- Builds production images
- Stops existing containers
- Starts new containers
- Runs health checks
- Verifies tenant isolation

### deploy-ec2.sh

Deploys to EC2 instance with AWS services integration.

```bash
./docker/scripts/deploy-ec2.sh \
  --instance-ip <IP> \
  --ssh-key <KEY> \
  --env prod \
  [--use-aws-services] \
  [--rds-endpoint <ENDPOINT>] \
  [--elasticache-endpoint <ENDPOINT>] \
  [--s3-bucket <BUCKET>]
```

**Features:**
- Installs Docker if needed
- Copies project files
- Configures environment
- Builds and starts services
- Sets up systemd service
- Runs health checks

### health-check.sh

Verifies all services are healthy.

```bash
./docker/scripts/health-check.sh [dev|prod]
```

**Checks:**
- Docker service status
- PostgreSQL connectivity
- Redis connectivity
- Backend API health
- Frontend accessibility
- Tenant isolation status
- Resource usage
- CloudWatch metrics export

## Troubleshooting

### Services Won't Start

1. Check Docker is running: `docker ps`
2. Check ports are available: `netstat -tuln | grep -E '3001|5432|6379|80'`
3. View logs: `docker compose logs`
4. Check disk space: `df -h`

### Database Connection Issues

1. Verify PostgreSQL is healthy: `docker exec coheus-postgres-prod pg_isready`
2. Check environment variables: `docker exec coheus-backend-prod env | grep DB_`
3. Test connection: `docker exec coheus-backend-prod npm run migrate`

### Frontend Not Loading

1. Check Nginx logs: `docker logs coheus-frontend-prod`
2. Verify backend is accessible: `curl http://localhost:3001/health`
3. Check Nginx config: `docker exec coheus-frontend-prod nginx -t`

### Tenant Isolation Issues

1. Verify middleware is enabled: Check `TENANT_ISOLATION_ENABLED=true`
2. Check tenant_id in requests: Look for `X-Tenant-ID` header
3. Verify database queries include tenant_id filter

### EC2 Deployment Issues

1. Check SSH access: `ssh -i <key> ec2-user@<ip>`
2. Verify Docker is installed: `docker --version`
3. Check security group: Ensure ports 22, 80, 443, 3001 are open
4. View instance logs: Check `/var/log/user-data.log`

### Performance Issues

1. Check resource usage: `docker stats`
2. Review resource limits in `docker-compose.prod.yml`
3. Monitor database connections: Check PostgreSQL connection pool
4. Review Redis memory usage: `docker exec coheus-redis-prod redis-cli INFO memory`

## Best Practices

### Security

- Always use strong passwords in production
- Rotate JWT secrets regularly
- Use AWS Secrets Manager for sensitive data
- Enable SSL/TLS in production
- Keep Docker images updated

### Performance

- Use resource limits to prevent resource exhaustion
- Monitor database connection pool size
- Configure Redis memory limits appropriately
- Use health checks for automatic recovery
- Set up log rotation

### Multi-Tenant

- Always enable tenant isolation in production
- Use tenant-scoped Redis keys
- Monitor tenant resource usage
- Implement tenant quotas as needed
- Audit tenant data access

## Support

For issues or questions:
1. Check logs: `docker compose logs`
2. Run health checks: `./docker/scripts/health-check.sh`
3. Review this documentation
4. Check the main project README

## License

See main project LICENSE file.
