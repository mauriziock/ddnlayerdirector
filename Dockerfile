FROM node:20-alpine

# Set working directory
WORKDIR /app

# Install dependencies first (caching layer)
COPY package*.json ./
RUN npm install --omit=dev

# Copy application source
COPY . .

# Expose the application port
EXPOSE 3000

# Start the server
CMD ["node", "server.js"]
