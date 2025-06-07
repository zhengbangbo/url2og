FROM node:lts-alpine

# Install dependencies for Puppeteer
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    nodejs \
    yarn \
    font-noto \
    font-noto-cjk \
    font-noto-emoji

# Tell Puppeteer to use installed Chromium instead of downloading its own
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

# Create a non-root user to run the application
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# Set working directory
WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm ci --omit=dev

# Copy application code
COPY . .

# Create cache directory with proper permissions
RUN mkdir -p /app/cache && chown -R appuser:appgroup /app

# Create volume for cache directory
VOLUME ["/app/cache"]

# Expose port
EXPOSE 4040

# Set environment variables
ENV PORT=4040
ENV NODE_ENV=production
ENV MAX_WIDTH=3000
ENV MAX_HEIGHT=3000
ENV MAX_CACHE_SIZE_MB=500
ENV MAX_CONCURRENT_REQUESTS=10

# Switch to non-root user
USER appuser

# Add health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:4040/health || exit 1

# Start the application
CMD ["node", "index.js"] 