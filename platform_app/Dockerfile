FROM node:22-alpine AS build
WORKDIR /app

COPY platform_app/package*.json ./
RUN npm ci

COPY platform_app/ ./
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY platform_app/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
