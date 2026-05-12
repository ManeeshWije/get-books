# Use buildx-compatible base images
FROM --platform=$TARGETPLATFORM rust:slim AS rbuilder
WORKDIR /backend
COPY backend .

# Install build dependencies
RUN apt-get update && apt-get install -y pkg-config libssl-dev
RUN cargo build --release
RUN strip target/release/get-books

FROM --platform=$TARGETPLATFORM node:20-slim AS jbuilder
WORKDIR /frontend
COPY frontend .

RUN npm install
RUN npm run build

FROM --platform=$TARGETPLATFORM golang:1.24-bookworm AS gobuilder

# Install kepubify
RUN go install github.com/pgaskin/kepubify@latest

FROM --platform=$TARGETPLATFORM debian:trixie-slim AS release
WORKDIR /app

# Install runtime dependencies
RUN apt-get update && apt-get install -y \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy backend binary
COPY --from=rbuilder /backend/target/release/get-books .

# Copy frontend build
COPY --from=jbuilder /frontend/dist/ dist/

# Copy kepubify binary into PATH
COPY --from=gobuilder /go/bin/kepubify /usr/local/bin/kepubify

EXPOSE 8080

CMD ["./get-books", "--tracing-level", "INFO"]
