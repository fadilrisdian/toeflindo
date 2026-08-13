# LiteLLM proxy — using official image which ships with Prisma binaries pre-built.
# Custom builds failed because Prisma's Node CLI requires libatomic1 + a schema file
# to run `prisma generate` at build time, which isn't available in the slim base.
#
# docker-compose.yaml uses the official image directly:
#   image: ghcr.io/berriai/litellm:main-latest
#
# This Dockerfile is kept as a reference. To use it instead of the official image,
# switch docker-compose.yaml back to:
#   build:
#     context: ./litellm
#
FROM ghcr.io/berriai/litellm:main-latest

COPY config.yaml /app/config.yaml

EXPOSE 4000

CMD ["--config", "/app/config.yaml", "--host", "0.0.0.0", "--port", "4000"]
