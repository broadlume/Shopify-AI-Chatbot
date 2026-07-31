FROM node:20-alpine
RUN apk add --no-cache openssl

EXPOSE 3000

WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json* ./

# Install all dependencies (including devDependencies required for the build)
RUN npm ci

COPY . .

# Build the frontend and backend assets
RUN npm run build

# Prune devDependencies to keep the production image lightweight
RUN npm prune --omit=dev && npm cache clean --force

CMD ["npm", "run", "docker-start"]
