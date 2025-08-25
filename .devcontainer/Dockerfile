ARG NODE_VERSION=20
FROM mcr.microsoft.com/devcontainers/javascript-node:1-${NODE_VERSION}-bookworm

ENV TZ=Asia/Tokyo
RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone \
 && apt-get update && apt-get install -y git-lfs \
 && apt-get clean && rm -rf /var/lib/apt/lists/*

# ← Corepack関連は一切入れない
WORKDIR /workspaces/app
USER node