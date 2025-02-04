FROM oven/bun:1.1.43 AS base
WORKDIR /usr/src/app

LABEL org.opencontainers.image.title="3o14"
LABEL org.opencontainers.image.description="A federated micro-blogging platform."
LABEL org.opencontainers.image.url="https://github.com/3o14-com/bftgu"
LABEL org.opencontainers.image.source="https://github.com/3o14-com/bftgu"
LABEL org.opencontainers.image.licenses="AGPL-3.0-only"


FROM base AS install
RUN mkdir -p /temp/dev
COPY package.json bun.lockb /temp/dev/
RUN cd /temp/dev && bun install --frozen-lockfile

RUN mkdir -p /temp/prod
COPY  package.json bun.lockb /temp/prod/
RUN cd /temp/prod && bun install --frozen-lockfile --production

FROM base AS prerelease
COPY --from=install /temp/dev/node_modules node_modules
COPY . .

FROM base AS release
COPY --from=install /temp/prod/node_modules node_modules
COPY --from=prerelease /usr/src/app/src ./src
COPY --from=prerelease /usr/src/app/package.json .
COPY --from=prerelease /usr/src/app/tsconfig.json .
COPY --from=prerelease /usr/src/app/drizzle.config.ts .
COPY --from=prerelease /usr/src/app/static ./static

USER bun
EXPOSE 8000
ENTRYPOINT [ "bun", "prod" ]
