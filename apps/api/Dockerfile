FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile=false && pnpm --filter @sugat/api prisma generate && pnpm --filter @sugat/api build
CMD ["sh","-c","pnpm --filter @sugat/api prisma migrate deploy && node apps/api/dist/src/main.js"]
