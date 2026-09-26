require('dotenv').config()
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import config from 'config';

const postgresConfig = config.get<{
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
}>('postgresConfig');

export const AppDataSource = new DataSource({
  ...postgresConfig,
  type: 'postgres',
  synchronize: true, // Temporary for enum fix
  //logging: true,  // Enable logging to see actual SQL queries
  
  // Connection pool optimization
  extra: {
    connectionLimit: 20,
    acquireTimeout: 60000,
    timeout: 60000,
    reconnect: true,
  },
  
  // Connection pooling
  poolSize: 20,
  maxQueryExecutionTime: 5000,
  
  entities: ['src/**/*.entity{.ts,.js}'],
  migrations: ['src/migrations/**/*{.ts,.js}'],
  subscribers: ['src/subscribers/**/*{.ts,.js}'],
  
  // Performance optimizations
  cache: {
    duration: 30000, // 30 seconds
    type: 'database',
  },
});

