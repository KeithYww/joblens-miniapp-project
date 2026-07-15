FROM node:22-alpine AS build

WORKDIR /app

COPY web-h5/package.json web-h5/package-lock.json ./
RUN npm ci

COPY web-h5 ./

ARG VITE_API_BASE_URL=/api
ARG VITE_TURNSTILE_SITE_KEY=
ARG BUILD_SHA=development
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
ENV VITE_TURNSTILE_SITE_KEY=$VITE_TURNSTILE_SITE_KEY
ENV BUILD_SHA=$BUILD_SHA
RUN npm run build

FROM caddy:2.10-alpine

COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist /srv
