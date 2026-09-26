import { controller, httpGet, request, response, next } from 'inversify-express-utils';
import { Request, Response, NextFunction } from 'express';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { s3 } from '../middleware/spaces.config';
import { deserializeUser, requireUser } from '../middleware/deserializeUser';
import AppError from '../utils/appError';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';


/**
 * GET /files/download?key=documents/1234-photo.jpg
 * GET /files/download?url=https://prime-fresh-storage.sgp1.digitaloceanspaces.com/documents/1234-photo.jpg
 *
 * Streams the file from DigitalOcean Spaces back to the client with
 * Content-Disposition: attachment  →  browser triggers a file download.
 *
 * Accepts either:
 *  - `key`  — the Spaces object key  (e.g. documents/1234-photo.jpg)
 *  - `url`  — the full public URL    (key is extracted automatically)
 */
@controller('/files', deserializeUser, requireUser)
export class FileController {

  @httpGet('/download')
  public async download(
    @request() req: Request,
    @response() res: Response,
    @next() next: NextFunction,
  ) {
    try {
      const bucket = process.env.DO_SPACES_BUCKET;
      if (!bucket) throw new AppError(500, 'Storage bucket is not configured');

      // Resolve key from either ?key= or ?url=
      let key = req.query.key as string | undefined;

      if (!key && req.query.url) {
        const url = req.query.url as string;
        try {
          // Extract pathname and strip leading slash
          // e.g. https://prime-fresh-storage.sgp1.digitaloceanspaces.com/documents/file.pdf
          //   → documents/file.pdf
          key = new URL(url).pathname.replace(/^\//, '');
        } catch {
          throw new AppError(400, 'Invalid url query param');
        }
      }

      if (!key) {
        throw new AppError(400, 'Provide either key or url query param');
      }

      // Fetch object from Spaces
      const command = new GetObjectCommand({ Bucket: bucket, Key: key });
      const s3Response = await s3.send(command);

      if (!s3Response.Body) {
        throw new AppError(404, 'File not found in storage');
      }

      // Derive a clean filename from the key
      const fileName = key.split('/').pop() ?? 'download';

      // Set response headers
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

      if (s3Response.ContentType) {
        res.setHeader('Content-Type', s3Response.ContentType);
      }
      if (s3Response.ContentLength) {
        res.setHeader('Content-Length', s3Response.ContentLength);
      }

      // Stream the file body directly to the response
      //(s3Response.Body as Readable).pipe(res);
      await pipeline(s3Response.Body as Readable, res);


    } catch (err) {
      next(err);
    }
  }
}
