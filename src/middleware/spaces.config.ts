import { S3Client } from '@aws-sdk/client-s3';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import https from 'https';

const httpsAgent = new https.Agent({ rejectUnauthorized: false });

export const s3 = new S3Client({
  endpoint: 'https://sgp1.digitaloceanspaces.com',
  region: 'sgp1', // DigitalOcean Spaces region - Singapore
  credentials: {
    accessKeyId: process.env.DO_SPACES_KEY!,
    secretAccessKey: process.env.DO_SPACES_SECRET!,
  },
  forcePathStyle: false, // DigitalOcean Spaces uses virtual-hosted-style
  requestHandler: new NodeHttpHandler({
    connectionTimeout: 30000,  // 30 seconds connection timeout
    requestTimeout: 120000,    // 2 minutes socket timeout for large files
    httpsAgent,
  }),
  maxAttempts: 5, // Increase retry attempts from default 3 to 5
});
