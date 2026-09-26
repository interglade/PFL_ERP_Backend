import { Repository } from 'typeorm';
import { InvoiceProduct } from '../entity/invoiceProduct.entity';


export class InvoiceProductRepository extends Repository<InvoiceProduct> {}
