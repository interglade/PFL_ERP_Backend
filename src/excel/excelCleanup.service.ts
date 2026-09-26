/**
 * Housekeeping for generated exports.
 *
 * Uploaded import files are deleted the moment they are parsed, but exports are
 * handed to the client as a URL and therefore have to outlive the request. This
 * sweeps the `exports/` prefix so generated spreadsheets - which contain PAN,
 * bank and contact data - do not sit in the bucket indefinitely.
 */

import {
  DeleteObjectsCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { s3 } from '../middleware/spaces.config';
import logger from '../utils/logger';

export const EXPORT_PREFIX = 'exports/';
export const DEFAULT_EXPORT_RETENTION_DAYS = 7;

/** S3 DeleteObjects accepts at most 1000 keys per call. */
const DELETE_BATCH_SIZE = 1000;

/**
 * Deletes every object under `exports/` last modified more than
 * `retentionDays` ago. Returns how many objects were removed.
 */
export async function purgeOldExports(
  retentionDays: number = DEFAULT_EXPORT_RETENTION_DAYS,
): Promise<number> {
  const bucket = process.env.DO_SPACES_BUCKET;
  if (!bucket) {
    logger.warn('DO_SPACES_BUCKET is not configured; skipping export cleanup');
    return 0;
  }

  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;

  let continuationToken: string | undefined;
  let deleted = 0;

  do {
    const listed = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: EXPORT_PREFIX,
        ContinuationToken: continuationToken,
      }),
    );

    const expired = (listed.Contents ?? [])
      .filter((object) => object.Key && object.LastModified)
      .filter((object) => object.LastModified!.getTime() < cutoff)
      .map((object) => ({ Key: object.Key! }));

    for (let index = 0; index < expired.length; index += DELETE_BATCH_SIZE) {
      const batch = expired.slice(index, index + DELETE_BATCH_SIZE);
      await s3.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: { Objects: batch, Quiet: true },
        }),
      );
      deleted += batch.length;
    }

    continuationToken = listed.IsTruncated ? listed.NextContinuationToken : undefined;
  } while (continuationToken);

  if (deleted > 0) {
    logger.info(
      `Export cleanup removed ${deleted} file(s) older than ${retentionDays} day(s)`,
    );
  }

  return deleted;
}
