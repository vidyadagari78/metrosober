import { createApp } from './app.js';
import { config } from './config.js';
import { ensureDatabaseReady } from './db/init.js';
import { pool } from './db/index.js';

async function startServer() {
  try {
    console.log('Pickup Counter: Initializing database connection...');
    await ensureDatabaseReady();

    const app = createApp();

    const server = app.listen(config.port, () => {
      console.log(`\n======================================================`);
      console.log(`  Pickup Counter Backend API is LIVE`);
      console.log(`  URL: http://localhost:${config.port}`);
      console.log(`  Hold duration: ${config.holdDurationSeconds}s`);
      console.log(`======================================================\n`);
    });

    const shutdown = async () => {
      console.log('\nShutting down server gracefully...');
      server.close(async () => {
        await pool.end();
        console.log('Database pool closed.');
        process.exit(0);
      });
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

startServer();
