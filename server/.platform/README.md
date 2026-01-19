# Elastic Beanstalk Platform Configuration

This directory contains platform-specific configurations for AWS Elastic Beanstalk deployments on Amazon Linux 2.

## Structure

```
.platform/
└── nginx/
    └── conf.d/
        └── client_max_body_size.conf  # Nginx configuration for large file uploads
```

## Configuration Files

### nginx/conf.d/client_max_body_size.conf

Configures nginx to accept large file uploads (up to 100MB) and sets appropriate timeouts for processing large requests.

**Settings:**
- `client_max_body_size`: 100M - Maximum size of client request body
- `proxy_connect_timeout`: 300s - Timeout for establishing connection to upstream
- `proxy_send_timeout`: 300s - Timeout for transmitting request to upstream
- `proxy_read_timeout`: 300s - Timeout for reading response from upstream
- `send_timeout`: 300s - Timeout for transmitting response to client

These settings are required for CSV/Excel file imports in the loan management system.

## Deployment

These configuration files are automatically included in the Elastic Beanstalk deployment package by the GitHub Actions workflow. No manual intervention is required.

## Troubleshooting

If you encounter `413 Request Entity Too Large` errors:

1. Verify this configuration is deployed by checking the EB environment
2. Ensure the application's Express body parser limits are also set appropriately (currently 500MB in `server/src/index.ts`)
3. Check CloudFront cache policy if using CloudFront (default payload size is 20MB, but can be increased)
4. Verify ALB timeout settings (currently set to 3600s in CloudFormation)

## References

- [Elastic Beanstalk Platform Hooks](https://docs.aws.amazon.com/elasticbeanstalk/latest/dg/platforms-linux-extend.html)
- [Nginx Documentation](https://nginx.org/en/docs/)
