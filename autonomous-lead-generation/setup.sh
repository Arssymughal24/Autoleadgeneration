#!/bin/bash

# Autonomous Lead Generation Engine Setup Script
set -e

echo "🚀 Setting up Autonomous Lead Generation Engine..."

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 18+ first."
    exit 1
fi

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    echo "❌ npm is not installed. Please install npm first."
    exit 1
fi

# Navigate to backend directory
cd backend

# Install dependencies
echo "📦 Installing backend dependencies..."
npm install

# Setup environment file
if [ ! -f .env ]; then
    echo "📝 Creating environment file..."
    cp .env.example .env
    echo "⚠️  Please update the .env file with your API keys and database credentials"
else
    echo "✅ Environment file already exists"
fi

# Generate Prisma client
echo "🗄️  Generating Prisma client..."
npx prisma generate

# Check if database is accessible
echo "🔍 Checking database connection..."
if npx prisma db push --accept-data-loss; then
    echo "✅ Database connected and schema deployed"
else
    echo "⚠️  Database connection failed. Please check your DATABASE_URL in .env"
fi

# Run database migrations
echo "🔄 Running database migrations..."
npx prisma db push

# Seed database with sample data (optional)
echo "🌱 Would you like to seed the database with sample data? (y/n)"
read -r seed_choice
if [ "$seed_choice" = "y" ] || [ "$seed_choice" = "Y" ]; then
    npm run seed
fi

# Build the project
echo "🔨 Building the project..."
npm run build

echo "✅ Setup complete!"
echo ""
echo "🎯 Next steps:"
echo "1. Update your .env file with the required API keys:"
echo "   - OPENAI_API_KEY (for GPT-4)"
echo "   - SALESFORCE_CLIENT_ID and SALESFORCE_CLIENT_SECRET"
echo "   - UPLEAD_API_KEY"
echo "   - DATABASE_URL"
echo ""
echo "2. Start the development server:"
echo "   npm run dev"
echo ""
echo "3. Access the dashboard at: http://localhost:3000/mvp-dashboard.html"
echo "4. Test the lead form at: http://localhost:3000/lead-form.html"
echo ""
echo "🐳 For production deployment, use Docker:"
echo "   docker-compose up -d"