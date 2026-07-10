import "dotenv/config";
import express from "express";
import helmet from "helmet";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { authRateLimiter, globalRateLimiter, writeMutationRateLimiter } from "./rateLimiters";
import { registerStorageProxy } from "./storageProxy";
import { registerTossWebhook } from "../tossWebhook";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { validateRequiredEnv } from "./env";
import { startTripConfirmScheduler } from "../scheduler/tripConfirmScheduler";
import { startMatchingFreezeScheduler } from "../scheduler/matchingFreezeScheduler";
import { serveStatic, setupVite } from "./vite";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  validateRequiredEnv();

  const app = express();
  // Railway terminates TLS at its edge and forwards over HTTP, setting
  // X-Forwarded-Proto. Without trusting the proxy, req.protocol always
  // reports "http", which breaks anything that builds an absolute URL from
  // it (e.g. the Kakao OAuth redirect_uri, which must match https exactly).
  app.set("trust proxy", 1);
  const server = createServer(app);

  // contentSecurityPolicy is disabled: Vite's dev middleware needs inline
  // scripts/eval and a WebSocket connection for HMR, and in production this
  // app loads the Kakao Maps SDK from dapi.kakao.com, which a default CSP
  // would block. The rest of helmet's headers (HSTS, X-Content-Type-Options,
  // X-Frame-Options, etc.) apply in both modes. A tailored production CSP
  // allowlisting the known external origins would be a good follow-up.
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(globalRateLimiter);

  // Body parsers are scoped per route group instead of applied globally, so
  // tRPC (small JSON payloads) gets a tight cap while a future storage-proxy
  // upload route keeps room for larger bodies - a single global parser can't
  // express two different limits for the same request.
  app.use("/api/trpc", express.json({ limit: "1mb" }), express.urlencoded({ limit: "1mb", extended: true }));
  app.use("/manus-storage", express.json({ limit: "50mb" }), express.urlencoded({ limit: "50mb", extended: true }));
  app.use("/api/webhooks", express.json({ limit: "1mb" }));

  registerStorageProxy(app);
  registerTossWebhook(app);
  app.use("/api/oauth", authRateLimiter);
  app.use("/app-auth", authRateLimiter);
  registerOAuthRoutes(app);
  // tRPC API
  app.use(
    "/api/trpc",
    writeMutationRateLimiter,
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });

  startTripConfirmScheduler();
  startMatchingFreezeScheduler();
}

startServer().catch((error) => {
  console.error(error);
  process.exit(1);
});
