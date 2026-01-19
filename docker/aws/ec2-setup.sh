#!/bin/bash
# EC2 Setup Script
# Prepares EC2 instance for Docker deployment

set -e

echo "=========================================="
echo "Coheus EC2 Setup Script"
echo "=========================================="
echo ""

# Update system
echo "Updating system packages..."
sudo yum update -y

# Install Docker
echo "Installing Docker..."
if ! command -v docker &> /dev/null; then
    sudo yum install -y docker
    sudo systemctl start docker
    sudo systemctl enable docker
    sudo usermod -aG docker ec2-user
    echo "✓ Docker installed"
else
    echo "✓ Docker already installed"
fi

# Install Docker Compose
echo "Installing Docker Compose..."
if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
    sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
    sudo chmod +x /usr/local/bin/docker-compose
    echo "✓ Docker Compose installed"
else
    echo "✓ Docker Compose already installed"
fi

# Install Git
echo "Installing Git..."
sudo yum install -y git

# Install additional utilities
echo "Installing utilities..."
sudo yum install -y curl wget jq

# Configure swap space (if needed)
if [ ! -f /swapfile ]; then
    echo "Creating swap space..."
    sudo dd if=/dev/zero of=/swapfile bs=1M count=2048
    sudo chmod 600 /swapfile
    sudo mkswap /swapfile
    sudo swapon /swapfile
    echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
    echo "✓ Swap space created"
fi

# Configure automatic updates
echo "Configuring automatic updates..."
sudo yum install -y yum-cron
sudo systemctl enable yum-cron
sudo systemctl start yum-cron

# Setup log rotation
echo "Configuring log rotation..."
sudo tee /etc/logrotate.d/docker-containers > /dev/null << 'EOF'
/var/lib/docker/containers/*/*.log {
    rotate 7
    daily
    compress
    size=1M
    missingok
    delaycompress
    copytruncate
}
EOF

# Create deployment directory
echo "Creating deployment directory..."
mkdir -p ~/coheus
cd ~/coheus

# Install CloudWatch agent (optional)
echo "Installing CloudWatch agent..."
if command -v amazon-cloudwatch-agent &> /dev/null; then
    echo "✓ CloudWatch agent already installed"
else
    wget https://s3.amazonaws.com/amazoncloudwatch-agent/amazon_linux/amd64/latest/amazon-cloudwatch-agent.rpm
    sudo rpm -U ./amazon-cloudwatch-agent.rpm
    echo "✓ CloudWatch agent installed"
fi

echo ""
echo "=========================================="
echo "Setup Complete!"
echo "=========================================="
echo ""
echo "Next steps:"
echo "1. Log out and log back in for Docker group changes to take effect"
echo "2. Clone your repository: git clone <repo-url> ~/coheus"
echo "3. Run deployment script: ./docker/scripts/deploy-ec2.sh"
echo ""
