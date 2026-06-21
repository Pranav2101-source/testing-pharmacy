FROM node:20-alpine

RUN apk add --no-cache openssl

WORKDIR /app

RUN npm install -g pnpm@9.12.0

# Copy workspace manifests and root tsconfig
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY packages/types/package.json ./packages/types/
COPY packages/utils/package.json ./packages/utils/
COPY packages/database/package.json ./packages/database/
COPY packages/jobs/package.json ./packages/jobs/
COPY packages/mailer/package.json ./packages/mailer/
COPY apps/api/package.json ./apps/api/

RUN pnpm install --frozen-lockfile

# Copy source
COPY packages/ ./packages/
COPY apps/api/ ./apps/api/

# Build API and all its workspace dependencies
RUN pnpm --filter @pharmacy/api... build

EXPOSE 4000

CMD ["node", "apps/api/dist/server.js"]
