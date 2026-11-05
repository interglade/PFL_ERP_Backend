import { Request } from 'express';
import { AppDataSource } from '../utils/data-source';
import { VehicleDispatch } from './entity/vehicleDispatch.entity';

/** Each dispatch register is granted separately (permission keys from documentDefination.json). */
const DISPATCH_PERMISSION_KEYS: Record<string, string> = {
  purchase: 'vehicle-dispatch-purchase',
  'stock-transfer': 'vehicle-dispatch-transfer',
  sales: 'vehicle-dispatch-sales',
};

/** Key from the dispatch type in the body (create) or query (list, export). */
export const dispatchKeyFromRequest = (req: Request): string | null => {
  const type = req.body?.dispatchType ?? req.query?.dispatchType;
  return typeof type === 'string' ? DISPATCH_PERMISSION_KEYS[type] ?? null : null;
};

/**
 * Key from the saved dispatch: :id is the dispatch id (edit, delete); :docid is its approval
 * document id (view), whose document_type_id points at the dispatch.
 */
export const dispatchKeyFromRecord = async (req: Request): Promise<string | null> => {
  let id: string | undefined = req.params.id;
  if (!id && req.params.docid) {
    const rows = await AppDataSource.query(
      `SELECT document_type_id FROM documents WHERE id::text = $1 LIMIT 1`,
      [req.params.docid],
    );
    id = rows[0]?.document_type_id;
  }
  if (!id) return null;
  const row = await AppDataSource.getRepository(VehicleDispatch).findOne({
    where: { id },
    select: ['id', 'dispatchType'],
    withDeleted: true,
  });
  return row ? DISPATCH_PERMISSION_KEYS[row.dispatchType] ?? null : null;
};
