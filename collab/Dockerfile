FROM rust:1.89 as builder
WORKDIR /app
COPY Cargo.toml ./
COPY src ./src
RUN cargo build --release

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y ca-certificates curl && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/target/release/aivory-collab /usr/local/bin/aivory-collab
EXPOSE 3200
ENV PORT=3200
ENV RUST_LOG=info
HEALTHCHECK --interval=15s --timeout=5s --retries=3 --start-period=10s CMD curl -sf http://localhost:3200/health || exit 1
CMD ["aivory-collab"]
