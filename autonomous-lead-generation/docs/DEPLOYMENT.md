# Deployment Guide

## Overview

This guide covers deploying the Autonomous Lead Generation Engine to various platforms including local development, VPS, and cloud providers.

## Prerequisites

- Node.js 18+ 
- PostgreSQL 13+
- Docker & Docker Compose (for containerized deployment)
- Domain name (for production)
- SSL certificate (for production)

## Environment Configuration

### Required Environment Variables

Create a `.env` file in the `backend/` directory with the following variables:

```bash
# Database
DATABASE_URL="postgresql://username:password@localhost:5432/lead_generation_db"

# Server
PORT=3000
NODE_ENV=production

# OpenAI
OPENAI_API_KEY=your_openai_api_key

# Salesforce CRM
SALESFORCE_CLIENT_ID=your_salesforce_client_id
SALESFORCE_CLIENT_SECRET=your_salesforce_client_secret
SALESFORCE_USERNAME=your_salesforce_username
SALESFORCE_PASSWORD=your_salesforce_password
SALESFORCE_SECURITY_TOKEN=your_salesforce_security_token
SALESFORCE_INSTANCE_URL=https://your-instance.salesforce.com

# Lead Sources
UPLEAD_API_KEY=your_uplead_api_key
ZOOMINFO_API_KEY=your_zoominfo_api_key
LINKEDIN_CLIENT_ID=your_linkedin_client_id
LINKEDIN_CLIENT_SECRET=your_linkedin_client_secret

# Email
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your_email@gmail.com
SMTP_PASS=your_app_password

# Security
JWT_SECRET=your_super_secure_jwt_secret_key_here
WEBHOOK_SECRET=your_webhook_secret_key

# Optional Webhooks
SLACK_WEBHOOK_URL=your_slack_webhook_url
```

## Local Development

### 1. Setup Database

```bash
# Install PostgreSQL
# Ubuntu/Debian
sudo apt update
sudo apt install postgresql postgresql-contrib

# macOS
brew install postgresql

# Create database
sudo -u postgres createdb lead_generation_db

# Create user (optional)
sudo -u postgres createuser --interactive
```

### 2. Install Dependencies

```bash
cd backend
npm install
```

### 3. Setup Database Schema

```bash
# Generate Prisma client
npx prisma generate

# Deploy schema
npx prisma db push

# Optional: Seed database
npm run seed
```

### 4. Start Development Server

```bash
npm run dev
```

The application will be available at:
- Backend API: `http://localhost:3000`
- Dashboard: `http://localhost:3000/mvp-dashboard.html`
- Lead Form: `http://localhost:3000/lead-form.html`

## Docker Deployment

### 1. Using Docker Compose (Recommended)

```bash
# Clone repository
git clone https://github.com/Arssymughal24/Auto-lead-generation-.git
cd Auto-lead-generation-

# Create environment file
cp backend/.env.example backend/.env
# Edit .env with your configurations

# Start services
docker-compose up -d

# Check logs
docker-compose logs -f
```

### 2. Manual Docker Build

```bash
# Build image
docker build -t lead-generation-engine .

# Run container
docker run -d \
  --name lead-gen-app \
  -p 3000:3000 \
  --env-file backend/.env \
  lead-generation-engine
```

## VPS Deployment

### 1. Server Setup (Ubuntu 22.04)

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install PostgreSQL
sudo apt install postgresql postgresql-contrib

# Install Docker (optional)
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER

# Install Docker Compose
sudo curl -L "https://github.com/docker/compose/releases/download/v2.20.0/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose
```

### 2. Application Deployment

```bash
# Clone repository
git clone https://github.com/Arssymughal24/Auto-lead-generation-.git
cd Auto-lead-generation-

# Install dependencies
cd backend
npm install

# Build application
npm run build

# Setup environment
cp .env.example .env
# Edit .env file with production values

# Setup database
npx prisma generate
npx prisma db push

# Install PM2 for process management
sudo npm install -g pm2

# Start application
pm2 start dist/index.js --name "lead-generation-engine"

# Save PM2 configuration
pm2 save
pm2 startup
```

### 3. Nginx Reverse Proxy

```bash
# Install Nginx
sudo apt install nginx

# Create configuration
sudo nano /etc/nginx/sites-available/lead-generation
```

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

```bash
# Enable site
sudo ln -s /etc/nginx/sites-available/lead-generation /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx

# Setup SSL with Certbot
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

## Cloud Platform Deployment

### 1. Railway

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login and initialize
railway login
railway init

# Deploy
railway up
```

### 2. Render

1. Connect your GitHub repository to Render
2. Create a new Web Service
3. Set build command: `cd backend && npm install && npm run build`
4. Set start command: `cd backend && npm start`
5. Add environment variables in Render dashboard

### 3. DigitalOcean App Platform

1. Create new app from GitHub repository
2. Configure build settings:
   - Build command: `cd backend && npm install && npm run build`
   - Run command: `cd backend && npm start`
3. Add environment variables
4. Deploy

### 4. AWS EC2

```bash
# Launch EC2 instance (t3.medium recommended)
# Install Docker and Docker Compose
# Clone repository and deploy with Docker Compose

# Optional: Use AWS RDS for PostgreSQL
# Update DATABASE_URL in environment variables
```

## Database Migration

### From Development to Production

```bash
# Dump development database
pg_dump lead_generation_db > backup.sql

# Restore to production
psql -h production-host -U username -d lead_generation_db < backup.sql
```

### Prisma Migrations

```bash
# Generate migration
npx prisma migrate dev --name migration_name

# Apply to production
npx prisma migrate deploy
```

## Monitoring & Logging

### 1. Application Monitoring

```bash
# PM2 monitoring
pm2 monit

# View logs
pm2 logs lead-generation-engine

# Restart application
pm2 restart lead-generation-engine
```

### 2. Database Monitoring

```postgresql
-- Check database connections
SELECT * FROM pg_stat_activity;

-- Check database size
SELECT pg_size_pretty(pg_database_size('lead_generation_db'));

-- Monitor slow queries
SELECT query, mean_time, calls 
FROM pg_stat_statements 
ORDER BY mean_time DESC 
LIMIT 10;
```

### 3. Log Management

Consider using:
- **ELK Stack** (Elasticsearch, Logstash, Kibana)
- **Grafana + Prometheus**
- **DataDog**
- **New Relic**

## Security Considerations

### 1. Environment Security

```bash
# Secure .env file
chmod 600 backend/.env

# Use secrets management in production
# - AWS Secrets Manager
# - HashiCorp Vault
# - Azure Key Vault
```

### 2. Database Security

```postgresql
-- Create application-specific user
CREATE USER lead_gen_app WITH PASSWORD 'secure_password';
GRANT CONNECT ON DATABASE lead_generation_db TO lead_gen_app;
GRANT USAGE ON SCHEMA public TO lead_gen_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO lead_gen_app;
```

### 3. Network Security

```bash
# Firewall configuration (UFW)
sudo ufw enable
sudo ufw allow ssh
sudo ufw allow 80
sudo ufw allow 443
sudo ufw deny 3000  # Only allow through reverse proxy
```

## Backup Strategy

### 1. Database Backups

```bash
#!/bin/bash
# backup.sh
DATE=$(date +%Y%m%d_%H%M%S)
pg_dump -h localhost -U postgres lead_generation_db > /backups/db_backup_$DATE.sql
find /backups -name "db_backup_*.sql" -mtime +7 -delete
```

### 2. Application Backups

```bash
# Create cron job for regular backups
0 2 * * * /path/to/backup.sh
```

### 3. File Backups

Consider backing up:
- Environment files
- Upload directories
- Log files
- SSL certificates

## Performance Optimization

### 1. Database Optimization

```postgresql
-- Add indexes for frequently queried fields
CREATE INDEX idx_leads_email ON leads(email);
CREATE INDEX idx_leads_company ON leads(company);
CREATE INDEX idx_leads_score ON leads(score);
CREATE INDEX idx_leads_created_at ON leads(created_at);
CREATE INDEX idx_leads_status ON leads(status);
```

### 2. Application Optimization

```javascript
// Use connection pooling
// Enable compression
// Implement caching (Redis)
// Use CDN for static assets
```

### 3. Server Optimization

```bash
# Increase file limits
echo "fs.file-max = 65536" >> /etc/sysctl.conf

# Optimize PostgreSQL
# Edit /etc/postgresql/*/main/postgresql.conf
shared_buffers = 256MB
effective_cache_size = 1GB
work_mem = 4MB
```

## Troubleshooting

### Common Issues

1. **Database Connection Issues**
   ```bash
   # Check PostgreSQL status
   sudo systemctl status postgresql
   
   # Check connections
   sudo -u postgres psql -c "SELECT * FROM pg_stat_activity;"
   ```

2. **Port Already in Use**
   ```bash
   # Find process using port
   sudo lsof -i :3000
   
   # Kill process
   sudo kill -9 PID
   ```

3. **Permission Issues**
   ```bash
   # Fix file permissions
   sudo chown -R $USER:$USER /path/to/app
   chmod -R 755 /path/to/app
   ```

4. **Memory Issues**
   ```bash
   # Check memory usage
   free -h
   
   # Check swap
   swapon --show
   ```

### Logs to Check

- Application logs: `pm2 logs`
- Nginx logs: `/var/log/nginx/error.log`
- PostgreSQL logs: `/var/log/postgresql/`
- System logs: `journalctl -f`

## Scaling

### Horizontal Scaling

1. **Load Balancer** (Nginx, HAProxy, AWS ALB)
2. **Multiple App Instances**
3. **Database Read Replicas**
4. **Redis for Session Storage**

### Vertical Scaling

1. **Increase server resources**
2. **Optimize database configuration**
3. **Enable application caching**

## Health Checks

### Application Health

```bash
# Health check endpoint
curl http://localhost:3000/api/health

# Expected response
{
  "status": "healthy",
  "timestamp": "2025-08-01T12:00:00Z",
  "database": "connected",
  "version": "1.0.0"
}
```

### Database Health

```postgresql
SELECT 
  datname,
  numbackends,
  xact_commit,
  xact_rollback,
  blks_read,
  blks_hit
FROM pg_stat_database 
WHERE datname = 'lead_generation_db';
```

## Maintenance

### Regular Maintenance Tasks

1. **Update dependencies**: `npm audit fix`
2. **Database maintenance**: `VACUUM ANALYZE`
3. **Log rotation**: Configure logrotate
4. **Security updates**: `sudo apt update && sudo apt upgrade`
5. **Certificate renewal**: Automated with Certbot
6. **Backup verification**: Test backup restoration

### Monitoring Alerts

Set up alerts for:
- High CPU/Memory usage
- Database connection issues
- API response time
- Error rates
- Disk space usage

This completes the comprehensive deployment guide for the Autonomous Lead Generation Engine.