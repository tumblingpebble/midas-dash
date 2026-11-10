FROM node:22-alpine AS build
WORKDIR /app

ARG VITE_API_BASE_URL=""
ARG VITE_PRIVATE_ACCESS="0"
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
ENV VITE_PRIVATE_ACCESS=${VITE_PRIVATE_ACCESS}

COPY platform_app/package*.json ./
RUN npm ci

COPY platform_app/ ./
RUN npm run build

FROM nginx:alpine
RUN apk update && apk upgrade --no-cache

COPY --from=build /app/dist /usr/share/nginx/html
COPY platform_app/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]