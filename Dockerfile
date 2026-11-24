# WEB=build builds the dashboard bundle in the image; WEB=prebuilt takes it from web-dist/ of the
# build context (for a host whose link to the npm registry is too slow to install esbuild).
ARG WEB=build

# Stage 1: runtime dependencies, installed once and used by both later stages
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Stage 2: the production bundle of the dashboard. Of the development dependencies the build
# needs only esbuild, in the version of package.json; the linter and the PDF tools stay out.
FROM deps AS web-build
RUN npm install --no-save --no-audit --no-fund "esbuild@$(node -p "require('./package.json').devDependencies.esbuild")"
COPY src/web/static ./src/web/static
COPY scripts/build-web.mjs ./scripts/build-web.mjs
RUN node scripts/build-web.mjs

# Stage 2, the other way: a bundle built before the image (npm run build:web, copied to web-dist/)
FROM scratch AS web-prebuilt
COPY web-dist /app/src/web/static/dist

FROM web-${WEB} AS web

# Stage 3: the image of every service; only runtime dependencies
FROM node:24-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY --from=deps /app/node_modules ./node_modules

COPY migrations ./migrations
COPY src ./src
COPY --from=web /app/src/web/static/dist ./src/web/static/dist

USER node
CMD ["node", "src/collector/main.ts"]
