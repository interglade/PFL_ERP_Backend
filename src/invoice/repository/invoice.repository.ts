import { Repository } from "typeorm";

import { Invoice } from "../entity/invoice.entity";



export class InvoiceRepository extends Repository<Invoice> {}
