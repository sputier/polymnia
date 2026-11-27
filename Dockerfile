# syntax=docker/dockerfile:1
#
# Production image: front end (Vite) + API (ASP.NET Core) on a chiseled, non-root runtime.
# Build:  docker build -t polymnia .
# Base images are pinned by digest (multi-arch index); Dependabot (docker) proposes the updates.

# ---- Front end -------------------------------------------------------------
# Runs on the build platform: the output is architecture independent.
# node:24-alpine
FROM --platform=$BUILDPLATFORM node:24-alpine@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5 AS web
WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
RUN npm ci --ignore-scripts
COPY web/ ./
# The score JSON Schema lives at the repo root and is imported by the front end.
COPY schema/ /src/schema/
RUN npm run build

# ---- API -------------------------------------------------------------------
# Runs on the build platform and cross-publishes for the target architecture (fast arm64 builds).
# mcr.microsoft.com/dotnet/sdk:10.0-noble
FROM --platform=$BUILDPLATFORM mcr.microsoft.com/dotnet/sdk:10.0-noble@sha256:8c6edfb26c85153f236d26efebd9ad349aec403583f343f201ee67838b23658d AS publish
ARG TARGETARCH
WORKDIR /src
COPY global.json .editorconfig ./
COPY api/Directory.Build.props api/Directory.Packages.props api/
COPY api/Polymnia.Core/Polymnia.Core.csproj api/Polymnia.Core/
COPY api/Polymnia.Infrastructure/Polymnia.Infrastructure.csproj api/Polymnia.Infrastructure/
COPY api/Polymnia.Api/Polymnia.Api.csproj api/Polymnia.Api/
RUN --mount=type=cache,target=/root/.nuget/packages \
    dotnet restore api/Polymnia.Api/Polymnia.Api.csproj -r "linux-$(case "$TARGETARCH" in amd64) echo x64;; arm64) echo arm64;; *) echo "$TARGETARCH";; esac)"
COPY api/ api/
RUN --mount=type=cache,target=/root/.nuget/packages \
    dotnet publish api/Polymnia.Api/Polymnia.Api.csproj -c Release --no-restore --no-self-contained \
      -r "linux-$(case "$TARGETARCH" in amd64) echo x64;; arm64) echo arm64;; *) echo "$TARGETARCH";; esac)" \
      -p:UseAppHost=false -p:DebugType=none -p:DebugSymbols=false -o /app
# The API serves the built front end from wwwroot.
COPY --from=web /src/web/dist/ /app/wwwroot/

# ---- Runtime ---------------------------------------------------------------
# Chiseled Ubuntu: no shell, no package manager, runs as the unprivileged user "app" (UID 1654).
# mcr.microsoft.com/dotnet/aspnet:10.0-noble-chiseled
FROM mcr.microsoft.com/dotnet/aspnet:10.0-noble-chiseled@sha256:bcdfe6b8e923ad3d05f01dfa805ab97c99d742823ce030856002a6db38122712 AS final
WORKDIR /app
COPY --from=publish /app/ ./
USER $APP_UID
ENV ASPNETCORE_HTTP_PORTS=8080 \
    DOTNET_EnableDiagnostics=0 \
    DOTNET_gcServer=0
EXPOSE 8080
# No HEALTHCHECK instruction: the chiseled image has no shell or curl. The same binary answers the
# probe: `dotnet Polymnia.Api.dll --healthcheck` (used by docker-compose.yml).
ENTRYPOINT ["dotnet", "Polymnia.Api.dll"]
