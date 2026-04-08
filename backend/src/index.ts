import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { testConnection, query } from './db';
import openprojectRoutes from './routes/openproject.routes';
import aiRoutes from './routes/ai.routes';
import squashRoutes from './routes/squash.routes';
import executionRoutes from './routes/execution.routes';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: 'http://localhost:4200' }));
app.use(express.json());

// Routes
app.use('/api/openproject', openprojectRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/squash', squashRoutes);
app.use('/api/executions', executionRoutes);

// Health check API
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'QA Hub API is running' });
});

// Health check DB
app.get('/health/db', async (req, res) => {
  try {
    const result = await query('SELECT NOW() as current_time');
    res.json({
      status: 'ok',
      message: 'Postgres connecté',
      time: result.rows[0].current_time
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: 'Impossible de joindre Postgres'
    });
  }
});


// Démarrage
const start = async () => {
  await testConnection();
  app.listen(PORT, () => {
    console.log(`🚀 API démarrée sur http://localhost:${PORT}`);
  });
};

start();