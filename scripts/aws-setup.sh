#!/usr/bin/env bash
# =============================================================================
# AWS Infrastructure Setup for Shopify AI Chatbot
# Run this once to create the required AWS resources.
# Prerequisites: AWS CLI configured with admin-level access.
# =============================================================================
set -euo pipefail

# ─── Configuration ───────────────────────────────────────────────────────────
AWS_REGION="${AWS_REGION:-us-east-1}"
APP_NAME="shopify-ai-chatbot"
DB_INSTANCE_CLASS="db.t4g.micro"
DB_ALLOCATED_STORAGE=20
DB_ENGINE_VERSION="16.4"
DB_NAME="shopify_chatbot"
DB_USERNAME="chatbot_admin"

echo "╔══════════════════════════════════════════════════════╗"
echo "║  AWS Infrastructure Setup — $APP_NAME  ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""
echo "Region: $AWS_REGION"
echo ""

# ─── 1. ECR Repository ──────────────────────────────────────────────────────
echo "▶ Creating ECR repository..."
aws ecr create-repository \
  --repository-name "$APP_NAME" \
  --region "$AWS_REGION" \
  --image-scanning-configuration scanOnPush=true \
  --encryption-configuration encryptionType=AES256 \
  2>/dev/null || echo "  ↳ Repository already exists, skipping."

ECR_URI=$(aws ecr describe-repositories \
  --repository-names "$APP_NAME" \
  --region "$AWS_REGION" \
  --query 'repositories[0].repositoryUri' --output text)
echo "  ✓ ECR URI: $ECR_URI"
echo ""

# ─── 2. Secrets Manager ─────────────────────────────────────────────────────
echo "▶ Creating Secrets Manager secret..."
SECRET_NAME="$APP_NAME/prod"

# Generate a random DB password
DB_PASSWORD=$(openssl rand -base64 24 | tr -d '/+=' | head -c 24)

# Check if secret already exists
if aws secretsmanager describe-secret --secret-id "$SECRET_NAME" --region "$AWS_REGION" &>/dev/null; then
  echo "  ↳ Secret already exists. Update it manually if needed:"
  echo "    aws secretsmanager put-secret-value --secret-id $SECRET_NAME --region $AWS_REGION --secret-string '...'"
else
  aws secretsmanager create-secret \
    --name "$SECRET_NAME" \
    --region "$AWS_REGION" \
    --description "Runtime secrets for $APP_NAME" \
    --secret-string "{
      \"ANTHROPIC_API_KEY\": \"REPLACE_ME\",
      \"SHOPIFY_API_KEY\": \"REPLACE_ME\",
      \"SHOPIFY_API_SECRET\": \"REPLACE_ME\",
      \"DATABASE_URL\": \"REPLACE_AFTER_RDS_CREATED\",
      \"SHOPIFY_APP_URL\": \"REPLACE_WITH_PRODUCTION_URL\",
      \"SCOPES\": \"unauthenticated_read_product_listings,read_products,read_content,read_product_listings\"
    }"
  echo "  ✓ Secret created. Update placeholder values with:"
  echo "    aws secretsmanager put-secret-value --secret-id $SECRET_NAME --region $AWS_REGION --secret-string '{...}'"
fi
echo ""

# ─── 3. VPC & Security Groups ───────────────────────────────────────────────
echo "▶ Setting up networking..."
DEFAULT_VPC_ID=$(aws ec2 describe-vpcs \
  --filters "Name=is-default,Values=true" \
  --region "$AWS_REGION" \
  --query 'Vpcs[0].VpcId' --output text)

if [ "$DEFAULT_VPC_ID" == "None" ] || [ -z "$DEFAULT_VPC_ID" ]; then
  echo "  ✗ No default VPC found. Create one or specify a VPC manually."
  exit 1
fi
echo "  Using default VPC: $DEFAULT_VPC_ID"

# Security group for RDS
SG_NAME="$APP_NAME-rds-sg"
SG_ID=$(aws ec2 describe-security-groups \
  --filters "Name=group-name,Values=$SG_NAME" "Name=vpc-id,Values=$DEFAULT_VPC_ID" \
  --region "$AWS_REGION" \
  --query 'SecurityGroups[0].GroupId' --output text 2>/dev/null || echo "None")

if [ "$SG_ID" == "None" ] || [ -z "$SG_ID" ]; then
  SG_ID=$(aws ec2 create-security-group \
    --group-name "$SG_NAME" \
    --description "RDS access for $APP_NAME" \
    --vpc-id "$DEFAULT_VPC_ID" \
    --region "$AWS_REGION" \
    --query 'GroupId' --output text)
  # Allow inbound PostgreSQL from anywhere in the VPC
  VPC_CIDR=$(aws ec2 describe-vpcs --vpc-ids "$DEFAULT_VPC_ID" \
    --region "$AWS_REGION" --query 'Vpcs[0].CidrBlock' --output text)
  aws ec2 authorize-security-group-ingress \
    --group-id "$SG_ID" \
    --protocol tcp --port 5432 \
    --cidr "$VPC_CIDR" \
    --region "$AWS_REGION" >/dev/null
fi
echo "  ✓ Security Group: $SG_ID"
echo ""

# ─── 4. RDS PostgreSQL ──────────────────────────────────────────────────────
echo "▶ Creating RDS PostgreSQL instance..."
DB_INSTANCE_ID="$APP_NAME-db"

if aws rds describe-db-instances --db-instance-identifier "$DB_INSTANCE_ID" --region "$AWS_REGION" &>/dev/null; then
  echo "  ↳ RDS instance already exists, skipping creation."
else
  aws rds create-db-instance \
    --db-instance-identifier "$DB_INSTANCE_ID" \
    --db-instance-class "$DB_INSTANCE_CLASS" \
    --engine postgres \
    --engine-version "$DB_ENGINE_VERSION" \
    --master-username "$DB_USERNAME" \
    --master-user-password "$DB_PASSWORD" \
    --db-name "$DB_NAME" \
    --allocated-storage "$DB_ALLOCATED_STORAGE" \
    --vpc-security-group-ids "$SG_ID" \
    --no-publicly-accessible \
    --backup-retention-period 7 \
    --storage-encrypted \
    --region "$AWS_REGION" >/dev/null

  echo "  ✓ RDS instance '$DB_INSTANCE_ID' is being created (takes ~5 min)."
  echo "  ✓ DB password: $DB_PASSWORD"
  echo "    (Save this — it won't be shown again)"
  echo ""
  echo "  After RDS is available, get the endpoint with:"
  echo "    aws rds describe-db-instances --db-instance-identifier $DB_INSTANCE_ID \\"
  echo "      --query 'DBInstances[0].Endpoint.Address' --output text"
  echo ""
  echo "  Then update DATABASE_URL in Secrets Manager:"
  echo "    postgresql://$DB_USERNAME:$DB_PASSWORD@<ENDPOINT>:5432/$DB_NAME"
fi
echo ""

# ─── 5. IAM Roles ───────────────────────────────────────────────────────────
echo "▶ Creating IAM roles..."

# App Runner ECR access role
ECR_ROLE_NAME="$APP_NAME-apprunner-ecr"
if ! aws iam get-role --role-name "$ECR_ROLE_NAME" &>/dev/null; then
  aws iam create-role \
    --role-name "$ECR_ROLE_NAME" \
    --assume-role-policy-document '{
      "Version": "2012-10-17",
      "Statement": [{
        "Effect": "Allow",
        "Principal": {"Service": "build.apprunner.amazonaws.com"},
        "Action": "sts:AssumeRole"
      }]
    }' >/dev/null
  aws iam attach-role-policy \
    --role-name "$ECR_ROLE_NAME" \
    --policy-arn "arn:aws:iam::aws:policy/service-role/AWSAppRunnerServicePolicyForECRAccess"
  echo "  ✓ Created role: $ECR_ROLE_NAME"
else
  echo "  ↳ Role $ECR_ROLE_NAME already exists."
fi

# App Runner instance role (for Secrets Manager access)
INSTANCE_ROLE_NAME="$APP_NAME-apprunner-instance"
if ! aws iam get-role --role-name "$INSTANCE_ROLE_NAME" &>/dev/null; then
  aws iam create-role \
    --role-name "$INSTANCE_ROLE_NAME" \
    --assume-role-policy-document '{
      "Version": "2012-10-17",
      "Statement": [{
        "Effect": "Allow",
        "Principal": {"Service": "tasks.apprunner.amazonaws.com"},
        "Action": "sts:AssumeRole"
      }]
    }' >/dev/null

  # Allow reading secrets
  ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
  aws iam put-role-policy \
    --role-name "$INSTANCE_ROLE_NAME" \
    --policy-name "secrets-access" \
    --policy-document "{
      \"Version\": \"2012-10-17\",
      \"Statement\": [{
        \"Effect\": \"Allow\",
        \"Action\": [\"secretsmanager:GetSecretValue\"],
        \"Resource\": \"arn:aws:secretsmanager:$AWS_REGION:$ACCOUNT_ID:secret:$APP_NAME/*\"
      }]
    }"
  echo "  ✓ Created role: $INSTANCE_ROLE_NAME"
else
  echo "  ↳ Role $INSTANCE_ROLE_NAME already exists."
fi

# GitHub Actions OIDC deploy role
DEPLOY_ROLE_NAME="$APP_NAME-github-deploy"
if ! aws iam get-role --role-name "$DEPLOY_ROLE_NAME" &>/dev/null; then
  ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

  echo ""
  echo "  ⚠ To create the GitHub OIDC deploy role, you need:"
  echo "    1. A GitHub OIDC provider in IAM (one per account):"
  echo "       aws iam create-open-id-connect-provider \\"
  echo "         --url https://token.actions.githubusercontent.com \\"
  echo "         --client-id-list sts.amazonaws.com \\"
  echo "         --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1"
  echo ""
  echo "    2. Then create the role with your repo details:"
  echo "       Replace GITHUB_ORG/REPO below with your actual values."
  echo ""
  echo "       aws iam create-role --role-name $DEPLOY_ROLE_NAME \\"
  echo "         --assume-role-policy-document '{...}'"
  echo ""
else
  echo "  ↳ Role $DEPLOY_ROLE_NAME already exists."
fi
echo ""

# ─── Summary ────────────────────────────────────────────────────────────────
echo "═══════════════════════════════════════════════════════════"
echo "  Setup Complete! Next steps:"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "  1. Wait for RDS to become available (~5 min):"
echo "     aws rds wait db-instance-available --db-instance-identifier $DB_INSTANCE_ID"
echo ""
echo "  2. Get RDS endpoint and update Secrets Manager:"
echo "     ENDPOINT=\$(aws rds describe-db-instances --db-instance-identifier $DB_INSTANCE_ID \\"
echo "       --query 'DBInstances[0].Endpoint.Address' --output text)"
echo "     # Update DATABASE_URL in secret: postgresql://$DB_USERNAME:<password>@\$ENDPOINT:5432/$DB_NAME"
echo ""
echo "  3. Create the App Runner service (first deploy):"
echo "     See .github/workflows/deploy.yml or run manually:"
echo "     docker build -t $ECR_URI:latest . && docker push $ECR_URI:latest"
echo ""
echo "  4. Set GitHub Actions secrets:"
echo "     - AWS_DEPLOY_ROLE_ARN"
echo "     - APP_RUNNER_ECR_ROLE_ARN"
echo ""
echo "  5. Update shopify.app.toml with your production URL and run:"
echo "     shopify app deploy"
echo ""
