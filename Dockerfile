FROM oven/bun:1

WORKDIR /app

COPY package.json bun.lock* ./
RUN bun install
RUN bunx playwright-core install --with-deps chromium

COPY . .

EXPOSE 4321

CMD ["bun", "src/cli.ts", "--port", "4321"]
