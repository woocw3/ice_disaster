# 페루 빙하 모니터 — 수집기 겸 정적 서버
# npm 의존성이 없어 빌드가 단순하고 이미지도 작습니다.
FROM node:22-alpine

ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=8080 \
    HOST=0.0.0.0

WORKDIR /app
COPY . /app

# 마운트 볼륨이 없을 때를 대비해 기본 데이터 경로를 만들고 소유권을 넘긴다
RUN mkdir -p /data && chown -R node:node /data /app
USER node

EXPOSE 8080
HEALTHCHECK --interval=60s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/api/health" > /dev/null || exit 1

CMD ["node", "server/server.mjs"]
