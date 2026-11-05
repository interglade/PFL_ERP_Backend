import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, Unique } from 'typeorm';

/** Which documents belong to a transaction (one row per document, §5.1). */
@Entity('transaction_documents')
@Unique('UQ_transaction_documents_doc', ['docType', 'docId'])
@Index('IDX_transaction_documents_txn', ['txnNo'])
export class TransactionDocument {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'txn_no', type: 'varchar', length: 13 })
  txnNo: string;

  /** TxnDocType of the document. */
  @Column({ name: 'doc_type', type: 'varchar', length: 30 })
  docType: string;

  @Column({ name: 'doc_id', type: 'uuid' })
  docId: string;

  @Column({ name: 'doc_no', type: 'varchar', length: 120, nullable: true })
  docNo: string | null;

  /** `documents.id` of the newest approval row, when known. */
  @Column({ name: 'approval_document_id', type: 'uuid', nullable: true })
  approvalDocumentId: string | null;

  /** Step key of the document inside the transaction (`grn`, `receiving`, `return`, …). */
  @Column({ type: 'varchar', length: 40 })
  step: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
