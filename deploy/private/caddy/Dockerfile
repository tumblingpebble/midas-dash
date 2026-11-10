FROM golang:1.27.3-alpine@sha256:fa3d596898d9f126af7c01d14ee7597bab3f39cccf392ef36b69fe77cd681f18 AS build
ENV GOTOOLCHAIN=local GOMAXPROCS=2 GOPROXY=https://proxy.golang.org GOSUMDB=sum.golang.org CGO_ENABLED=0
WORKDIR /recipe
COPY materialize-certificates.go certificates-backport.json ./
RUN go mod download -json github.com/smallstep/certificates@v0.30.2 > /recipe/upstream.json \
    && echo '7f8d8b9bc0ff69bed8334750b41a486f1d942c5993be8ab3b399a6b8a3d790e4  /go/pkg/mod/cache/download/github.com/smallstep/certificates/@v/v0.30.2.zip' | sha256sum -c - \
    && mkdir /build \
    && cp -R /go/pkg/mod/github.com/smallstep/certificates@v0.30.2 /build/certificates-midas \
    && GO111MODULE=off go run materialize-certificates.go /build/certificates-midas certificates-backport.json
WORKDIR /build
COPY go.mod go.sum main.go LICENSE.caddy ./
RUN sha256sum go.mod go.sum > /tmp/locks.sha256 \
    && go mod download && go mod verify && sha256sum -c /tmp/locks.sha256
RUN --network=none go build -mod=readonly -p=2 -tags=nobadger,nomysql,nopgx -trimpath -ldflags="-s -w" -o /out/caddy . \
    && sha256sum -c /tmp/locks.sha256 \
    && /out/caddy build-info > /out/build-info.txt
FROM caddy:2-alpine@sha256:78bd35025c7ba85961dd149ae670315129954e77abe2383ac47c89106b35ade9
COPY --from=build /out/caddy /usr/bin/caddy
LABEL org.opencontainers.image.version="2.11.9-midas-jose4-backport" \
      org.opencontainers.image.source="https://github.com/caddyserver/caddy" \
      org.opencontainers.image.description="Local MIDAS certificates0.30.2 JOSE migration backport; not an upstream release"