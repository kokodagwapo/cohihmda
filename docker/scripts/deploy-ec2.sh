#!/bin/bash
# EC2 Deployment Script for Coheus
# Automated deployment to EC2 instance with AWS services integration

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default values
INSTANCE_IP=""
SSH_KEY=""
ENV="prod"
USE_AWS_SERVICES=false
RDS_ENDPOINT=""
ELASTICACHE_ENDPOINT=""
S3_BUCKET=""
SSH_USER="ec2-user"

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --instance-ip)
            INSTANCE_IP="$2"
            shift 2
            ;;
        --ssh-key)
            SSH_KEY="$2"
            shift 2
            ;;
        --env)
            ENV="$2"
            shift 2
            ;;
        --use-aws-services)
            USE_AWS_SERVICES=true
            shift
            ;;
        --rds-endpoint)
            RDS_ENDPOINT="$2"
            shift 2
            ;;
        --elasticache-endpoint)
            ELASTICACHE_ENDPOINT="$2"
            shift 2
            ;;
        --s3-bucket)
            S3_BUCKET="$2"
            shift 2
            ;;
        --ssh-user)
            SSH_USER="$2"
            shift 2
            ;;
        *)
            echo -e "${RED}Unknown option: $1${NC}"
            exit 1
            ;;
    esac
done

# Validate required arguments
if [ -z "$INSTANCE_IP" ]; then
    echo -e "${RED}Error: --instance-ip is required${NC}"
    exit 1
fi

if [ -z "$SSH_KEY" ]; then
    echo -e "${RED}Error: --ssh-key is required${NC}"
    exit 1
fi

if [ ! -f "$SSH_KEY" ]; then
    echo -e "${RED}Error: SSH key file not found: $SSH_KEY${NC}"
    exit 1
fi

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}EC2 Deployment for Coheus${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""
echo -e "${GREEN}Instance IP:${NC} $INSTANCE_IP"
echo -e "${GREEN}SSH Key:${NC} $SSH_KEY"
echo -e "${GREEN}Environment:${NC} $ENV"
echo -e "${GREEN}Use AWS Services:${NC} $USE_AWS_SERVICES"
echo ""

# Build SSH command
SSH_CMD="ssh -i $SSH_KEY -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null $SSH_USER@$INSTANCE_IP"
SCP_CMD="scp -i $SSH_KEY -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null"

# Test SSH connection
echo -e "${YELLOW}Testing SSH connection...${NC}"
if $SSH_CMD "echo 'Connection successful'" > /dev/null 2>&1; then
    echo -e "${GREEN}✓ SSH connection successful${NC}"
else
    echo -e "${RED}Error: Cannot connect to EC2 instance${NC}"
    exit 1
fi

# Check if Docker is installed
echo -e "${YELLOW}Checking Docker installation on EC2...${NC}"
if $SSH_CMD "command -v docker" > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Docker is installed${NC}"
else
    echo -e "${YELLOW}Docker not found. Running setup script...${NC}"
    $SSH_CMD "curl -fsSL https://get.docker.com -o get-docker.sh && sudo sh get-docker.sh"
    $SSH_CMD "sudo usermod -aG docker $SSH_USER"
    echo -e "${GREEN}✓ Docker installed${NC}"
fi

# Check Docker Compose
if $SSH_CMD "docker compose version" > /dev/null 2>&1 || $SSH_CMD "command -v docker-compose" > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Docker Compose is installed${NC}"
else
    echo -e "${YELLOW}Installing Docker Compose...${NC}"
    $SSH_CMD "sudo curl -L \"https://github.com/docker/compose/releases/latest/download/docker-compose-\$(uname -s)-\$(uname -m)\" -o /usr/local/bin/docker-compose && sudo chmod +x /usr/local/bin/docker-compose"
    echo -e "${GREEN}✓ Docker Compose installed${NC}"
fi

# Create project directory on EC2
echo -e "${YELLOW}Setting up project directory...${NC}"
$SSH_CMD "mkdir -p ~/coheus"
echo -e "${GREEN}✓ Project directory created${NC}"

# Copy project files to EC2
echo -e "${YELLOW}Copying project files to EC2...${NC}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Create a temporary tar archive
TEMP_TAR=$(mktemp)
cd "$PROJECT_ROOT"
tar --exclude='.git' --exclude='node_modules' --exclude='dist' --exclude='docs' \
    --exclude='.env' --exclude='*.log' -czf "$TEMP_TAR" .

# Copy to EC2
$SCP_CMD "$TEMP_TAR" "$SSH_USER@$INSTANCE_IP:~/coheus/project.tar.gz"
rm "$TEMP_TAR"

# Extract on EC2
$SSH_CMD "cd ~/coheus && tar -xzf project.tar.gz && rm project.tar.gz"
echo -e "${GREEN}✓ Project files copied${NC}"

# Setup environment file
echo -e "${YELLOW}Setting up environment configuration...${NC}"
ENV_CONFIG="NODE_ENV=production\n"
ENV_CONFIG+="PORT=3001\n"

if [ "$USE_AWS_SERVICES" = true ]; then
    if [ -n "$RDS_ENDPOINT" ]; then
        ENV_CONFIG+="DB_HOST=$RDS_ENDPOINT\n"
        ENV_CONFIG+="DB_SSL=true\n"
    else
        ENV_CONFIG+="DB_HOST=postgres\n"
        ENV_CONFIG+="DB_SSL=false\n"
    fi
    
    if [ -n "$ELASTICACHE_ENDPOINT" ]; then
        ENV_CONFIG+="REDIS_HOST=$ELASTICACHE_ENDPOINT\n"
    else
        ENV_CONFIG+="REDIS_HOST=redis\n"
    fi
    
    if [ -n "$S3_BUCKET" ]; then
        ENV_CONFIG+="S3_BUCKET=$S3_BUCKET\n"
    fi
    
    # Get AWS credentials from instance metadata or environment
    ENV_CONFIG+="AWS_REGION=\$(curl -s http://169.254.169.254/latest/meta-data/placement/region)\n"
else
    ENV_CONFIG+="DB_HOST=postgres\n"
    ENV_CONFIG+="DB_SSL=false\n"
    ENV_CONFIG+="REDIS_HOST=redis\n"
fi

ENV_CONFIG+="DB_PORT=5432\n"
ENV_CONFIG+="DB_NAME=coheus\n"
ENV_CONFIG+="DB_USER=postgres\n"
ENV_CONFIG+="DB_PASSWORD=\${DB_PASSWORD:-CHANGE_ME}\n"
ENV_CONFIG+="REDIS_PORT=6379\n"
ENV_CONFIG+="JWT_SECRET=\${JWT_SECRET:-CHANGE_ME}\n"
ENV_CONFIG+="TENANT_ISOLATION_ENABLED=true\n"

# Write env file to EC2
$SSH_CMD "cat > ~/coheus/docker/prod/.env << 'EOF'
$ENV_CONFIG
EOF"

echo -e "${GREEN}✓ Environment configured${NC}"

# Build and start services
echo -e "${YELLOW}Building and starting services...${NC}"
$SSH_CMD "cd ~/coheus/docker/prod && docker compose --env-file .env up -d --build"

echo -e "${GREEN}✓ Services started${NC}"

# Wait for services
echo -e "${YELLOW}Waiting for services to be healthy...${NC}"
sleep 15

# Run health checks
echo -e "${YELLOW}Running health checks...${NC}"
if $SSH_CMD "curl -f http://localhost:3001/health" > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Backend health check passed${NC}"
else
    echo -e "${RED}✗ Backend health check failed${NC}"
    $SSH_CMD "cd ~/coheus/docker/prod && docker compose logs --tail=50"
    exit 1
fi

# Setup systemd service for auto-start
echo -e "${YELLOW}Setting up systemd service for auto-start...${NC}"
$SSH_CMD "sudo tee /etc/systemd/system/coheus.service > /dev/null << 'EOF'
[Unit]
Description=Coheus Docker Compose
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/home/$SSH_USER/coheus/docker/prod
ExecStart=/usr/local/bin/docker-compose --env-file .env up -d
ExecStop=/usr/local/bin/docker-compose --env-file .env down
User=$SSH_USER
Group=docker

[Install]
WantedBy=multi-user.target
EOF"

$SSH_CMD "sudo systemctl daemon-reload"
$SSH_CMD "sudo systemctl enable coheus.service"
echo -e "${GREEN}✓ Systemd service configured${NC}"

# Display deployment status
echo ""
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Deployment Complete${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""
echo -e "${GREEN}Instance:${NC} $INSTANCE_IP"
echo -e "${GREEN}Frontend:${NC} http://$INSTANCE_IP"
echo -e "${GREEN}Backend API:${NC} http://$INSTANCE_IP:3001"
echo -e "${GREEN}Backend Health:${NC} http://$INSTANCE_IP:3001/health"
echo ""
echo -e "${YELLOW}To view logs:${NC} ssh -i $SSH_KEY $SSH_USER@$INSTANCE_IP 'cd ~/coheus/docker/prod && docker compose logs -f'"
echo -e "${YELLOW}To restart services:${NC} ssh -i $SSH_KEY $SSH_USER@$INSTANCE_IP 'sudo systemctl restart coheus'"
echo ""
