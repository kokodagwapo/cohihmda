#!/bin/bash
# ============================================================================
# SSL Setup Script for AWS Deployment
# ============================================================================
# This script sets up SSL certificates for both frontend (CloudFront) and backend (EC2)

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${GREEN}🔒 SSL Setup for Ailethia/Coheus Deployment${NC}"
echo ""

# Check if running on EC2
if [ ! -f /sys/class/dmi/id/product_uuid ] || [ "$(curl -s http://169.254.169.254/latest/meta-data/instance-id 2>/dev/null)" = "" ]; then
    echo -e "${YELLOW}⚠️  This script should be run on the EC2 instance${NC}"
    echo -e "${YELLOW}   For CloudFront SSL setup, use AWS Console or CLI${NC}"
    exit 1
fi

# Get domain name
read -p "Enter your domain name (e.g., ailethia.com): " DOMAIN
if [ -z "$DOMAIN" ]; then
    echo -e "${RED}❌ Domain name is required${NC}"
    exit 1
fi

echo ""
echo -e "${BLUE}📋 Setting up SSL for: ${DOMAIN}${NC}"
echo ""

# Check if Nginx is installed
if ! command -v nginx &> /dev/null; then
    echo -e "${YELLOW}⚠️  Nginx not found. Installing...${NC}"
    sudo apt update
    sudo apt install -y nginx
fi

# Install Certbot
if ! command -v certbot &> /dev/null; then
    echo -e "${GREEN}📦 Installing Certbot...${NC}"
    sudo apt update
    sudo apt install -y certbot python3-certbot-nginx
fi

# Update Nginx config to use domain
echo -e "${GREEN}📝 Updating Nginx configuration...${NC}"
sudo tee /etc/nginx/sites-available/ailethia > /dev/null <<EOF
server {
    listen 80;
    server_name ${DOMAIN} www.${DOMAIN};

    # Redirect HTTP to HTTPS (will be updated by Certbot)
    location / {
        return 301 https://\$host\$request_uri;
    }
}

server {
    listen 443 ssl http2;
    server_name ${DOMAIN} www.${DOMAIN};

    # SSL configuration (will be updated by Certbot)
    ssl_certificate /etc/letsencrypt/live/${DOMAIN}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${DOMAIN}/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    # Security headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;

    # Backend API
    location /api {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
        
        # Timeouts
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    # WebSocket
    location /ws {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        
        # WebSocket timeouts
        proxy_connect_timeout 7d;
        proxy_send_timeout 7d;
        proxy_read_timeout 7d;
    }

    # Health check
    location /health {
        proxy_pass http://localhost:3001/health;
        access_log off;
    }
}
EOF

# Enable site
sudo ln -sf /etc/nginx/sites-available/ailethia /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default

# Test Nginx configuration
echo -e "${GREEN}🔍 Testing Nginx configuration...${NC}"
sudo nginx -t

# Start Nginx
sudo systemctl restart nginx

# Obtain SSL certificate
echo ""
echo -e "${GREEN}🔐 Obtaining SSL certificate from Let's Encrypt...${NC}"
echo -e "${YELLOW}   Make sure your domain DNS points to this server's IP address${NC}"
echo -e "${YELLOW}   Press Enter to continue or Ctrl+C to cancel...${NC}"
read

sudo certbot --nginx -d ${DOMAIN} -d www.${DOMAIN} --non-interactive --agree-tos --email admin@${DOMAIN} --redirect

# Setup auto-renewal
echo -e "${GREEN}🔄 Setting up automatic certificate renewal...${NC}"
sudo systemctl enable certbot.timer
sudo systemctl start certbot.timer

# Test renewal
sudo certbot renew --dry-run

echo ""
echo -e "${GREEN}✅ SSL setup complete!${NC}"
echo ""
echo -e "Your backend is now available at:"
echo -e "  ${GREEN}https://${DOMAIN}${NC}"
echo ""
echo -e "Certificate will auto-renew. Test renewal with:"
echo -e "  ${YELLOW}sudo certbot renew --dry-run${NC}"
echo ""
