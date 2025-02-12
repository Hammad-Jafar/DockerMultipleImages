// Load configuration keys from an external file
const keys = require('./keys');

// Express App Setup
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');

const app = express();

// Enable Cross-Origin Resource Sharing (CORS) for frontend requests
app.use(cors());

// Parse incoming request bodies as JSON
app.use(bodyParser.json());

// Postgres Client Setup
const { Pool } = require('pg');

// Create a new PostgreSQL client pool with database credentials
const pgClient = new Pool({
  user: keys.pgUser,
  host: keys.pgHost,
  database: keys.pgDatabase,
  password: keys.pgPassword,
  port: keys.pgPort,
  ssl:
    process.env.NODE_ENV !== 'production'
      ? false // Disable SSL in development
      : { rejectUnauthorized: false }, // Enable SSL in production
});

// Ensure the `values` table exists when connecting to the database
pgClient.on('connect', (client) => {
  client
    .query('CREATE TABLE IF NOT EXISTS values (number INT)')
    .catch((err) => console.error(err));
});

// Redis Client Setup
const redis = require('redis');

// Create a Redis client with automatic reconnection on failure
const redisClient = redis.createClient({
  host: keys.redisHost,
  port: keys.redisPort,
  retry_strategy: () => 1000, // Retry every 1000ms if disconnected
});

// Create a duplicate Redis client for publishing messages
const redisPublisher = redisClient.duplicate();

// Express route handlers

// Root route - Basic response
app.get('/', (req, res) => {
  res.send('Hi');
});

// Get all stored values from PostgreSQL
app.get('/values/all', async (req, res) => {
  const values = await pgClient.query('SELECT * from values');
  res.send(values.rows);
});

// Get the latest computed values from Redis
app.get('/values/current', async (req, res) => {
  redisClient.hgetall('values', (err, values) => {
    res.send(values);
  });
});

// Handle new value submission
app.post('/values', async (req, res) => {
  const index = req.body.index;

  // Restrict values greater than 40 to avoid performance issues
  if (parseInt(index) > 40) {
    return res.status(422).send('Index too high');
  }

  // Store the new index in Redis with a temporary placeholder
  redisClient.hset('values', index, 'Nothing yet!');

  // Publish an "insert" event for workers to process
  redisPublisher.publish('insert', index);

  // Store the index in PostgreSQL for persistence
  pgClient.query('INSERT INTO values(number) VALUES($1)', [index]);

  res.send({ working: true });
});

// Start the Express server on port 5000
app.listen(5000, (err) => {
  console.log('Listening');
});
