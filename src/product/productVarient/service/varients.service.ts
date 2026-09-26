import { inject, injectable } from 'inversify';
import { DataSource } from 'typeorm';
import { TYPES } from '../../../types';
import { ProductVarientRepository } from '../repository/varients.repository';
import { buildQuery, PaginationOptions } from '../../../utils/pagination';
import { Product } from '../../createproduct/entity/product.entity';
import logger from '../../../utils/logger';
import { AppDataSource } from '../../../utils/data-source';
import { ProductVarient } from '../entity/productVarient.entity';


@injectable()
export class ProductVarientsService {
  private productRepository;

  constructor(
    @inject(TYPES.DataSource)
    private dataSource: DataSource,

    @inject(TYPES.ProductVarientRepository)
    private productVarientRepository: ProductVarientRepository,
  ) {
    this.productRepository = this.dataSource.getRepository(Product);
  }



  async getVarientsByIds(ids: string[]): Promise<any[]> {
    // Filter out empty strings, nulls, undefined — frontend may send ""
    const validIds = ids.filter((id) => id && id.trim() !== '');
    if (!validIds || validIds.length === 0) return [];

    return await this.productVarientRepository
      .createQueryBuilder('varient')
      .select(['varient.id', 'varient.variantName', 'varient.variantCode'])
      .where('varient.id IN (:...ids)', { ids: validIds })
      .getMany();
  }

  async getAllByFilter(queryOptions: PaginationOptions): Promise<any> {
      try {
        const queryBuilder = this.productVarientRepository
          .createQueryBuilder('varient')
          .leftJoinAndSelect('varient.product', 'product')
          
          .select([
            'varient.id',
            'varient.variantName',
            'varient.variantCode',
            'varient.count',
            'varient.size',
            'varient.variety',
            'varient.origin',
            'varient.brand',
            'varient.createdAt',
            'product.id',
            'product.name',
          ]);
  
        return await buildQuery(queryBuilder, queryOptions, 'varient');
      } catch (error) {
        logger.error('Error fetching products:', error);
        throw new Error('Unable to fetch the products.');
      }
    }
}


  // public async createVarient(productId: string, data: any): Promise<any> {
  //   const product = await this.productRepository.findOne({
  //     where: { id: productId },
  //     select: ['id', 'name', 'prefix'],
  //   });

  //   if (!product) {
  //     throw new Error(`Product with ID ${productId} not found`);
  //   }

  //   const variants = await Promise.all(
  //     data.map(async (item: any) => {
  //       const variant = this.productVarientRepository.create({
  //         ...item,
  //         product,
  //         productName: product.name,
  //         variantName: await getVariantIdentifier(
  //           product.name,  item.count, item.size, item.variety, item.origin, item.brand
  //         ),
  //         variantCode: await generateVariantCode(
  //           product.id,
  //           product.prefix,
  //           item.count,
  //           item.size,
  //           item.variety,
  //           item.origin,
  //           item.brand,
  //         ),
  //       });

  //       return variant;
  //     }),
  //   );

  //   return await this.productVarientRepository.save(variants);
  // }


export async function generateVariantCode(
  productId: string,
  prefix: string,
  count?: string,
  size?: string,
  variety?: string,
  origin?: string,
  brand?: string,
): Promise<string> {
  const parts: string[] = [];

  if (prefix) {
    parts.push(prefix.toUpperCase());
  }

  if (count) {
    parts.push(`C${count}`);
  }

  if (size) {
    parts.push(`S${size}`);
  }

  if (variety) {
    parts.push(`V${variety}`);
  }

  if (origin) {
    parts.push(`O${origin}`);
  }

  if (brand) {
    parts.push(`B${brand}`);
  }

  const variantRepo = AppDataSource.getRepository(ProductVarient);

  const lastVariant = await variantRepo.findOne({
    where: { product: { id: productId } },
    order: { createdAt: 'DESC' },
    //select: ['variantCode'],
  });

  let nextSeq = 1;
  if (lastVariant?.variantCode) {
    const match = lastVariant.variantCode.match(/(\d{3})$/);
    if (match) {
      nextSeq = parseInt(match[1], 10) + 1;
    }
  }

  parts.push(nextSeq.toString().padStart(3, '0'));

  return parts.join('');
}


export async function getVariantIdentifier(
  productName?: string,
  
  count?: string,
  size?: string,
  variety?: string,
  origin?: string,
  brand?: string
): Promise<string> {
  const parts: string[] = [];
  if (productName) parts.push(productName);
  // if (variantName) parts.push(variantName);
  if (count) parts.push(`Count-${count}`);
  if (size) parts.push(`Size-${size}`);
  if (variety) parts.push(`Variety-${variety}`);
  if (origin) parts.push(`Origin-${origin}`);
  if (brand) parts.push(`Brand-${brand}`);

  return parts.join(',');
}


 


