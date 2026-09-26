import { tz } from "moment-timezone";

export default {
  origin: "http://localhost:8002",
  // accessTokenExpiresIn: 120,   // 2 hours
  // refreshTokenExpiresIn: 135,  // 2 hours 15 minutes
   accessTokenExpiresIn: 480,   // 8 hours
  refreshTokenExpiresIn: 1440, // 24 hours
  redisCacheExpiresIn: 60,
  port: process.env.PORT,
  accessTokenPrivateKey: process.env.JWT_ACCESS_TOKEN_PRIVATE_KEY,
  accessTokenPublicKey: process.env.JWT_ACCESS_TOKEN_PUBLIC_KEY,
  refreshTokenPrivateKey: process.env.JWT_REFRESH_TOKEN_PRIVATE_KEY,
  refreshTokenPublicKey: process.env.JWT_REFRESH_TOKEN_PUBLIC_KEY,
 

  postgresConfig: {
    host: process.env.POSTGRES_HOST,
    port: process.env.POSTGRES_PORT,
    username: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    database: process.env.POSTGRES_DB,
  },

  smtp: {
    host: process.env.EMAIL_HOST,
    pass: process.env.EMAIL_PASS,
    port: process.env.EMAIL_PORT,
    user: process.env.EMAIL_USER,
  },

  
};
