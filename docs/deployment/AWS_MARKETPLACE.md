# AWS Marketplace Publishing Guide

This document provides a comprehensive guide for publishing Cohi as a self-hosted product on AWS Marketplace, enabling customers to deploy the application in their own AWS accounts.

> **Naming Convention:**
> - **Cohi** - The new executive intelligence platform (this product)
> - **Coheus** - The legacy Qlik Sense-based product

## Table of Contents

- [Overview](#overview)
- [Marketplace Product Types](#marketplace-product-types)
- [Prerequisites](#prerequisites)
- [Product Configuration](#product-configuration)
- [CloudFormation Template](#cloudformation-template)
- [Pricing Models](#pricing-models)
- [Submission Process](#submission-process)
- [Customer Experience](#customer-experience)
- [Maintenance and Updates](#maintenance-and-updates)
- [Compliance and Security](#compliance-and-security)

---

## Overview

AWS Marketplace allows Cohi to offer a self-hosted deployment option where customers:
- Deploy in their own AWS account
- Own and control all their data
- Pay for infrastructure + license fees
- Manage their own updates and maintenance

### Benefits

| Benefit | Description |
|---------|-------------|
| **Data Sovereignty** | Customer data never leaves their AWS account |
| **Compliance** | Easier to meet regulatory requirements |
| **Customization** | Customers can modify infrastructure |
| **Control** | Full access to logs, backups, and configuration |
| **Cost Transparency** | Clear infrastructure costs |

### Marketplace Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        AWS MARKETPLACE FLOW                                  │
└─────────────────────────────────────────────────────────────────────────────┘

    ┌──────────────┐
    │   Customer   │
    └──────┬───────┘
           │
           ▼
    ┌──────────────┐
    │ AWS          │  1. Customer finds Cohi on Marketplace
    │ Marketplace  │  2. Reviews pricing, features, documentation
    └──────┬───────┘  3. Clicks "Continue to Subscribe"
           │
           ▼
    ┌──────────────┐
    │ Subscription │  4. Accepts EULA
    │              │  5. Provides payment method (or BYOL)
    └──────┬───────┘
           │
           ▼
    ┌──────────────┐
    │ Configure    │  6. Selects deployment options
    │              │  7. Chooses region, instance types
    └──────┬───────┘
           │
           ▼
    ┌──────────────────────────────────────────────────────────┐
    │                   Customer's AWS Account                  │
    │                                                          │
    │   ┌──────────────┐                                       │
    │   │ CloudFormation│  8. Deploys infrastructure           │
    │   │    Stack      │  9. Creates EC2, RDS, ALB, etc.      │
    │   └──────┬───────┘                                       │
    │          │                                               │
    │          ▼                                               │
    │   ┌──────────────┐                                       │
    │   │     Cohi     │  10. Application running              │
    │   │   Running    │  11. Customer accesses via browser    │
    │   └──────────────┘                                       │
    │                                                          │
    └──────────────────────────────────────────────────────────┘
```

---

## Marketplace Product Types

### Recommended: CloudFormation Product

| Aspect | CloudFormation Product |
|--------|----------------------|
| **Deployment** | Customer deploys via CF template |
| **Infrastructure** | Created in customer's account |
| **Updates** | Publish new CF template version |
| **Pricing** | Contract or usage-based |
| **Best For** | Coheus self-hosted |

### Alternative: AMI Product

| Aspect | AMI Product |
|--------|-------------|
| **Deployment** | Launch pre-configured AMI |
| **Infrastructure** | Single EC2 instance |
| **Updates** | Publish new AMI version |
| **Pricing** | Hourly or annual |
| **Best For** | Simple single-server apps |

### Not Recommended: Container Product

Requires customers to have ECS/EKS knowledge - higher friction for target audience.

---

## Prerequisites

### Seller Requirements

1. **AWS Partner Network (APN) Account**
   - Register at https://partnercentral.awspartner.com
   - Complete seller registration

2. **Seller Central Account**
   - Access to AWS Marketplace Management Portal
   - Complete tax and banking information

3. **Product Documentation**
   - User guide
   - Architecture documentation
   - Support documentation
   - Security documentation

4. **Legal Documents**
   - End User License Agreement (EULA)
   - Privacy policy
   - Support policy

### Technical Requirements

1. **CloudFormation Template**
   - Validated and tested
   - Parameterized for flexibility
   - Includes all required resources

2. **AMI (if using hybrid approach)**
   - Hardened and secure
   - No default passwords
   - Latest security patches

3. **Testing Environment**
   - Test deployment in clean AWS account
   - Validate all functionality
   - Test upgrade path

---

## Product Configuration

### Product Listing Information

```yaml
Product:
  Name: "Cohi Executive Intelligence Platform"
  Short Description: "AI-powered analytics platform for mortgage lenders"
  Long Description: |
    Cohi is an executive intelligence platform designed specifically for 
    mortgage lenders. It provides real-time analytics, AI-powered insights, 
    and performance dashboards to help executives make data-driven decisions.
    
    Key Features:
    - Real-time loan pipeline analytics
    - AI-powered insights and recommendations
    - Executive dashboards and KPIs
    - LOS integration (Encompass, MeridianLink, etc.)
    - SSO integration (SAML/OIDC with Okta, Azure AD, etc.)
    - SOC 2 compliant architecture
    
  Categories:
    - Business Intelligence
    - Financial Services
    - Analytics
    
  Keywords:
    - mortgage
    - analytics
    - business intelligence
    - executive dashboard
    - AI insights
    
  Logo: "s3://cohi-marketplace-assets/logo.png"
  
  Support:
    Email: "support@cohi.io"
    URL: "https://support.cohi.io"
    Documentation: "https://docs.cohi.io"
```

### Architecture Diagram (Required)

Create a professional architecture diagram showing:
- VPC and network layout
- EC2/ECS, RDS, S3 components
- Security groups and IAM roles
- Data flow

### Usage Instructions

```markdown
# Getting Started with Cohi

## Prerequisites
- AWS account with admin access
- Domain name (optional)
- SSL certificate in ACM (optional)

## Deployment Steps

1. **Subscribe** to Cohi on AWS Marketplace
2. **Configure** deployment parameters:
   - Select region
   - Choose instance types
   - Set admin email
   - Enter database password
3. **Deploy** the CloudFormation stack
4. **Access** Cohi at the ALB URL provided in outputs
5. **Configure** SSO (optional) in the Admin panel
6. **Configure** LOS connections in the Admin panel

## First-Time Setup
1. Navigate to the application URL
2. Login with the admin email you provided
3. Set your password
4. Configure SSO with your identity provider (Okta, Azure AD, etc.)
5. Configure your LOS connection
6. Import your loan data

## Support
- Documentation: https://docs.cohi.io
- Support: support@cohi.io
```

---

## CloudFormation Template

### Template Structure

```yaml
# infrastructure/cloudformation/marketplace/coheus-self-hosted.yaml

AWSTemplateFormatVersion: '2010-09-09'
Description: |
  Coheus Executive Intelligence Platform - Self-Hosted Deployment
  
  This template deploys Coheus in your AWS account with:
  - VPC with public and private subnets
  - Application Load Balancer (HTTPS)
  - EC2 instance running the Coheus application
  - RDS PostgreSQL database
  - S3 bucket for document storage
  - Secrets Manager for credentials
  
  Estimated monthly cost: $100-150 (varies by region and usage)

Metadata:
  AWS::CloudFormation::Interface:
    ParameterGroups:
      - Label:
          default: "Application Configuration"
        Parameters:
          - AdminEmail
          - DomainName
          - CertificateArn
      - Label:
          default: "Infrastructure Configuration"
        Parameters:
          - InstanceType
          - DatabaseInstanceClass
      - Label:
          default: "Security Configuration"
        Parameters:
          - DatabasePassword
          - JwtSecret
      - Label:
          default: "Network Configuration"
        Parameters:
          - VpcCidr
          - AvailabilityZone1
          - AvailabilityZone2
    ParameterLabels:
      AdminEmail:
        default: "Administrator Email"
      DomainName:
        default: "Custom Domain (optional)"

Parameters:
  AdminEmail:
    Type: String
    Description: Email address for the initial admin user
    AllowedPattern: "^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$"
    ConstraintDescription: Must be a valid email address

  InstanceType:
    Type: String
    Default: t3.medium
    AllowedValues:
      - t3.small
      - t3.medium
      - t3.large
      - t3.xlarge
    Description: EC2 instance type for the application server

  DatabaseInstanceClass:
    Type: String
    Default: db.t3.small
    AllowedValues:
      - db.t3.micro
      - db.t3.small
      - db.t3.medium
    Description: RDS instance class for the database

  DatabasePassword:
    Type: String
    NoEcho: true
    MinLength: 12
    MaxLength: 41
    AllowedPattern: "^[a-zA-Z0-9!@#$%^&*()_+-=]*$"
    Description: Password for the database (min 12 characters)

  JwtSecret:
    Type: String
    NoEcho: true
    MinLength: 32
    Description: Secret key for JWT tokens (min 32 characters)

  VpcCidr:
    Type: String
    Default: "10.0.0.0/16"
    Description: CIDR block for the VPC

  AvailabilityZone1:
    Type: AWS::EC2::AvailabilityZone::Name
    Description: First availability zone

  AvailabilityZone2:
    Type: AWS::EC2::AvailabilityZone::Name
    Description: Second availability zone

  DomainName:
    Type: String
    Default: ""
    Description: Custom domain name (leave empty to use ALB DNS)

  CertificateArn:
    Type: String
    Default: ""
    Description: ACM certificate ARN for HTTPS (required if using custom domain)

Conditions:
  HasCustomDomain: !Not [!Equals [!Ref DomainName, ""]]
  HasCertificate: !Not [!Equals [!Ref CertificateArn, ""]]

Resources:
  # ============================================================================
  # VPC and Networking
  # ============================================================================
  VPC:
    Type: AWS::EC2::VPC
    Properties:
      CidrBlock: !Ref VpcCidr
      EnableDnsHostnames: true
      EnableDnsSupport: true
      Tags:
        - Key: Name
          Value: !Sub "${AWS::StackName}-vpc"

  PublicSubnet1:
    Type: AWS::EC2::Subnet
    Properties:
      VpcId: !Ref VPC
      CidrBlock: !Select [0, !Cidr [!Ref VpcCidr, 4, 8]]
      AvailabilityZone: !Ref AvailabilityZone1
      MapPublicIpOnLaunch: true
      Tags:
        - Key: Name
          Value: !Sub "${AWS::StackName}-public-1"

  PublicSubnet2:
    Type: AWS::EC2::Subnet
    Properties:
      VpcId: !Ref VPC
      CidrBlock: !Select [1, !Cidr [!Ref VpcCidr, 4, 8]]
      AvailabilityZone: !Ref AvailabilityZone2
      MapPublicIpOnLaunch: true
      Tags:
        - Key: Name
          Value: !Sub "${AWS::StackName}-public-2"

  PrivateSubnet1:
    Type: AWS::EC2::Subnet
    Properties:
      VpcId: !Ref VPC
      CidrBlock: !Select [2, !Cidr [!Ref VpcCidr, 4, 8]]
      AvailabilityZone: !Ref AvailabilityZone1
      Tags:
        - Key: Name
          Value: !Sub "${AWS::StackName}-private-1"

  PrivateSubnet2:
    Type: AWS::EC2::Subnet
    Properties:
      VpcId: !Ref VPC
      CidrBlock: !Select [3, !Cidr [!Ref VpcCidr, 4, 8]]
      AvailabilityZone: !Ref AvailabilityZone2
      Tags:
        - Key: Name
          Value: !Sub "${AWS::StackName}-private-2"

  InternetGateway:
    Type: AWS::EC2::InternetGateway
    Properties:
      Tags:
        - Key: Name
          Value: !Sub "${AWS::StackName}-igw"

  InternetGatewayAttachment:
    Type: AWS::EC2::VPCGatewayAttachment
    Properties:
      VpcId: !Ref VPC
      InternetGatewayId: !Ref InternetGateway

  NatGatewayEIP:
    Type: AWS::EC2::EIP
    Properties:
      Domain: vpc

  NatGateway:
    Type: AWS::EC2::NatGateway
    Properties:
      AllocationId: !GetAtt NatGatewayEIP.AllocationId
      SubnetId: !Ref PublicSubnet1
      Tags:
        - Key: Name
          Value: !Sub "${AWS::StackName}-nat"

  # Route Tables (abbreviated for length)
  # ...

  # ============================================================================
  # Security Groups
  # ============================================================================
  ALBSecurityGroup:
    Type: AWS::EC2::SecurityGroup
    Properties:
      GroupDescription: Security group for Application Load Balancer
      VpcId: !Ref VPC
      SecurityGroupIngress:
        - IpProtocol: tcp
          FromPort: 443
          ToPort: 443
          CidrIp: 0.0.0.0/0
        - IpProtocol: tcp
          FromPort: 80
          ToPort: 80
          CidrIp: 0.0.0.0/0
      Tags:
        - Key: Name
          Value: !Sub "${AWS::StackName}-alb-sg"

  EC2SecurityGroup:
    Type: AWS::EC2::SecurityGroup
    Properties:
      GroupDescription: Security group for EC2 instance
      VpcId: !Ref VPC
      SecurityGroupIngress:
        - IpProtocol: tcp
          FromPort: 3001
          ToPort: 3001
          SourceSecurityGroupId: !Ref ALBSecurityGroup
      Tags:
        - Key: Name
          Value: !Sub "${AWS::StackName}-ec2-sg"

  DatabaseSecurityGroup:
    Type: AWS::EC2::SecurityGroup
    Properties:
      GroupDescription: Security group for RDS database
      VpcId: !Ref VPC
      SecurityGroupIngress:
        - IpProtocol: tcp
          FromPort: 5432
          ToPort: 5432
          SourceSecurityGroupId: !Ref EC2SecurityGroup
      Tags:
        - Key: Name
          Value: !Sub "${AWS::StackName}-db-sg"

  # ============================================================================
  # Secrets Manager
  # ============================================================================
  DatabaseSecret:
    Type: AWS::SecretsManager::Secret
    Properties:
      Name: !Sub "${AWS::StackName}/database"
      Description: Database credentials for Coheus
      SecretString: !Sub |
        {
          "username": "coheusadmin",
          "password": "${DatabasePassword}",
          "host": "${Database.Endpoint.Address}",
          "port": "5432",
          "dbname": "coheus"
        }

  JwtSecretSecret:
    Type: AWS::SecretsManager::Secret
    Properties:
      Name: !Sub "${AWS::StackName}/jwt"
      Description: JWT secret for Coheus
      SecretString: !Ref JwtSecret

  # ============================================================================
  # RDS Database
  # ============================================================================
  DatabaseSubnetGroup:
    Type: AWS::RDS::DBSubnetGroup
    Properties:
      DBSubnetGroupDescription: Subnet group for Coheus database
      SubnetIds:
        - !Ref PrivateSubnet1
        - !Ref PrivateSubnet2
      Tags:
        - Key: Name
          Value: !Sub "${AWS::StackName}-db-subnet-group"

  Database:
    Type: AWS::RDS::DBInstance
    DeletionPolicy: Snapshot
    Properties:
      DBInstanceIdentifier: !Sub "${AWS::StackName}-db"
      DBName: coheus
      Engine: postgres
      EngineVersion: "15.4"
      DBInstanceClass: !Ref DatabaseInstanceClass
      AllocatedStorage: 20
      StorageType: gp3
      StorageEncrypted: true
      MasterUsername: coheusadmin
      MasterUserPassword: !Ref DatabasePassword
      DBSubnetGroupName: !Ref DatabaseSubnetGroup
      VPCSecurityGroups:
        - !Ref DatabaseSecurityGroup
      BackupRetentionPeriod: 7
      MultiAZ: false
      PubliclyAccessible: false
      Tags:
        - Key: Name
          Value: !Sub "${AWS::StackName}-database"

  # ============================================================================
  # EC2 Instance
  # ============================================================================
  EC2Role:
    Type: AWS::IAM::Role
    Properties:
      AssumeRolePolicyDocument:
        Version: "2012-10-17"
        Statement:
          - Effect: Allow
            Principal:
              Service: ec2.amazonaws.com
            Action: sts:AssumeRole
      ManagedPolicyArns:
        - arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore
      Policies:
        - PolicyName: SecretsAccess
          PolicyDocument:
            Version: "2012-10-17"
            Statement:
              - Effect: Allow
                Action:
                  - secretsmanager:GetSecretValue
                Resource:
                  - !Ref DatabaseSecret
                  - !Ref JwtSecretSecret

  EC2InstanceProfile:
    Type: AWS::IAM::InstanceProfile
    Properties:
      Roles:
        - !Ref EC2Role

  EC2Instance:
    Type: AWS::EC2::Instance
    DependsOn: Database
    Properties:
      InstanceType: !Ref InstanceType
      ImageId: !Sub "{{resolve:ssm:/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-6.1-x86_64}}"
      IamInstanceProfile: !Ref EC2InstanceProfile
      SubnetId: !Ref PrivateSubnet1
      SecurityGroupIds:
        - !Ref EC2SecurityGroup
      UserData:
        Fn::Base64: !Sub |
          #!/bin/bash
          set -e
          
          # Install dependencies
          dnf update -y
          dnf install -y nodejs20 npm git
          
          # Create app directory
          mkdir -p /opt/coheus
          cd /opt/coheus
          
          # Download application (replace with actual download URL)
          # aws s3 cp s3://coheus-releases/latest/coheus-server.tar.gz .
          # tar -xzf coheus-server.tar.gz
          
          # Set environment variables
          cat > /opt/coheus/.env << EOF
          NODE_ENV=production
          DEPLOYMENT_MODE=self_hosted
          MULTI_TENANT_ENABLED=false
          PORT=3001
          
          DB_HOST=${Database.Endpoint.Address}
          DB_PORT=5432
          DB_NAME=coheus
          DB_USER=coheusadmin
          DB_PASSWORD=${DatabasePassword}
          DB_SSL=true
          
          JWT_SECRET=${JwtSecret}
          
          ADMIN_EMAIL=${AdminEmail}
          EOF
          
          # Start application
          # npm start
          
      Tags:
        - Key: Name
          Value: !Sub "${AWS::StackName}-app"

  # ============================================================================
  # Application Load Balancer
  # ============================================================================
  ApplicationLoadBalancer:
    Type: AWS::ElasticLoadBalancingV2::LoadBalancer
    Properties:
      Name: !Sub "${AWS::StackName}-alb"
      Type: application
      Scheme: internet-facing
      SecurityGroups:
        - !Ref ALBSecurityGroup
      Subnets:
        - !Ref PublicSubnet1
        - !Ref PublicSubnet2
      Tags:
        - Key: Name
          Value: !Sub "${AWS::StackName}-alb"

  TargetGroup:
    Type: AWS::ElasticLoadBalancingV2::TargetGroup
    Properties:
      Name: !Sub "${AWS::StackName}-tg"
      Port: 3001
      Protocol: HTTP
      VpcId: !Ref VPC
      TargetType: instance
      HealthCheckPath: /health
      HealthCheckIntervalSeconds: 30
      HealthyThresholdCount: 2
      UnhealthyThresholdCount: 5
      Targets:
        - Id: !Ref EC2Instance
          Port: 3001

  HTTPSListener:
    Type: AWS::ElasticLoadBalancingV2::Listener
    Condition: HasCertificate
    Properties:
      LoadBalancerArn: !Ref ApplicationLoadBalancer
      Port: 443
      Protocol: HTTPS
      Certificates:
        - CertificateArn: !Ref CertificateArn
      DefaultActions:
        - Type: forward
          TargetGroupArn: !Ref TargetGroup

  HTTPListener:
    Type: AWS::ElasticLoadBalancingV2::Listener
    Properties:
      LoadBalancerArn: !Ref ApplicationLoadBalancer
      Port: 80
      Protocol: HTTP
      DefaultActions:
        - !If
          - HasCertificate
          - Type: redirect
            RedirectConfig:
              Protocol: HTTPS
              Port: "443"
              StatusCode: HTTP_301
          - Type: forward
            TargetGroupArn: !Ref TargetGroup

  # ============================================================================
  # S3 Bucket for Documents
  # ============================================================================
  DocumentsBucket:
    Type: AWS::S3::Bucket
    Properties:
      BucketName: !Sub "${AWS::StackName}-documents-${AWS::AccountId}"
      BucketEncryption:
        ServerSideEncryptionConfiguration:
          - ServerSideEncryptionByDefault:
              SSEAlgorithm: AES256
      PublicAccessBlockConfiguration:
        BlockPublicAcls: true
        BlockPublicPolicy: true
        IgnorePublicAcls: true
        RestrictPublicBuckets: true

Outputs:
  ApplicationURL:
    Description: URL to access Coheus
    Value: !If
      - HasCertificate
      - !Sub "https://${ApplicationLoadBalancer.DNSName}"
      - !Sub "http://${ApplicationLoadBalancer.DNSName}"

  LoadBalancerDNS:
    Description: DNS name of the load balancer
    Value: !GetAtt ApplicationLoadBalancer.DNSName

  DatabaseEndpoint:
    Description: Database endpoint
    Value: !GetAtt Database.Endpoint.Address

  AdminEmail:
    Description: Administrator email for first login
    Value: !Ref AdminEmail

  DocumentsBucketName:
    Description: S3 bucket for document storage
    Value: !Ref DocumentsBucket

  NextSteps:
    Description: Next steps after deployment
    Value: |
      1. Wait 5-10 minutes for the application to start
      2. Access Coheus at the ApplicationURL
      3. Login with your admin email
      4. Set your password on first login
      5. Configure your LOS connection in Admin settings
```

---

## Pricing Models

### Option 1: Contract Pricing (Recommended)

Monthly subscription fee based on tier:

| Tier | Monthly Fee | Features |
|------|-------------|----------|
| Starter | $299/mo | Up to 5 users, basic features |
| Professional | $599/mo | Up to 20 users, all features |
| Enterprise | $999/mo | Unlimited users, priority support |

### Option 2: Usage-Based Pricing

Pay based on AWS infrastructure usage plus license fee:

```
Total Cost = AWS Infrastructure + License Fee

Where:
- AWS Infrastructure: Customer pays AWS directly
- License Fee: Per-user or per-loan fee
```

### Option 3: Bring Your Own License (BYOL)

Customer purchases license separately:
- No Marketplace fees
- Manual license validation
- Suitable for existing customers

---

## Submission Process

### Step 1: Prepare Assets

- [ ] CloudFormation template (validated)
- [ ] Product logo (120x120 PNG)
- [ ] Architecture diagram
- [ ] User documentation
- [ ] EULA document
- [ ] Support contact information

### Step 2: Create Product Listing

1. Log into AWS Marketplace Management Portal
2. Navigate to Products > Create Product
3. Select "CloudFormation" as delivery method
4. Fill in product information
5. Upload CloudFormation template
6. Configure pricing

### Step 3: Testing

1. AWS validates template syntax
2. AWS deploys test stack
3. Review security scan results
4. Fix any issues identified

### Step 4: Submit for Review

1. Submit product for AWS review
2. AWS reviews for security, quality
3. Typical review time: 2-4 weeks
4. Address any feedback

### Step 5: Publish

1. Approve final listing
2. Set go-live date
3. Monitor initial deployments
4. Respond to customer inquiries

---

## Maintenance and Updates

### Versioning Strategy

```
Version Format: Major.Minor.Patch
Example: 2.1.3

Major: Breaking changes, major features
Minor: New features, non-breaking
Patch: Bug fixes, security updates
```

### Update Process

1. **Develop** new version
2. **Test** deployment in clean account
3. **Update** CloudFormation template
4. **Submit** new version to Marketplace
5. **Notify** existing customers

### Customer Update Path

Customers can update by:
1. Updating CloudFormation stack with new template
2. Or deploying new stack and migrating data

---

## Compliance and Security

### Security Requirements

- [ ] No hardcoded credentials
- [ ] Encryption at rest and in transit
- [ ] Least privilege IAM roles
- [ ] Security group restrictions
- [ ] Regular security patching

### Compliance Certifications

Consider pursuing:
- SOC 2 Type II
- HIPAA (if handling PHI)
- FedRAMP (for government)

### Security Scanning

AWS Marketplace performs:
- Static code analysis
- Vulnerability scanning
- Configuration review

---

## Related Documentation

### Architecture
- [SELF_HOSTED.md](../architecture/SELF_HOSTED.md) - Self-hosted architecture
- [OVERVIEW.md](../architecture/OVERVIEW.md) - System architecture
- [CLIENT_ADMIN_REQUIREMENTS.md](../architecture/CLIENT_ADMIN_REQUIREMENTS.md) - Client admin features

### Deployment
- [TERRAFORM_MODULES.md](./TERRAFORM_MODULES.md) - Terraform deployment

### Security
- [SSO_AUTHENTICATION.md](../security/SSO_AUTHENTICATION.md) - SSO configuration for self-hosted
- [ROW_LEVEL_SECURITY.md](../security/ROW_LEVEL_SECURITY.md) - Access control configuration
