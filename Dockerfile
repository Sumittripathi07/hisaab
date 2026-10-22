# syntax=docker/dockerfile:1

FROM node:24-slim AS deps
WORKDIR /app
RUN corepack enable
# Prisma picks its schema-engine binary at install time by detecting OpenSSL, which the slim image lacks.
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
# Dummy value so `prisma generate` (postinstall) and prisma.config.ts load. Nothing connects at build.
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build
# Dummy values so `next build` can load env.ts. Nothing is sent or signed at build.
ENV SMTP_URL=file:///tmp/outbox
# Dummy auth values: the secret must be 32+ characters or env.ts refuses it.
ENV BETTER_AUTH_SECRET=dummy-build-secret-abcdefghijklmnopqrstuvwxyz0123
ENV BETTER_AUTH_URL=http://localhost:3000
ENV GOOGLE_CLIENT_ID=dummy-build-google-client-id
ENV GOOGLE_CLIENT_SECRET=dummy-build-google-client-secret
# The schema is needed here because postinstall runs `prisma generate`.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml prisma.config.ts ./
COPY prisma ./prisma
RUN pnpm install --frozen-lockfile

FROM deps AS builder
# Dummy build-time env goes here (the vars above are inherited from deps). Later tasks add more.
COPY . .
RUN pnpm build

# Release job: applies migrations. Declared before `web` so a plain `docker build .` still produces `web`.
FROM deps AS migrate
CMD ["pnpm", "prisma", "migrate", "deploy"]

FROM node:24-slim AS web
WORKDIR /app
ENV NODE_ENV=production PORT=8080 HOSTNAME=0.0.0.0
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public
USER node
EXPOSE 8080
CMD ["node", "server.js"]
