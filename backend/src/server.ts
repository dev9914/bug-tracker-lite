import 'dotenv/config';
import type { Server } from 'node:http';
import { app } from './app.js';
import { connectDatabase, disconnectDatabase } from './config/database.js';

const PORT = Number(process.env.PORT ?? 5000);

let server: Server | null = null;
let shuttingDown = false;

/** Stops accepting new connections and waits for in-flight requests to finish. */
function closeServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!server) {
      resolve();
      return;
    }

    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

async function shutdown(signal: string): Promise<void> {
  // Elastic Beanstalk may send the signal more than once; only run once.
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  console.log(`Received ${signal}; shutting down gracefully`);

  try {
    await closeServer();
    await disconnectDatabase();
    console.log('Shutdown complete');
    process.exit(0);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error(`Error during shutdown: ${reason}`);
    process.exit(1);
  }
}

async function start(): Promise<void> {
  try {
    await connectDatabase();
    console.log('Connected to MongoDB');

    server = app.listen(PORT, () => {
      console.log(`API listening on http://localhost:${PORT}`);
    });

    process.on('SIGTERM', () => void shutdown('SIGTERM'));
    process.on('SIGINT', () => void shutdown('SIGINT'));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error(`Startup failed: ${reason}`);
    process.exit(1);
  }
}

void start();
