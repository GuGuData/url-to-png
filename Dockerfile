FROM --platform=$BUILDPLATFORM mcr.microsoft.com/playwright:v1.55.1-jammy AS builder
ENV NODE_ENV='production'
WORKDIR /app
RUN npm install -g pnpm@9.15.9 \
    && chown -R pwuser:pwuser /app
USER pwuser
COPY package.json pnpm-lock.yaml /app/
RUN pnpm install --production false
COPY tsconfig.json tsconfig.build.json /app/
COPY src /app/src
RUN pnpm build


FROM mcr.microsoft.com/playwright:v1.55.1-jammy
ENV NODE_ENV='production'
ENV DOCKER=1
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends tini \
    && rm -rf /var/lib/apt/lists/* \
    && npm install -g pnpm@9.15.9 \
    && chown -R pwuser:pwuser /app
USER pwuser
COPY --from=builder --chown=pwuser:pwuser /app/package.json /app/pnpm-lock.yaml /app/
RUN pnpm install --production
COPY --from=builder --chown=pwuser:pwuser /app/dist /app/dist
EXPOSE 3089
HEALTHCHECK --interval=15s --timeout=3s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3089/ping').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "-r", "dotenv/config", "dist/main.js"]
