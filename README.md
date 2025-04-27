# URL to OpenGraph Image Web Service ✨

A cute web service that can turn any URL into a screenshot with common OpenGraph dimensions! Perfect for generating preview images for social media.

## Installation

### Standard Installation

```bash
# Clone the repository
git clone <your-repo-url>
cd url2og

# Install dependencies
npm install
```

### Docker Installation

```bash
# Build the Docker image
docker build -t url2og .

# Run the container
docker run -p 4040:4040 url2og

# Run with domain whitelist
docker run -p 4040:4040 -e ALLOWED_DOMAINS="example.com,mysite.org" url2og

# Run with custom security settings
docker run -p 4040:4040 \
  -e ALLOWED_DOMAINS="example.com,mysite.org" \
  -e MAX_WIDTH=2000 \
  -e MAX_HEIGHT=2000 \
  -e MAX_CACHE_SIZE_MB=250 \
  -e MAX_CONCURRENT_REQUESTS=5 \
  url2og
```

## Usage

```bash
# Start the web service
npm start

# Start with domain whitelist
ALLOWED_DOMAINS="example.com,mysite.org" npm start

# Start with custom security settings
MAX_WIDTH=2000 MAX_HEIGHT=2000 MAX_CACHE_SIZE_MB=250 npm start
```

Then open your browser to http://localhost:4040

## Environment Variables

| Variable | Description | Default | Example |
|----------|-------------|---------|---------|
| `PORT` | Port to run the server on | `4040` | `PORT=8080 npm start` |
| `ALLOWED_DOMAINS` | Comma-separated list of allowed domains | (none) | `ALLOWED_DOMAINS="example.com,mysite.org"` |
| `PUPPETEER_EXECUTABLE_PATH` | Custom path to Chrome/Chromium executable | (auto) | Used automatically in Docker |
| `MAX_WIDTH` | Maximum allowed width in pixels | `3000` | `MAX_WIDTH=2000` |
| `MAX_HEIGHT` | Maximum allowed height in pixels | `3000` | `MAX_HEIGHT=2000` |
| `MAX_CACHE_SIZE_MB` | Maximum cache size in MB | `500` | `MAX_CACHE_SIZE_MB=250` |
| `MAX_CONCURRENT_REQUESTS` | Maximum concurrent screenshot requests | `10` | `MAX_CONCURRENT_REQUESTS=5` |

## API

### Get Screenshot

```
GET /?url=<target-url>[&width=<width>&height=<height>]
```

#### Parameters:

- `url`: The URL to capture (required)
- `width`: Width of image in pixels (default: 1200, max: defined by MAX_WIDTH)
- `height`: Height of image in pixels (default: 630, max: defined by MAX_HEIGHT)

#### Examples:

Basic usage:
```
http://localhost:4040/?url=google.com
```

Custom dimensions:
```
http://localhost:4040/?url=twitter.com&width=800&height=400
```

### Health Check

```
GET /health
```

Returns 200 OK if the service is running properly.

## Features

- 🌸 Returns JPEG images directly in the response
- 🌟 Auto-prefixes URLs with https:// if protocol is missing
- 💖 Includes a friendly web interface with a form
- 🎀 Optimized with browser reuse for better performance
- 🍡 Standard OpenGraph dimensions (1200×630) by default
- 💾 Two-level caching system for improved performance
- 🧹 Automatic cache management with 7-day retention policy
- 🔒 Domain whitelist to prevent unauthorized usage
- 🐳 Docker support for easy deployment
- 🛡️ Enhanced security features for production use

## Security Features

- Domain whitelist restricts which sites can be captured
- Size limits for images prevent resource abuse
- Request rate limiting prevents DoS attacks
- Disk size management prevents filling server storage
- Docker container runs as non-root user
- Regular security headers to prevent common attacks
- Resource filtering to reduce attack surface
- Health check endpoint for monitoring
- Error handling that doesn't leak information

## Technical Details

- Images are stored in a filesystem cache (`./cache` directory)
- In-memory caching layer for faster repeat access
- Cache keys are generated using MD5 hash of URL + dimensions
- Response headers include `X-Cache: HIT` or `X-Cache: MISS` to indicate cache status
- Cache cleanup runs automatically every 24 hours to remove expired entries
- Domain whitelist supports both exact domains and subdomains (e.g., allowing `example.com` also allows `sub.example.com`)

## Requirements

### Without Docker
- Node.js 14+
- Internet connection

### With Docker
- Docker
- Internet connection